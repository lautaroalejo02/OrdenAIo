import express from 'express';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// Get escalated conversations
router.get('/escalations', async (req, res) => {
  try {
    const escalations = await prisma.conversation.findMany({
      where: { status: 'WAITING_HUMAN' },
      include: {
        messages: {
          orderBy: { timestamp: 'desc' },
          take: 5
        }
      },
      orderBy: { updatedAt: 'desc' }
    });
    res.json({ success: true, escalations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Respond to escalation
router.post('/escalations/:id/respond', async (req, res) => {
  try {
    const { id } = req.params;
    const { response } = req.body;
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    // Send response (implement sendWhatsAppMessage if needed)
    // await sendWhatsAppMessage(conversation.phoneNumber, response);
    await prisma.conversation.update({ where: { id }, data: { status: 'BOT_ACTIVE' } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router; 