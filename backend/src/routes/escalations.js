import express from 'express';
import prisma from '../utils/database.js';
import { adminAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/escalations - list all escalated conversations (admin only)
router.get('/', adminAuth, async (req, res) => {
  try {
    const escalated = await prisma.conversation.findMany({
      where: { status: 'HUMAN_TAKEOVER' },
    });
    res.json(escalated);
  } catch (error) {
    res.status(500).json({ error: true, message: 'Internal server error.' });
  }
});

// PUT /api/escalations/:id - assign human agent to conversation (admin only)
router.put('/:id', adminAuth, async (req, res) => {
  try {
    const { humanAssigned } = req.body;
    const conversation = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { status: 'WAITING_HUMAN', humanAssigned },
    });
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: true, message: 'Internal server error.' });
  }
});

export default router; 