import { createClient } from 'redis';
import prisma from '../utils/database.js';

const redis = createClient({ url: process.env.REDIS_URL });
redis.connect();

export const rateLimiter = {
  async check(phoneNumber) {
    // Fetch dynamic limit from config
    const config = await prisma.restaurantConfig.findFirst();
    const MAX_MESSAGES_PER_HOUR = config?.maxMessagesPerHour || 10;
    const key = `rate:${phoneNumber}`;
    let count = await redis.get(key);
    if (!count) {
      await redis.set(key, 1, { EX: 3600 }); // 1 hour expiry
      return true;
    }
    if (parseInt(count, 10) >= MAX_MESSAGES_PER_HOUR) {
      return false;
    }
    await redis.incr(key);
    return true;
  },
}; 