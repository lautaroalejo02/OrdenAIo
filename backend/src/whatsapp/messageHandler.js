import { messageFilter } from '../services/contentFilter.js';
import { processWithGemini } from '../services/gemini.js';
import { rateLimiter } from '../services/rateLimiter.js';
import { escalationDetector } from '../services/escalationDetector.js';
import prisma from '../utils/database.js';
import { findBestMenuMatch } from '../services/gemini.js';
import {
  getOrCreateDraft,
  updateDraft,
  finalizeDraft,
  deleteDraft,
  getDraftByConversationId
} from '../services/orderDraftService.js';
import {
  extractOrderItemsAndQuantities,
  isOrderConfirmation,
  isOrderCancellation,
  isQuantityOnlyMessage,
  isAddIntent,
  isRemoveIntent,
  detectReplaceIntent
} from '../utils/validators.js';
import { extractOrderWithGemini } from '../services/gemini.js';
import AIRouter from '../services/aiRouter.js';

const APP_URL = process.env.APP_URL && process.env.APP_URL !== '' ? process.env.APP_URL : 'http://localhost:5173';
const aiRouter = new AIRouter();

// Helper to get customer type
async function getCustomerType(phoneNumber) {
  const customer = await prisma.customerProfile.findUnique({ where: { phoneNumber } });
  if (!customer || customer.orderCount === 0) return 'NEW_CUSTOMER';
  if (customer.orderCount >= 10) return 'VIP_CUSTOMER';
  if (customer.lastOrderDate) {
    const daysSince = (Date.now() - new Date(customer.lastOrderDate).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince <= 30) return 'RETURNING_CUSTOMER';
  }
  return 'DORMANT_CUSTOMER';
}

// Helper to generate personalized greeting/options
async function generateOrderOptions(phoneNumber) {
  const customerType = await getCustomerType(phoneNumber);
  const customer = await prisma.customerProfile.findUnique({ where: { phoneNumber } });
  const config = await prisma.restaurantConfig.findFirst();
  const menuLink = `${APP_URL}/menu?phone=${phoneNumber}`;
  switch (customerType) {
    case 'NEW_CUSTOMER':
      return `¡Bienvenido a ${config.restaurantName || 'nuestro restaurante'}! ¿Cómo prefieres ordenar?\n\n📱 Menú digital: ${menuLink}\n💬 Decime qué quieres\n\n💡 Tip: El menú digital es más fácil con fotos 😊`;
    case 'RETURNING_CUSTOMER': {
      // Get last order summary
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
    }
    case 'VIP_CUSTOMER': {
      // Get last order and favorites
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
    default:
      return `¡Hola! ¿Qué te gustaría pedir hoy?\n\n📱 Menú digital: ${menuLink}\n💬 Decime qué quieres`;
  }
}

// Main function to handle incoming WhatsApp messages
export async function handleIncomingMessage(msg, client) {
  try {
    const phoneNumber = msg.from;
    const messageContent = msg.body;
    console.log(`[HANDLER] Message from ${phoneNumber}: ${messageContent}`);

    // Fetch config for banned numbers and open status
    const config = await prisma.restaurantConfig.findFirst();
    if (config?.bannedNumbers?.includes(phoneNumber)) {
      await msg.reply('No tienes permiso para interactuar con este restaurante.');
      return;
    }

    // Check if restaurant is open
    if (config && !config.isOpen) {
      await msg.reply(config.outOfHoursMessage || 'El restaurante está cerrado en este momento.');
      return;
    }

    // Rate limiting per phone number
    const allowed = await rateLimiter.check(phoneNumber);
    if (!allowed) {
      await msg.reply('Has superado el límite de mensajes. Por favor, intenta más tarde.');
      return;
    }

    // Prepare menuItems ONCE for the whole handler
    let menuItems = config.menuItems;
    if (!Array.isArray(menuItems)) {
      if (typeof menuItems === 'string') {
        try { menuItems = JSON.parse(menuItems); } catch { menuItems = []; }
      } else if (typeof menuItems === 'object' && menuItems !== null) {
        menuItems = Object.values(menuItems).every(i => typeof i === 'object' && i.name) ? Object.values(menuItems) : [];
      } else {
        menuItems = [];
      }
    }
    console.log('[WA] Loaded menu items:', menuItems);

    // Get or create conversation
    let conversation = await prisma.conversation.findFirst({ where: { phoneNumber }, orderBy: { createdAt: 'desc' } });
    if (!conversation) {
      conversation = await prisma.conversation.create({ data: { phoneNumber } });
    }

    // Process with AI Router
    const aiResponse = await aiRouter.processMessage(
      messageContent,
      phoneNumber,
      menuItems
    );
    console.log(`[HANDLER] AI Response:`, aiResponse);

    // Handle escalation if needed
    if (aiResponse.needsHuman) {
      await escalateToHuman(conversation.id, messageContent, aiResponse);
      await msg.reply(aiResponse.response + "\n\n🤝 He notificado a nuestro equipo para mejor asistencia.");
      return;
    }

    // Save interaction to database
    await saveInteraction(conversation.id, messageContent, aiResponse);

    // Handle order items if extracted
    if (aiResponse.intent === 'order' && aiResponse.items && aiResponse.items.length > 0) {
      await handleOrderItems(conversation.id, aiResponse.items);
      // Build order confirmation
      const confirmation = await buildOrderConfirmation(aiResponse.items, menuItems);
      await msg.reply(confirmation);
      return;
    }

    await msg.reply(aiResponse.response);
    return;
  } catch (error) {
    console.error('[HANDLER] Error:', error);
    // Fallback to your existing Gemini function
    try {
      const { processWithGemini } = await import('../services/gemini.js');
      const fallback = await processWithGemini(msg.body, msg.from);
      await msg.reply(fallback);
    } catch (fallbackError) {
      console.error('[HANDLER] Fallback error:', fallbackError);
      await msg.reply('Disculpa, estoy teniendo problemas técnicos. ¿Puedes intentar en unos minutos? 🔧');
    }
  }
}

// Escalation helper
async function escalateToHuman(conversationId, message, aiResponse) {
  try {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status: 'WAITING_HUMAN',
        escalationReason: `AI confidence: ${aiResponse.confidence}, Service: ${aiResponse.aiService}`
      }
    });
    console.log(`[ESCALATION] Conversation ${conversationId} escalated. Reason: Low confidence`);
    // TODO: Add webhook notification to admin if needed
  } catch (error) {
    console.error('[HANDLER] Error escalating:', error);
  }
}

