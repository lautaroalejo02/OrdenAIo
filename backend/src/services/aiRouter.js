import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

class AIRouter {
  constructor() {
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.currentCosts = 0;
    this.monthlyBudget = 35;
    // Cache responses for 5 minutes
    this.responseCache = new Map();
  }

  async processMessage(message, phoneNumber, menuItems) {
    console.log(`[AI-ROUTER] Processing: "${message}"`);
    // Check cache first
    const cacheKey = this.getCacheKey(message, phoneNumber);
    if (this.responseCache.has(cacheKey)) {
      console.log('[AI-ROUTER] Using cached response');
      return this.responseCache.get(cacheKey);
    }
    // Determine which AI to use
    const aiChoice = this.selectAI(message);
    console.log(`[AI-ROUTER] Using: ${aiChoice}`);
    let result;
    try {
      switch (aiChoice) {
        case 'groq':
          result = await this.processWithGroq(message, phoneNumber, menuItems);
          break;
        case 'openai':
          result = await this.processWithOpenAI(message, phoneNumber, menuItems);
          break;
        default:
          result = await this.processWithGemini(message, phoneNumber, menuItems);
      }
      // Cache successful results
      if (result && result.success) {
        this.responseCache.set(cacheKey, result);
        setTimeout(() => this.responseCache.delete(cacheKey), 300000); // 5 min
      }
      return result;
    } catch (error) {
      console.error(`[AI-ROUTER] Error with ${aiChoice}:`, error);
      // Fallback to Gemini if others fail
      if (aiChoice !== 'gemini') {
        return await this.processWithGemini(message, phoneNumber, menuItems);
      }
      throw error;
    }
  }

  selectAI(message) {
    const msg = message.toLowerCase();
    // Use OpenAI for complex cases
    if (msg.length > 150 || 
        /problema|queja|devoluci[oó]n|error|complica/i.test(msg) ||
        /explica.*detallado|no.*entiendo|ayuda.*especial/i.test(msg)) {
      return 'openai';
    }
    // Use Gemini for medium complexity  
    if (/(sin|con|extra|cambiar|quitar|agregar|modifica)/i.test(msg) ||
        msg.split(' ').length > 8) {
      return 'gemini';
    }
    // Use Groq for simple cases (most common)
    return 'groq';
  }

  async processWithGroq(message, phoneNumber, menuItems) {
    const prompt = this.buildGroqPrompt(message, menuItems);
    const completion = await this.groq.chat.completions.create({
      messages: [
        { role: "system", content: "Eres un asistente de restaurante. SIEMPRE responde en JSON válido." },
        { role: "user", content: prompt }
      ],
      model: "llama3-8b-8192",
      temperature: 0.1,
      max_tokens: 600
    });
    return this.parseGroqResponse(completion.choices[0].message.content);
  }

