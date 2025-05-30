import express from 'express';
import prisma from '../utils/database.js';
import { adminAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/orders - list all orders (admin only)
router.get('/', adminAuth, async (req, res) => {
  try {
    const orders = await prisma.order.findMany();
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: true, message: 'Internal server error.' });
  }
});

// GET /api/orders/:id - get order by id (admin only)
router.get('/:id', adminAuth, async (req, res) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) {
      return res.status(404).json({ error: true, message: 'Order not found.' });
    }
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: true, message: 'Internal server error.' });
  }
});

// PUT /api/orders/:id - update order status (admin only)
router.put('/:id', adminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: true, message: 'Internal server error.' });
  }
});

export default router; 