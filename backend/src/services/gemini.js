import { GoogleGenerativeAI } from '@google/generative-ai';
import prisma from '../utils/database.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// System prompt template for restaurant context (Spanish)
const systemPrompt = `
Eres un asistente amigable de WhatsApp para {restaurant_name}, un restaurante especializado en pedidos a domicilio.

IDIOMA:
- Responde SIEMPRE en español, de forma natural y profesional.

CONFIGURACIÓN ACTUAL:
- Estado del restaurante: {is_open}
- Horario: {opening_hours}
- Menú: {menu_items}
- Zonas de entrega: {delivery_zones}
- Tiempos de preparación: {preparation_times}
- Método de recepción de pedidos: {order_method}

PERSONALIDAD Y TONO:
- {bot_tone}
- Usa emojis apropiados (🍕🍔🥤)
- Respuestas concisas pero completas
- Termina siempre con una llamada a la acción

RESPONSABILIDADES PRINCIPALES:
1. Ayudar a los clientes a hacer pedidos de comida
2. Proporcionar información del menú y precios
3. Calcular totales incluyendo delivery
4. Confirmar dirección y datos de contacto
5. Estimar tiempos de entrega según preparación y ubicación

ESCALADO:
- Si el cliente pide hablar con un humano, detecta y notifica
- Si hay quejas, problemas de pago o solicitudes complejas, sugiere escalar

FORMATO DE RESPUESTA:
- Máximo 150 palabras
- Estructura clara con saltos de línea
- Confirma detalles antes de procesar
- Incluye precio total y tiempo estimado

LÍMITES ESTRICTOS:
- Solo habla de pedidos, menú, delivery y servicios del restaurante
- No converses de temas personales, política o ajenos
- Si insisten en temas ajenos, responde: "{unrelated_message}"
- Nunca inventes productos o precios

CONTEXTO DEL CLIENTE:
- Si es cliente frecuente, sugiere "lo de siempre"
- Recuerda direcciones y preferencias
`;

// Simple string similarity (Levenshtein distance)
function getLevenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return matrix[a.length][b.length];
}

function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  const distance = getLevenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

export function findBestMenuMatch(userText, menuItems) {
  if (!Array.isArray(menuItems) || !menuItems.length) return null;
  const normalized = userText.toLowerCase();
  let best = null;
  let bestScore = -Infinity;
  let bestDistance = Infinity;
  let secondBestScore = -Infinity;
  let secondBestName = null;
  for (const item of menuItems) {
    const name = item.name.toLowerCase();
    const sim = similarity(normalized, name);
    const dist = getLevenshtein(normalized, name);
    if (sim > bestScore || (sim === bestScore && dist < bestDistance)) {
      secondBestScore = bestScore;
      secondBestName = best ? best.name : null;
      bestScore = sim;
      bestDistance = dist;
      best = item;
    }
  }
  return { best, bestScore, bestDistance, secondBestScore, secondBestName };
}

function truncateResponse(text, maxLength = 220) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export async function processWithGemini(prompt, phoneNumber, menuItems, conversationId = null) {
  let contextMessages = [];
  if (conversationId) {
    // Fetch last 10 messages from the conversation
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'asc' },
      take: 10
    });
    contextMessages = messages.map(m => ({
      role: m.sender === 'CUSTOMER' ? 'user' : 'assistant',
      content: m.content
    }));
  }
  // Compose the full prompt for Gemini
  const fullPrompt = [
    ...contextMessages,
    { role: 'user', content: prompt }
  ];
  // Call Gemini with fullPrompt instead of just prompt
  // ... (rest of your Gemini API call logic, using fullPrompt)
  // ... existing code ...
}

/**
 * Uses Gemini AI to extract structured order info from a user's message.
 * @param {string} message - The user's message
 * @param {Array} menuItems - The menu items to match against
 * @param {Array} lastOrders - The user's last orders (optional)
 * @returns {Promise<Array<{itemName: string, quantity: number}>>}
 */
export async function extractOrderWithGemini(message, menuItems, lastOrders = []) {
  // Build a clear, robust prompt for Gemini
  let prompt = `Eres un asistente de pedidos de restaurante. Extrae los productos y cantidades que el usuario quiere pedir del siguiente mensaje. Responde SOLO en JSON, con un array de objetos con 'itemName' y 'quantity'.\n\nEjemplo de respuesta:\n[\n  { \"itemName\": \"empanada de carne\", \"quantity\": 12 },\n  { \"itemName\": \"pizza muzzarella\", \"quantity\": 1 }\n]\n\nMENSAJE DEL USUARIO:\n\"${message}\"\n\nMENU:\n${menuItems.map(i => `- ${i.name}`).join('\\n')}\n`;
  if (lastOrders && lastOrders.length > 0) {
    prompt += `\nHISTORIAL DE PEDIDOS ANTERIORES:\n${lastOrders.map(o => `- ${o.items.map(i => `${i.quantity} ${i.name}`).join(', ')}`).join('\\n')}`;
  }
  // Use Gemini to get the structured order
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  console.log('[Gemini] Calling Gemini for order extraction...');
  try {
    const resultPromise = model.generateContent([prompt]);
    // Timeout logic
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini timeout')), 10000));
    const result = await Promise.race([resultPromise, timeoutPromise]);
    const response = result.response.text();
    console.log('[Gemini] Response:', response);
    // Try to parse the JSON from Gemini's response
    const jsonStart = response.indexOf('[');
    const jsonEnd = response.lastIndexOf(']') + 1;
    if (jsonStart !== -1 && jsonEnd !== -1) {
      const json = response.slice(jsonStart, jsonEnd);
      return JSON.parse(json);
    }
  } catch (e) {
    console.error('[Gemini] Extraction error:', e);
    return [];
  }
  return [];
} 