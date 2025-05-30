import express from 'express';
import prisma from '../utils/database.js';
import { adminAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/customers - list all customers (admin only)
router.get('/', adminAuth, async (req, res) => {
  try {
    const customers = await prisma.customerProfile.findMany();
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: true, message: 'Internal server error.' });
  }
});

// GET /api/customers/:phoneNumber - get customer by phone number (admin only)
router.get('/:phoneNumber', adminAuth, async (req, res) => {
  try {
    const customer = await prisma.customerProfile.findUnique({ where: { phoneNumber: req.params.phoneNumber } });
    if (!customer) {
      return res.status(404).json({ error: true, message: 'Customer not found.' });
    }
    res.json(customer);
  } catch (error) {
    res.status(500).json({ error: true, message: 'Internal server error.' });
  }
});

export default router; 