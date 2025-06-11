import { PrismaClient } from '@prisma/client';
import IntelligentOrderProcessor from '../services/intelligentOrderProcessor.js';

const APP_URL = process.env.APP_URL && process.env.APP_URL !== '' ? process.env.APP_URL : 'http://localhost:5173';
const prisma = new PrismaClient();

// Initialize the intelligent processor with OpenAI API key
const intelligentProcessor = new IntelligentOrderProcessor(process.env.OPENAI_API_KEY);

// Helper to get or create restaurant config
async function getOrCreateConfig() {
  try {
    console.log('🔍 Looking for existing RestaurantConfig...');
    let config = await prisma.restaurantConfig.findFirst();
    
    if (config) {
      console.log('✅ Found existing config:', config.restaurantName);
      return config;
    }
    
    console.log('❌ No config found, creating default...');
    // Create default config if none exists
    config = await prisma.restaurantConfig.create({
      data: {
        isOpen: true,
        openingHours: {
          monday: { open: "18:00", close: "23:00" },
          tuesday: { open: "18:00", close: "23:00" },
          wednesday: { open: "18:00", close: "23:00" },
          thursday: { open: "18:00", close: "23:00" },
          friday: { open: "18:00", close: "23:00" },
          saturday: { open: "18:00", close: "23:00" },
          sunday: { open: "18:00", close: "23:00" }
        },
        menuItems: [
          { id: "1", name: "Empanada de carne", price: 7, category: "Empanadas" },
          { id: "2", name: "Empanada de pollo", price: 7, category: "Empanadas" }
        ],
        deliveryZones: {
          "Centro": { price: 500, timeMinutes: 30 },
          "Barrio Norte": { price: 800, timeMinutes: 45 }
        },
        preparationTimes: {
          "Empanadas": 15,
          "Pizzas": 25,
          "Bebidas": 2
        },
        maxMessagesPerHour: 10,
        escalationKeywords: ["humano", "gerente", "problema"],
        autoResponses: {},
        filterKeywords: ["politica", "deporte", "clima"],
        restaurantName: "Ordenalo Restaurant",
        orderMethod: "whatsapp",
        botTone: "argentino_amigable",
        unrelatedMessage: "Disculpa, solo puedo ayudarte con pedidos del restaurante. ¿Qué te gustaría ordenar?",
        bannedNumbers: [],
        outOfHoursMessage: "Estamos cerrados en este momento. Abrimos de 18:00 a 23:00hs.",
        enableReorderOption: true,
        maxReorderDays: 30,
        welcomeBackMessage: "¡Hola de nuevo!",
        firstTimeMessage: "¡Bienvenido!"
      }
    });
    console.log('✅ Created new config:', config.restaurantName);
    
    return config;
  } catch (error) {
    console.error('❌ Error getting/creating config:', error);
    // Return minimal default config to prevent crashes
    return {
      restaurantName: "Nuestro Restaurante",
      menuItems: [
        { id: "1", name: "Empanada de carne", price: 7, category: "Empanadas" },
        { id: "2", name: "Empanada de pollo", price: 7, category: "Empanadas" }
      ],
      isOpen: true
    };
  }
}

// Helper to check if customer session should restart (15 minutes of inactivity)
async function shouldRestartSession(phoneNumber) {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { phoneNumber },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          take: 1,
          orderBy: { timestamp: 'desc' }
        }
      }
    });

    if (!conversation || !conversation.messages.length) {
      return true; // New customer or no messages
    }

    const lastMessage = conversation.messages[0];
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    
    return lastMessage.timestamp < fifteenMinutesAgo;
  } catch (error) {
    console.error('Error checking session restart:', error);
    return false; // Don't restart on error, continue conversation
  }
}

// Helper to clear pending order drafts when session restarts
async function clearPendingOrderDrafts(phoneNumber) {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { phoneNumber },
      orderBy: { createdAt: 'desc' }
    });

    if (conversation) {
      await prisma.orderDraft.deleteMany({
        where: {
          conversationId: conversation.id,
          status: 'IN_PROGRESS'
        }
      });
    }
  } catch (error) {
    console.error('Error clearing order drafts:', error);
  }
}

