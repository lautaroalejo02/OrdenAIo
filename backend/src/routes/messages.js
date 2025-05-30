import express from 'express';
import { handleIncomingMessage } from '../whatsapp/messageHandler.js';

const router = express.Router();

// POST /api/messages - receive and process a WhatsApp message
router.post('/', async (req, res) => {
  try {
    // Simulate WhatsApp message object for API testing
    const { from, body } = req.body;
    if (!from || !body) {
      return res.status(400).json({ error: true, message: 'Missing required fields: from, body.' });
    }
    // Call the same handler as the WhatsApp bot
    await handleIncomingMessage({ from, body, reply: (msg) => res.json({ reply: msg }) });
  } catch (error) {
    res.status(500).json({ error: true, message: 'Internal server error.' });
  }
});

export default router; 