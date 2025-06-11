// WhatsApp Client Instance for External Use
// This module exports the WhatsApp client instance to be used by other services

let whatsappClientInstance = null;

/**
 * Initialize WhatsApp client and return instance
 */
export async function initializeWhatsAppClient() {
  try {
    const pkg = await import('whatsapp-web.js');
    const { Client, LocalAuth } = pkg.default;

    // Create WhatsApp client configuration
    const client = new Client({
      authStrategy: new LocalAuth({
        dataPath: process.env.WHATSAPP_SESSION_PATH || './whatsapp-session',
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });

    // Store instance globally
    whatsappClientInstance = client;
    
    return client;
  } catch (error) {
    console.error('Error initializing WhatsApp client:', error);
    throw error;
  }
}

/**
 * Get current WhatsApp client instance
 */
export function getWhatsAppClient() {
  return whatsappClientInstance;
}

/**
 * Send message using the WhatsApp client
 */
export async function sendMessage(phoneNumber, message) {
  try {
    if (!whatsappClientInstance) {
      console.warn('WhatsApp client not initialized yet');
      return false;
    }

    // Check if client is ready
    if (!whatsappClientInstance.info) {
      console.warn('WhatsApp client not ready yet');
      return false;
    }

    await whatsappClientInstance.sendMessage(phoneNumber, message);
    console.log(`📤 Message sent to ${phoneNumber}`);
    return true;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    return false;
  }
}

/**
 * Check if WhatsApp client is ready
 */
export function isClientReady() {
  return whatsappClientInstance && whatsappClientInstance.info;
}

/**
 * Set the client instance (used by bot.js)
 */
export function setClientInstance(client) {
  whatsappClientInstance = client;
}

// Default export object with all methods
const whatsappClient = {
  initializeWhatsAppClient,
  getWhatsAppClient,
  sendMessage,
  isClientReady,
  setClientInstance
};

export default whatsappClient; 