import express from 'express';
import prisma from '../utils/database.js';
import { adminAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/keywords - get escalation and filter keywords
router.get('/', async (req, res) => {
  try {
    const config = await prisma.restaurantConfig.findFirst();
    res.json({ keywords: config?.escalationKeywords || [] });
  } catch (error) {
    res.status(500).json({ error: true, message: 'Internal server error.' });
  }
});

// PUT /api/keywords - update escalation and filter keywords (admin only)
router.put('/', adminAuth, async (req, res) => {
  try {
    const { keywords } = req.body;
    const config = await prisma.restaurantConfig.findFirst();
    if (!config) {
      return res.status(404).json({ error: true, message: 'Configuration not found.' });
    }
    const updated = await prisma.restaurantConfig.update({
      where: { id: config.id },
      data: { escalationKeywords: keywords },
    });
    res.json({ keywords: updated.escalationKeywords });
  } catch (error) {
    res.status(500).json({ error: true, message: 'Internal server error.' });
  }
});

export default router; 