// Helper to get customer type for personalized greetings
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

// Helper to detect greeting messages
function isGreeting(message) {
  const lower = message.trim().toLowerCase();
  const greetings = [
    'hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 
    'hello', 'hi', 'saludos', 'holi', 'holis', 'qué tal', 'que tal', 
    'quiero hacer un pedido', 'buen día', 'buen dia'
  ];
  return greetings.some(greet => lower.startsWith(greet));
}

// Helper to handle personalized greetings
async function handleGreeting(phoneNumber) {
  try {
    const customerType = await getCustomerType(phoneNumber);
    const customer = await prisma.customerProfile.findUnique({ where: { phoneNumber } });
    const config = await getOrCreateConfig(); // Use the safe config getter
    const menuLink = `${APP_URL}/menu?phone=${phoneNumber}`;
    
    // Clear any pending drafts when greeting (session restart)
    await clearPendingOrderDrafts(phoneNumber);
    
    switch (customerType) {
      case 'NEW_CUSTOMER':
        return `¡Hola! 👋 Bienvenido a *${config.restaurantName}* 🇦🇷

Podés pedir de dos formas:

1️⃣ *Por chat*: Decime qué querés y te ayudo a armar el pedido.
2️⃣ *Por link*: Mirá el menú digital y pedí directo acá:
${menuLink}

¿Qué te gustaría pedir hoy?`;

      case 'RETURNING_CUSTOMER': {
        let lastOrder = null;
        if (customer?.lastOrderId) {
          lastOrder = await prisma.order.findUnique({ where: { id: customer.lastOrderId } });
        }
        let lastOrderSummary = '';
        if (lastOrder) {
          const items = Array.isArray(lastOrder.items) ? lastOrder.items : [];
          lastOrderSummary = items.map(i => `${i.quantity}x ${i.name || i.itemName}`).join(' + ');
        }
        return `¡Hola de nuevo! 😊 Bienvenido a *${config.restaurantName}*

¿Cómo querés ordenar hoy?

🔄 Repetir tu último pedido${lastOrderSummary ? ` (${lastOrderSummary})` : ''}
📱 Menú digital: ${menuLink}
💬 Decime algo nuevo

¿Qué prefieres?`;
      }

      case 'VIP_CUSTOMER': {
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
        return `¡Hola${customer?.name ? ' ' + customer.name : ''}! 🌟 Bienvenido a *${config.restaurantName}*

🔄 Lo de siempre${lastOrderSummary ? ` (${lastOrderSummary})` : ''}
⭐ Tus favoritos: ${favorites || 'Sin favoritos aún'}
📱 Menú completo: ${menuLink}
💬 Algo diferente hoy

¿Qué te provoca? 😋`;
      }

      default:
        return `¡Hola! Bienvenido a *${config.restaurantName}* 

¿Qué te gustaría pedir hoy?

📱 Menú digital: ${menuLink}
💬 Decime qué querés`;
    }
  } catch (error) {
    console.error('Error handling greeting:', error);
    return '¡Hola! ¿En qué te puedo ayudar hoy?';
  }
}

// Helper to get menu items from config
async function getMenuItems() {
  try {
    const config = await getOrCreateConfig(); // Use the safe config getter
    let menuItems = config?.menuItems;
    
    if (!menuItems) return [];
    
    if (!Array.isArray(menuItems)) {
      if (typeof menuItems === 'string') {
        try { 
          menuItems = JSON.parse(menuItems); 
        } catch { 
          menuItems = []; 
        }
      } else if (typeof menuItems === 'object' && menuItems !== null) {
        menuItems = Object.values(menuItems).every(i => typeof i === 'object' && i.name) 
          ? Object.values(menuItems) 
          : [];
      } else {
        menuItems = [];
      }
    }
    
    return menuItems;
  } catch (error) {
    console.error('Error getting menu items:', error);
    return [];
  }
}

