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

    // Get menu items for order processing
    const menuItems = await getMenuItems();
    
    if (menuItems.length === 0) {
      const config = await getOrCreateConfig();
      await msg.reply(`El menú no está disponible en este momento. Por favor contacta a *${config.restaurantName}* directamente.`);
      return;
    }

    console.log(`📋 Loaded ${menuItems.length} menu items`);

    // 🚀 USE THE NEW INTELLIGENT PROCESSOR FOR ALL MESSAGES
    // The processor handles greetings, session restarts, orders, and everything intelligently
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