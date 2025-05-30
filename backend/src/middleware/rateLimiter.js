import { rateLimiter } from '../services/rateLimiter.js';

// Express middleware for rate limiting per phone number
export async function rateLimitMiddleware(req, res, next) {
  const phoneNumber = req.body.phoneNumber || req.query.phoneNumber;
  if (!phoneNumber) {
    return res.status(400).json({ error: true, message: 'Missing phone number for rate limiting.' });
  }
  const allowed = await rateLimiter.check(phoneNumber);
  if (!allowed) {
    return res.status(429).json({ error: true, message: 'Too many requests. Please try again later.' });
  }
  next();
} 