// Helper to save interaction for analytics
async function saveInteraction(phoneNumber, userMessage, botResponse) {
  try {
    // Find or create conversation
    let conversation = await prisma.conversation.findFirst({
      where: { phoneNumber },
      orderBy: { createdAt: 'desc' }
    });
    
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { phoneNumber, status: 'BOT_ACTIVE' }
      });
    }

    // Save the interaction
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: 'BOT',
        content: botResponse.response,
        timestamp: new Date(),
        geminiResponse: {
          aiService: botResponse.aiService || 'openai_intelligent',
          intent: botResponse.intent || 'unknown',
          confidence: botResponse.confidence || 0.9,
          originalMessage: userMessage
        }
      }
    });
  } catch (error) {
    console.error('Error saving interaction:', error);
  }
}

// Helper to update customer profile (using ONLY existing schema fields)
async function updateCustomerProfile(phoneNumber) {
  try {
    await prisma.customerProfile.upsert({
      where: { phoneNumber },
      update: {
        updatedAt: new Date() // Only update timestamp using existing field
      },
      create: {
        phoneNumber,
        orderCount: 0,
        totalSpent: 0,
        averageOrderValue: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error updating customer profile:', error);
  }
}

/**
 * MAIN MESSAGE HANDLER - NOW WITH INTELLIGENT AI PROCESSING
 * This replaces the old regex-based system with true natural language understanding
 */
export async function handleIncomingMessage(msg, client) {
  try {
    const phoneNumber = msg.from;
    const messageContent = msg.body?.trim();
    
    console.log(`\n🤖 NEW MESSAGE from ${phoneNumber}: "${messageContent}"`);
    
    if (!messageContent) {
      await msg.reply('No recibí ningún mensaje. ¿Podrías escribir qué querés pedir?');
      return;
    }

    // Update customer interaction
    await updateCustomerProfile(phoneNumber);

    // Check if session should restart due to inactivity (15 minutes)
    const shouldRestart = await shouldRestartSession(phoneNumber);
    
    // Handle greetings with personalized responses OR if session should restart
    if (isGreeting(messageContent) || shouldRestart) {
      const greetingResponse = await handleGreeting(phoneNumber);
      await msg.reply(greetingResponse);
      
      await saveInteraction(phoneNumber, messageContent, {
        response: greetingResponse,
        intent: shouldRestart ? 'session_restart' : 'greeting',
        aiService: 'intelligent_simple'
      });
      return;
    }

    // Get menu items for order processing
    const menuItems = await getMenuItems();
    
    if (menuItems.length === 0) {
      const config = await getOrCreateConfig();
      await msg.reply(`El menú no está disponible en este momento. Por favor contacta a *${config.restaurantName}* directamente.`);
      return;
    }

    console.log(`📋 Loaded ${menuItems.length} menu items`);

    // 🚀 USE THE NEW INTELLIGENT PROCESSOR
    const response = await intelligentProcessor.processOrder(messageContent, phoneNumber, menuItems);
    
    console.log(`🧠 AI Response:`, response);

    // Send response to user
    await msg.reply(response.response);

    // Save interaction for analytics
    await saveInteraction(phoneNumber, messageContent, response);

    // If order was confirmed, update customer stats
    if (response.intent === 'order_confirmed') {
      try {
        await prisma.customerProfile.upsert({
          where: { phoneNumber },
          update: {
            orderCount: { increment: 1 },
            lastOrderDate: new Date()
          },
          create: {
            phoneNumber,
            orderCount: 1,
            lastOrderDate: new Date(),
            totalSpent: 0,
            averageOrderValue: 0
          }
        });
      } catch (error) {
        console.error('Error updating customer order stats:', error);
      }
    }

  } catch (error) {
    console.error('❌ CRITICAL ERROR in message handler:', error);
    
    try {
      await msg.reply('Disculpa, tuve un problema técnico. ¿Podrías intentar de nuevo en un momento? 🔧');
    } catch (replyError) {
      console.error('Failed to send error message:', replyError);
    }
  }
} 