import express from 'express';

const router = express.Router();

// GET /api/dashboard/health - health check endpoint
router.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Add more dashboard endpoints as needed

export default router; 