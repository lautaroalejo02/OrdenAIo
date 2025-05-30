// Message filter utility for WhatsApp bot
// Filters out irrelevant, spam, or off-topic messages before sending to AI

import prisma from '../utils/database.js';

let cachedKeywords = null;
let lastFetch = 0;
const CACHE_DURATION_MS = 60 * 1000; // 1 minute

async function getFilterKeywords() {
  const now = Date.now();
  if (!cachedKeywords || now - lastFetch > CACHE_DURATION_MS) {
    const config = await prisma.restaurantConfig.findFirst();
    cachedKeywords = Array.isArray(config?.filterKeywords) ? config.filterKeywords : [];
    lastFetch = now;
  }
  return cachedKeywords;
}

export const messageFilter = {
  async isRelevant(message) {
    if (!message || typeof message !== 'string') return false;
    const lower = message.toLowerCase();
    const keywords = await getFilterKeywords();
    if (!keywords.length) return true; // If no keywords, allow all
    return keywords.some((kw) => lower.includes(kw.toLowerCase()));
  },
}; 