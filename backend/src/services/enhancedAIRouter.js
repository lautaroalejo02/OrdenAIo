import ConversationContext from './conversationContext.js';
import { parseQuantities } from './universalQuantityParser.js';
import UniversalProductMatcher from './universalProductMatcher.js';
import prisma from '../utils/database.js';

class EnhancedAIRouter {
  constructor() {
    this.conversationContext = ConversationContext;
    this.productMatcher = null; // Set per request
    this.groq = null;
    this.openai = null;
    this.gemini = null;
  }

  setGroq(groq) { this.groq = groq; }
  setOpenAI(openai) { this.openai = openai; }
  setGemini(gemini) { this.gemini = gemini; }

  // Helper: Detect greeting
  isGreeting(message) {
    const lower = message.trim().toLowerCase();
    return /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hello|hi|saludos|holi|holis|qué tal|que tal|quiero hacer un pedido)/i.test(lower);
  }

  // Helper: Build personalized greeting
  async buildGreeting(phoneNumber, config, menuItems) {
    const APP_URL = process.env.APP_URL && process.env.APP_URL !== '' ? process.env.APP_URL : 'http://localhost:5173';
    const menuLink = `${APP_URL}/menu?phone=${phoneNumber}`;
    const customer = await prisma.customerProfile.findUnique({ where: { phoneNumber } });
    let customerType = 'NEW_CUSTOMER';
    if (customer) {
      if (customer.orderCount >= 10) customerType = 'VIP_CUSTOMER';
      else if (customer.orderCount > 0) customerType = 'RETURNING_CUSTOMER';
    }
    // Use config.autoResponses.greeting if set
    if (config?.autoResponses?.greeting) {
      return config.autoResponses.greeting.replace('{menuLink}', menuLink).replace('{restaurantName}', config.restaurantName || 'nuestro restaurante');
    }
    // Default Argentinian-style greeting
    if (customerType === 'NEW_CUSTOMER') {
      return `¡Hola! 👋 Bienvenido a ${config.restaurantName || 'nuestro restaurante'} 🇦🇷\n\nPodés pedir de dos formas:\n\n1️⃣ *Por chat*: Decime qué querés y te ayudo a armar el pedido.\n2️⃣ *Por link*: Mirá el menú digital y pedí directo acá:\n${menuLink}\n\n¿Qué te gustaría pedir hoy?`;
    } else if (customerType === 'RETURNING_CUSTOMER') {
      let lastOrder = null;
      if (customer?.lastOrderId) {
        lastOrder = await prisma.order.findUnique({ where: { id: customer.lastOrderId } });
      }
      let lastOrderSummary = '';
      if (lastOrder) {
        const items = Array.isArray(lastOrder.items) ? lastOrder.items : [];
        lastOrderSummary = items.map(i => `${i.quantity}x ${i.name || i.itemName}`).join(' + ');
      }
      return `¡Hola de nuevo! 😊 ¿Cómo quieres ordenar hoy?\n\n🔄 Repetir tu último pedido${lastOrderSummary ? ` (${lastOrderSummary} - $${lastOrder?.totalAmount || ''})` : ''}\n📱 Menú digital: ${menuLink}\n💬 Decime algo nuevo\n\n¿Qué prefieres?`;
    } else if (customerType === 'VIP_CUSTOMER') {
      let lastOrder = null;
      if (customer?.lastOrderId) {
        lastOrder = await prisma.order.findUnique({ where: { id: customer.lastOrderId } });
      }
      let lastOrderSummary = '';
      if (lastOrder) {
        const items = Array.isArray(lastOrder.items) ? lastOrder.items : [];
        lastOrderSummary = items.map(i => `${i.quantity}x ${i.name || i.itemName}`).join(' + ');
      }
      const favorites = (customer?.favoriteItems || []).slice(0, 3).join(', ');
      return `¡Hola${customer?.name ? ' ' + customer.name : ''}! 🌟\n\n🔄 Lo de siempre${lastOrderSummary ? ` (${lastOrderSummary})` : ''}\n⭐ Tus favoritos: ${favorites || 'Sin favoritos aún'}\n📱 Menú completo: ${menuLink}\n💬 Algo diferente hoy\n\n¿Qué te provoca? 😋`;
    }
    return `¡Hola! ¿Qué te gustaría pedir hoy?\n\n📱 Menú digital: ${menuLink}\n💬 Decime qué quieres`;
  }

  /**
   * Main entry: process message with context
   */
  async processMessageWithContext(message, phoneNumber, menuItems, config = {}) {
    this.productMatcher = new UniversalProductMatcher(menuItems, this, config);
    // 0. Greeting intent
    if (this.isGreeting(message)) {
      // Reset context for greeting
      this.conversationContext.clear(phoneNumber);
      return {
        intent: 'greeting',
        response: await this.buildGreeting(phoneNumber, config, menuItems),
        needsHuman: false
      };
    }
    // 1. Parse quantities and products
    const parsed = parseQuantities(message);
    let matchedItems = [];
    for (const { quantity, productName } of parsed) {
      const match = this.productMatcher.findExactMatches(productName);
      if (match.length > 0) {
        matchedItems.push({
          itemId: match[0].item.id,
          itemName: match[0].item.name,
          quantity,
          price: match[0].item.price
        });
      }
    }
    // 2. Context: add to active order
    if (matchedItems.length > 0) {
      matchedItems.forEach(item => this.conversationContext.addItem(phoneNumber, item));
    }
    // 3. Handle confirmation
    if (/confirm(ar|o|o mi pedido|o el pedido|o la orden|o)/i.test(message)) {
      const summary = this.conversationContext.getOrderSummary(phoneNumber);
      this.conversationContext.finalizeOrder(phoneNumber);
      return {
        intent: 'confirm_order',
        orderSummary: summary,
        response: this.buildConfirmationResponse(summary),
        needsHuman: false
      };
    }
    // 4. Handle status inquiry
    if (/cual es mi pedido|que pedi|ver pedido|mi pedido|estado/i.test(message)) {
      const summary = this.conversationContext.getOrderSummary(phoneNumber);
      return {
        intent: 'order_status',
        response: this.buildOrderSummaryResponse(summary),
        needsHuman: false
      };
    }
    // 5. If no match, fallback to matcher suggestions
    if (matchedItems.length === 0) {
      const matcherResult = await this.productMatcher.findProductOrSuggest(message);
      if (matcherResult.found && matcherResult.matches.length > 0) {
        // Add to context
        matcherResult.matches.forEach(m => this.conversationContext.addItem(phoneNumber, {
          itemId: m.item.id,
          itemName: m.item.name,
          quantity: matcherResult.quantity || 1,
          price: m.item.price
        }));
        const summary = this.conversationContext.getOrderSummary(phoneNumber);
        return {
          intent: 'order',
          items: matcherResult.matches.map(m => ({
            itemId: m.item.id,
            itemName: m.item.name,
            quantity: matcherResult.quantity || 1,
            price: m.item.price
          })),
          response: this.buildOrderSummaryResponse(summary),
          needsHuman: false
        };
      } else if (matcherResult.alternatives && matcherResult.alternatives.length > 0) {
        return {
          intent: 'suggestion',
          response: matcherResult.message,
          needsHuman: false
        };
      }
    }
    // 6. Default fallback
    const summary = this.conversationContext.getOrderSummary(phoneNumber);
    return {
      intent: 'order',
      response: this.buildOrderSummaryResponse(summary),
      needsHuman: false
    };
  }

  buildOrderSummaryResponse(summary) {
    if (!summary.items || summary.items.length === 0) {
      return 'Aún no has agregado productos a tu pedido. ¿Qué te gustaría pedir?';
    }
    let response = '🛒 TU PEDIDO ACTUAL:\n';
    summary.items.forEach(item => {
      response += `• ${item.quantity}x ${item.itemName} - $${(item.price * item.quantity).toLocaleString()}\n`;
    });
    response += `\n💰 TOTAL: $${summary.total.toLocaleString()} (${summary.itemCount} items)`;
    return response;
  }

  buildConfirmationResponse(summary) {
    let response = '🎉 ¡PEDIDO CONFIRMADO!\n';
    response += this.buildOrderSummaryResponse(summary);
    response += '\n✅ Tu pedido ha sido enviado a la cocina.\n📞 Te contactaremos pronto para coordinar la entrega.';
    return response;
  }
}

const enhancedAIRouter = new EnhancedAIRouter();
export { enhancedAIRouter, EnhancedAIRouter }; 