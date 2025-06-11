import express from 'express';
import prisma from '../utils/database.js';
import { adminAuth } from '../middleware/auth.js';

const router = express.Router();

// Helper to normalize config for frontend
function normalizeConfig(config) {
  if (!config) return config;
  return {
    ...config,
    menuItems: typeof config.menuItems === 'string' ? JSON.parse(config.menuItems) : config.menuItems,
    openingHours: typeof config.openingHours === 'string' ? JSON.parse(config.openingHours) : config.openingHours,
    deliveryZones: typeof config.deliveryZones === 'string' ? JSON.parse(config.deliveryZones) : config.deliveryZones,
    preparationTimes: typeof config.preparationTimes === 'string' ? JSON.parse(config.preparationTimes) : config.preparationTimes,
    autoResponses: typeof config.autoResponses === 'string' ? JSON.parse(config.autoResponses) : (config.autoResponses || {}),
    bannedNumbers: config.bannedNumbers || [],
    escalationKeywords: config.escalationKeywords || [],
    filterKeywords: config.filterKeywords || [],
  };
}

// Helper to validate menu items
function validateMenuItems(menuItems) {
  if (!Array.isArray(menuItems)) return false;
  return menuItems.every(item => typeof item === 'object' && item.name && typeof item.name === 'string');
}

// GET /api/config - get restaurant configuration
router.get('/', async (req, res) => {
  try {
    const config = await prisma.restaurantConfig.findFirst();
    res.json(normalizeConfig(config));
  } catch (error) {
    res.status(500).json({ error: true, message: 'Internal server error.' });
  }
});

// PUT /api/config - update restaurant configuration (admin only)
router.put('/', adminAuth, async (req, res) => {
  try {
    const data = req.body;
    // Validate menuItems
    if (data.menuItems) {
      if (typeof data.menuItems === 'string') data.menuItems = JSON.parse(data.menuItems);
      if (!validateMenuItems(data.menuItems)) {
        return res.status(400).json({ error: true, message: 'Invalid menuItems format. Must be an array of items with name.' });
      }
      data.menuItems = JSON.stringify(data.menuItems);
    }
    // Ensure JSON fields are stringified for Prisma
    if (data.openingHours && typeof data.openingHours !== 'string') data.openingHours = JSON.stringify(data.openingHours);
    if (data.deliveryZones && typeof data.deliveryZones !== 'string') data.deliveryZones = JSON.stringify(data.deliveryZones);
    if (data.preparationTimes && typeof data.preparationTimes !== 'string') data.preparationTimes = JSON.stringify(data.preparationTimes);
    // Handle autoResponses as JSON
    if (data.autoResponses && typeof data.autoResponses !== 'string') data.autoResponses = JSON.stringify(data.autoResponses);
    // Arrays
    if (data.bannedNumbers && !Array.isArray(data.bannedNumbers)) data.bannedNumbers = [];
    if (data.escalationKeywords && !Array.isArray(data.escalationKeywords)) data.escalationKeywords = [];
    if (data.filterKeywords && !Array.isArray(data.filterKeywords)) data.filterKeywords = [];
    const config = await prisma.restaurantConfig.findFirst();
    if (!config) {
      return res.status(404).json({ error: true, message: 'Configuration not found.' });
    }
    const updated = await prisma.restaurantConfig.update({
      where: { id: config.id },
      data,
    });
    res.json(normalizeConfig(updated));
  } catch (error) {
    res.status(500).json({ error: true, message: 'Internal server error.' });
  }
});

export default router; 