// Save interaction helper
async function saveInteraction(conversationId, userMessage, aiResponse) {
  try {
    await prisma.message.create({
      data: {
        conversationId,
        sender: 'BOT',
        content: aiResponse.response,
        timestamp: new Date(),
        geminiResponse: {
          aiService: aiResponse.aiService,
          intent: aiResponse.intent,
          confidence: aiResponse.confidence,
          cost: aiResponse.cost || 0,
          originalMessage: userMessage
        }
      }
    });
  } catch (error) {
    console.error('[HANDLER] Error saving interaction:', error);
  }
}

// Handle order items helper
async function handleOrderItems(conversationId, items) {
  try {
    await prisma.orderDraft.deleteMany({ where: { conversationId } });
    for (const item of items) {
      await prisma.orderDraft.create({
        data: {
          conversationId,
          itemName: item.itemName,
          itemId: item.itemId?.toString(),
          quantity: item.quantity,
          status: 'PENDING_CONFIRMATION',
          extraData: {
            modifiers: item.modifiers || [],
            extractedBy: 'ai',
            confidence: item.confidence || 0.8
          }
        }
      });
    }
    console.log(`[HANDLER] Created ${items.length} order drafts`);
  } catch (error) {
    console.error('[HANDLER] Error handling order items:', error);
  }
}

// Build order confirmation helper
async function buildOrderConfirmation(items, menuItems) {
  try {
    let response = "✅ Perfecto! Tu pedido:\n\n";
    let total = 0;
    for (const item of items) {
      const menuItem = menuItems.find(m => m.id == item.itemId);
      if (menuItem) {
        const subtotal = menuItem.price * item.quantity;
        total += subtotal;
        response += `🍽️ ${item.quantity}x ${item.itemName} - $${subtotal.toLocaleString()}\n`;
        if (item.modifiers && item.modifiers.length > 0) {
          response += `   📝 ${item.modifiers.join(', ')}\n`;
        }
      }
    }
    response += `\n💰 *Total: $${total.toLocaleString()}*\n\n`;
    response += "¿Confirmas tu pedido? Responde 'sí' para continuar o 'modificar' para cambiar algo.";
    return response;
  } catch (error) {
    console.error('[HANDLER] Error building confirmation:', error);
    return "He procesado tu pedido. ¿Podrías confirmar que está correcto?";
  }
} 