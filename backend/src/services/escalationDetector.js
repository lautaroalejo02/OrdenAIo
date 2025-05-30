// Escalation detector for WhatsApp bot
// Detects if a message should be escalated to a human agent

import prisma from '../utils/database.js';

let cachedTriggers = null;
let lastFetch = 0;
const CACHE_DURATION_MS = 60 * 1000; // 1 minute

async function getEscalationTriggers() {
  const now = Date.now();
  if (!cachedTriggers || now - lastFetch > CACHE_DURATION_MS) {
    const config = await prisma.restaurantConfig.findFirst();
    cachedTriggers = Array.isArray(config?.escalationKeywords) ? config.escalationKeywords : [];
    lastFetch = now;
  }
  return cachedTriggers;
}

export const escalationDetector = {
  async shouldEscalate(message) {
    if (!message || typeof message !== 'string') return false;
    const lower = message.toLowerCase();
    const triggers = await getEscalationTriggers();
    if (!triggers.length) return false;
    return triggers.some((kw) => lower.includes(kw.toLowerCase()));
  },
}; 