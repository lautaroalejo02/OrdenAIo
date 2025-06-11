import express from 'express';
import { PrismaClient } from '@prisma/client';
import IntelligentOrderProcessor from '../services/intelligentOrderProcessor.js';

const router = express.Router();
const prisma = new PrismaClient();

// Initialize the intelligent processor for restaurant status
const processor = new IntelligentOrderProcessor(process.env.OPENAI_API_KEY);

// Endpoint to serve menu data for the React frontend
router.get('/data', async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) {
      return res.status(400).json({
        error: 'Phone number required',
        code: 'MISSING_PHONE',
      });
    }

    // Retrieve restaurant configuration from the database
    const config = await prisma.restaurantConfig.findFirst();
    if (!config) {
      return res.status(500).json({
        error: 'Restaurant configuration not found',
        code: 'NO_CONFIG',
      });
    }

    // Use intelligent restaurant status instead of fixed isOpen field
    const restaurantStatus = processor.isRestaurantOpen(config);

    // Parse menu items from configuration
    let menuItems = [];
    try {
      menuItems = typeof config.menuItems === 'string'
        ? JSON.parse(config.menuItems)
        : config.menuItems || [];
    } catch (error) {
      console.error('Error parsing menu items:', error);
      menuItems = [];
    }

    // Respond with menu and restaurant data
    res.json({
      restaurant: {
        name: config.restaurantName || 'Our Restaurant',
        isOpen: restaurantStatus.open,
        phone: process.env.WHATSAPP_NUMBER,
        outOfHoursMessage: restaurantStatus.message || config.outOfHoursMessage,
      },
      menu: menuItems,
      customerPhone: phone,
      success: true,
    });
  } catch (error) {
    console.error('Error loading menu data:', error);
    res.status(500).json({
      error: 'Server error loading menu',
      code: 'SERVER_ERROR',
    });
  }
});

// Health check endpoint for the menu service
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'menu-api',
    timestamp: new Date().toISOString(),
  });
});

export default router; 