  async processWithOpenAI(message, phoneNumber, menuItems) {
    if (this.currentCosts > this.monthlyBudget * 0.7) {
      console.log('[AI-ROUTER] OpenAI budget limit, using Gemini');
      return await this.processWithGemini(message, phoneNumber, menuItems);
    }
    const completion = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: this.buildOpenAISystemPrompt(menuItems) },
        { role: "user", content: message }
      ],
      temperature: 0.2,
      max_tokens: 800,
      response_format: { type: "json_object" }
    });
    const cost = (completion.usage.total_tokens / 1000) * 0.15;
    this.currentCosts += cost;
    const result = JSON.parse(completion.choices[0].message.content);
    return { ...result, cost, aiService: 'openai' };
  }

  async processWithGemini(message, phoneNumber, menuItems) {
    // Use existing Gemini function but with enhanced prompt
    const enhancedPrompt = this.buildGeminiPrompt(message, menuItems);
    // Import and use your existing processWithGemini function
    const { processWithGemini } = await import('../services/gemini.js');
    const response = await processWithGemini({ body: enhancedPrompt }, phoneNumber);
    return {
      success: true,
      response: response,
      intent: this.detectIntent(message),
      aiService: 'gemini'
    };
  }

  buildGroqPrompt(message, menuItems) {
    const menuText = menuItems.slice(0, 8).map(item => 
      `${item.id}: ${item.name} - $${item.price}`
    ).join('\n');
    return `RESTAURANTE MENU:\n${menuText}\n\nMENSAJE DEL CLIENTE: "${message}"\n\nAnaliza el mensaje y responde en JSON:\n{\n  "intent": "order|question|greeting|complaint",\n  "success": true,\n  "extractedItems": [\n    {"itemId": "1", "itemName": "Pizza", "quantity": 2}\n  ],\n  "response": "Respuesta natural aquí",\n  "confidence": 0.9,\n  "needsHuman": false\n}\n\nREGLAS:\n- Si detectas productos, inclúyelos en extractedItems\n- Si no entiendes bien, pon needsHuman: true\n- Respuesta siempre amigable con emojis\n- Si es saludo, responde cordialmente`;
  }

  buildOpenAISystemPrompt(menuItems) {
    return `Eres un asistente experto de restaurante. Analiza mensajes de clientes y responde en JSON.\n\nMENÚ DISPONIBLE:\n${menuItems.map(item => `${item.id}: ${item.name} - $${item.price} - ${item.description || ''}`).join('\n')}\n\nResponde SIEMPRE en este formato JSON:\n{\n  "intent": "order|question|greeting|complaint|modification",\n  "success": true,\n  "extractedItems": [{"itemId": "X", "itemName": "Y", "quantity": Z, "modifiers": []}],\n  "response": "Tu respuesta natural",\n  "confidence": 0.9,\n  "suggestedActions": ["confirm_order", "ask_address"],\n  "needsHuman": false\n}\n\nSé empático, profesional y útil. Maneja quejas con cuidado.`;
  }

  buildGeminiPrompt(message, menuItems) {
    return `CONTEXTO: Eres asistente de restaurante inteligente.\n\nMENÚ: ${menuItems.slice(0, 5).map(i => `${i.name} ($${i.price})`).join(', ')}\n\nMENSAJE: "${message}"\n\nINSTRUCCIONES:\n1. Si es un pedido, identifica productos y cantidades\n2. Si es una pregunta, responde directamente  \n3. Si es una queja, sé empático y ofrece solución\n4. Siempre sé amigable y usa emojis apropiados\n5. Si no estás seguro, pide aclaración\n\nResponde de manera natural y conversacional.`;
  }

  parseGroqResponse(response) {
    try {
      // Clean response to extract JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : response;
      const parsed = JSON.parse(jsonStr);
      return {
        success: parsed.success || true,
        intent: parsed.intent || 'unknown',
        items: parsed.extractedItems || [],
        response: parsed.response || 'No entendí bien tu mensaje.',
        confidence: parsed.confidence || 0.7,
        needsHuman: parsed.needsHuman || false,
        aiService: 'groq'
      };
    } catch (error) {
      console.error('[AI-ROUTER] Error parsing Groq response:', error);
      return {
        success: false,
        response: 'Disculpa, no entendí bien. ¿Puedes repetir?',
        confidence: 0.1,
        aiService: 'groq'
      };
    }
  }

  detectIntent(message) {
    const msg = message.toLowerCase();
    if (/(hola|buenas|buenos)/i.test(msg)) return 'greeting';
    if (/(quiero|necesito|pedido|dame)/i.test(msg)) return 'order';
    if (/(problema|queja|mal|error)/i.test(msg)) return 'complaint';
    return 'question';
  }

  getCacheKey(message, phoneNumber) {
    return `${phoneNumber}_${message.toLowerCase().replace(/\d+/g, 'N').substring(0, 30)}`;
  }
}

export default AIRouter; 