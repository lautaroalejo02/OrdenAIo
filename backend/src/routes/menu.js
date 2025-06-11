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
    console.log(`📋 Menu API called from origin: ${req.get('Origin')}`);
    console.log(`📋 Menu API query params:`, req.query);
    
    const { phone } = req.query;
    if (!phone) {
      console.log('❌ No phone provided');
      return res.status(400).json({
        error: 'Phone number required',
        code: 'MISSING_PHONE',
      });
    }

    console.log(`📋 Loading menu for phone: ${phone}`);

    // Retrieve restaurant configuration from the database
    const config = await prisma.restaurantConfig.findFirst();
    if (!config) {
      console.log('❌ No restaurant config found');
      return res.status(500).json({
        error: 'Restaurant configuration not found',
        code: 'NO_CONFIG',
      });
    }

    console.log(`✅ Found config for: ${config.restaurantName}`);

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

    console.log(`📋 Returning ${menuItems.length} menu items. Restaurant open: ${restaurantStatus.open}`);

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
    console.error('❌ Error loading menu data:', error);
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

// Simple test endpoint to verify CORS and basic connectivity
router.get('/test', (req, res) => {
  console.log(`🧪 Test endpoint called from origin: ${req.get('Origin')}`);
  res.json({
    message: 'Menu API is working!',
    timestamp: new Date().toISOString(),
    origin: req.get('Origin'),
    userAgent: req.get('User-Agent'),
    success: true
  });
});

export default router; 