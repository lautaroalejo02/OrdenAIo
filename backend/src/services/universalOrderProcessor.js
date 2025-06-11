// UNIVERSAL ORDER PROCESSOR - Works for any restaurant, any product
import { PrismaClient } from '@prisma/client';
import { Groq } from 'groq-sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

const prisma = new PrismaClient();

class UniversalOrderProcessor {
  constructor() {
    this.menuItems = [];
    this.aiService = null;
  }

  /**
   * Main method: Processes any order for any restaurant
   * Context is persisted in DB (orderDrafts, conversation, etc)
   * Now with robust debugging and step-by-step extraction logic
   */
  async processOrder(message, phoneNumber, menuItems, aiService) {
    console.log(`\n==================== PROCESSING ORDER ====================`);
    console.log(`Message: "${message}"`);
    console.log(`Phone: ${phoneNumber}`);
    console.log(`Menu items:`, menuItems.map(item => `${item.id}: ${item.name}`));
    this.menuItems = menuItems;
    this.aiService = aiService;
    let context;
    try {
      context = await this.getContext(phoneNumber);
    } catch (err) {
      console.error('Error getting context:', err);
      context = { activeOrder: null, lastProducts: [], phoneNumber };
    }
    // 2. Detect simple intents
    const simpleIntent = await this.detectSimpleIntents(message, context, phoneNumber);
    if (simpleIntent) return simpleIntent;
    // 3. Step 1: Extract quantities
    console.log(`\n--- STEP 1: EXTRACTING QUANTITIES ---`);
    const quantities = this.extractQuantitiesDetailed(message);
    console.log(`Quantities found:`, quantities);
    // 4. Step 2: Extract products
    console.log(`\n--- STEP 2: EXTRACTING PRODUCTS ---`);
    let products = this.extractProductsDetailed(message, menuItems);
    console.log(`Products found:`, products);
    // If no products found, but there is an active draft, use last product from draft
    if (products.length === 0 && context && context.activeOrder && context.activeOrder.items.length > 0) {
      const lastDraftItem = context.activeOrder.items[context.activeOrder.items.length - 1];
      if (lastDraftItem) {
        const menuItem = menuItems.find(m => m.id.toString() === lastDraftItem.itemId);
        if (menuItem) {
          products = [{ product: menuItem, confidence: 1, source: 'draft_context' }];
          console.log('No product found in message, using last draft item:', menuItem.name);
        }
      }
    }
    // If products are all generic (e.g., "empanadas") and there are multiple menu matches, ask for clarification with menu items
    if (products.length > 1 && products.every(p => p.confidence < 0.8)) {
      return {
        success: true,
        intent: 'clarification',
        response: `¿De qué sabor? Tenemos:\n` + products.map(p => `• ${p.product.name}`).join('\n'),
        aiService: 'universal_hybrid'
      };
    }
    // 5. Step 3: Combine quantities and products
    console.log(`\n--- STEP 3: COMBINING QUANTITIES WITH PRODUCTS ---`);
    const orderItems = this.combineDetailedLogging(quantities, products, message);
    console.log(`Final order items:`, orderItems);
    // 6. Process result
    if (orderItems.length > 0) {
      console.log(`\n--- SUCCESS: Processing valid order ---`);
      return await this.handleValidOrder(orderItems, phoneNumber, message);
    } else {
      console.log(`\n--- FALLBACK: Using AI analysis ---`);
      return await this.handleWithAIFallback(message, phoneNumber, menuItems);
    }
  }

  /**
   * EXTRACCIÓN DE CANTIDADES CON LOGGING DETALLADO
   */
  extractQuantitiesDetailed(message) {
    console.log(`Extracting quantities from: "${message}"`);
    const text = message.toLowerCase().trim();
    const quantities = [];
    // PATRONES ESPECÍFICOS PARA EMPANADAS (más adelante generalizar)
    const patterns = [
      // Pattern for 'n docenas y media' (e.g., '2 docenas y media' = 30)
      {
        name: 'n_docenas_y_media',
        regex: /(\d+)\s*docenas?\s*y\s*media/gi,
        value: 'n_docenas_y_media',
        confidence: 1.0
      },
      {
        name: 'media_docena',
        regex: /media\s+docena/gi,
        value: 6,
        confidence: 1.0
      },
      {
        name: 'una_docena',
        regex: /(?:una\s+)?docena/gi,
        value: 12,
        confidence: 1.0
      },
      {
        name: 'dos_docenas',
        regex: /dos\s+docenas/gi,
        value: 24,
        confidence: 1.0
      },
      {
        name: 'docena_y_media',
        regex: /docena\s+y\s+media/gi,
        value: 18,
        confidence: 1.0
      },
      {
        name: 'numero_explicito',
        regex: /\b(\d+)\b/gi,
        value: 'extract',
        confidence: 0.9
      },
      {
        name: 'palabras_numericas',
        regex: /\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/gi,
        value: 'word_to_number',
        confidence: 0.8
      }
    ];
    const wordToNumber = {
      'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
      'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10
    };
    for (const pattern of patterns) {
      console.log(`  Checking pattern: ${pattern.name}`);
      const matches = [...text.matchAll(pattern.regex)];
      console.log(`    Found ${matches.length} matches`);
      for (const match of matches) {
        let quantity;
        // Handle 'n docenas y media' pattern
        if (pattern.value === 'n_docenas_y_media') {
          const n = parseInt(match[1], 10);
          if (!isNaN(n) && n > 0 && n < 100) {
            quantity = n * 12 + 6;
          } else {
            continue;
          }
        } else if (pattern.value === 'extract') {
          quantity = parseInt(match[1], 10);
          if (isNaN(quantity) || quantity <= 0 || quantity > 100) {
            console.log(`    Skipping invalid number: ${match[1]}`);
            continue;
          }
        } else if (pattern.value === 'word_to_number') {
          quantity = wordToNumber[match[1].toLowerCase()];
          if (!quantity) {
            console.log(`    Unknown word number: ${match[1]}`);
            continue;
          }
        } else {
          quantity = pattern.value;
        }
        quantities.push({
          value: quantity,
          confidence: pattern.confidence,
          source: pattern.name,
          matchText: match[0],
          position: match.index
        });
        console.log(`    Added quantity: ${quantity} from "${match[0]}" (${pattern.name})`);
      }
    }
    // Deduplicate
    const deduped = this.deduplicateQuantities(quantities);
    console.log(`  Final quantities after dedup:`, deduped.map(q => `${q.value}(${q.source})`));
    if (deduped.length === 0) {
      console.log(`  No quantities found, using default: 1`);
      deduped.push({
        value: 1,
        confidence: 0.5,
        source: 'default',
        matchText: 'default'
      });
    }
    return deduped;
  }

  /**
   * EXTRACCIÓN DE PRODUCTOS CON LOGGING DETALLADO
   */
  extractProductsDetailed(message, menuItems) {
    console.log(`Extracting products from: "${message}"`);
    console.log(`Available menu items:`, menuItems.map(item => item.name));
    const text = message.toLowerCase().trim();
    const products = [];
    for (const menuItem of menuItems) {
      console.log(`  Checking menu item: "${menuItem.name}"`);
      const score = this.calculateDetailedProductScore(text, menuItem);
      console.log(`    Score: ${score}`);
      if (score > 0.5) {
        products.push({
          product: menuItem,
          confidence: score,
          source: 'menu_match'
        });
        console.log(`    ✅ MATCHED: ${menuItem.name} with score ${score}`);
      } else {
        console.log(`    ❌ No match: ${menuItem.name} (score too low: ${score})`);
      }
    }
    console.log(`  Products found: ${products.length}`);
    return products;
  }

  /**
   * CÁLCULO DETALLADO DE SCORE DE PRODUCTO
   */
  calculateDetailedProductScore(text, menuItem) {
    let score = 0;
    const itemName = menuItem.name.toLowerCase();
    const itemDescription = (menuItem.description || '').toLowerCase();
    console.log(`    Calculating score for: "${itemName}"`);
    console.log(`    Against text: "${text}"`);
    if (text.includes(itemName)) {
      score += 1.0;
      console.log(`      +1.0 for exact name match`);
    }
    const nameWords = itemName.split(/\s+/).filter(word => 
      word.length > 2 && !['de', 'con', 'y', 'del', 'la', 'el'].includes(word)
    );
    console.log(`      Key words from name: [${nameWords.join(', ')}]`);
    for (const word of nameWords) {
      if (text.includes(word)) {
        score += 0.4;
        console.log(`      +0.4 for keyword match: "${word}"`);
      }
    }
    if (itemDescription) {
      const descWords = itemDescription.split(/\s+/).filter(word => 
        word.length > 3 && !['de', 'con', 'y', 'del', 'la', 'el', 'para'].includes(word)
      );
      for (const word of descWords) {
        if (text.includes(word)) {
          score += 0.2;
          console.log(`      +0.2 for description match: "${word}"`);
        }
      }
    }
    if (itemName.includes('empanada')) {
      if (text.includes('pollo') && itemName.includes('pollo')) {
        score += 0.5;
        console.log(`      +0.5 for pollo-specific match`);
      }
      if (text.includes('carne') && itemName.includes('carne')) {
        score += 0.5;
        console.log(`      +0.5 for carne-specific match`);
      }
    }
    const finalScore = Math.min(score, 1.0);
    console.log(`      Final score: ${finalScore}`);
    return finalScore;
  }

  /**
   * COMBINACIÓN CON LOGGING DETALLADO
   */
  combineDetailedLogging(quantities, products, message) {
    console.log(`Combining ${quantities.length} quantities with ${products.length} products`);
    console.log(`Quantities:`, quantities.map(q => q.value));
    console.log(`Products:`, products.map(p => p.product.name));
    const combinations = [];
    if (products.length === 0) {
      console.log(`  No products found, cannot create order items`);
      return combinations;
    }
    if (this.isMultipleFlavorOrder(message)) {
      console.log(`  Detected multiple flavor order`);
      return this.handleMultipleFlavorOrder(quantities, products, message);
    }
    if (quantities.length === 1 && products.length === 1) {
      console.log(`  Simple case: 1 quantity + 1 product`);
      const combination = {
        itemId: products[0].product.id.toString(),
        itemName: products[0].product.name,
        quantity: quantities[0].value,
        price: products[0].product.price,
        confidence: Math.min(quantities[0].confidence, products[0].confidence)
      };
      combinations.push(combination);
      console.log(`  Created combination:`, combination);
    }
    else if (quantities.length >= 1 && products.length > 1) {
      console.log(`  Multiple products case`);
      const baseQuantity = quantities[0].value;
      for (const productInfo of products) {
        const combination = {
          itemId: productInfo.product.id.toString(),
          itemName: productInfo.product.name,
          quantity: baseQuantity,
          price: productInfo.product.price,
          confidence: Math.min(quantities[0].confidence, productInfo.confidence)
        };
        combinations.push(combination);
        console.log(`  Created combination:`, combination);
      }
    }
    else {
      console.log(`  Default case: using first quantity and first product`);
      const combination = {
        itemId: products[0].product.id.toString(),
        itemName: products[0].product.name,
        quantity: quantities[0].value,
        price: products[0].product.price,
        confidence: Math.min(quantities[0].confidence, products[0].confidence)
      };
      combinations.push(combination);
      console.log(`  Created combination:`, combination);
    }
    // If only one product, use the largest quantity found (most likely correct)
    if (products.length === 1 && quantities.length > 1) {
      // Sort quantities descending by value
      const sortedQuantities = [...quantities].sort((a, b) => b.value - a.value);
      const bestQuantity = sortedQuantities[0];
      console.log(`  Single product, multiple quantities. Using largest:`, bestQuantity);
      const combination = {
        itemId: products[0].product.id.toString(),
        itemName: products[0].product.name,
        quantity: bestQuantity.value,
        price: products[0].product.price,
        confidence: Math.min(bestQuantity.confidence, products[0].confidence)
      };
      combinations.push(combination);
      console.log(`  Created combination:`, combination);
      console.log(`  Final combinations: ${combinations.length} items`);
      return combinations.filter(combo => combo.confidence > 0.4);
    }
    console.log(`  Final combinations: ${combinations.length} items`);
    return combinations.filter(combo => combo.confidence > 0.4);
  }

  /**
   * DETECTA PEDIDOS CON MÚLTIPLES SABORES
   */
  isMultipleFlavorOrder(message) {
    const text = message.toLowerCase();
    const patterns = [
      /(\w+)\s+y\s+(\w+)/,  // "pollo y carne"
      /de\s+(\w+)\s+y.*de\s+(\w+)/, // "de pollo y ... de carne"
      /(\w+)\s*,\s*(\w+)/, // "pollo, carne"
    ];
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        console.log(`  Multiple flavor pattern matched: ${pattern}`);
        return true;
      }
    }
    return false;
  }

  /**
   * MANEJA PEDIDOS CON MÚLTIPLES SABORES
   */
  handleMultipleFlavorOrder(quantities, products, message) {
    console.log(`  Handling multiple flavor order`);
    const combinations = [];
    const text = message.toLowerCase();
    const mediasDocenas = text.match(/media\s+docena/gi);
    if (mediasDocenas && mediasDocenas.length > 1 && products.length > 1) {
      console.log(`  Found ${mediasDocenas.length} "media docena" for ${products.length} products`);
      for (let i = 0; i < Math.min(mediasDocenas.length, products.length); i++) {
        const combination = {
          itemId: products[i].product.id.toString(),
          itemName: products[i].product.name,
          quantity: 6, // media docena
          price: products[i].product.price,
          confidence: 0.9
        };
        combinations.push(combination);
        console.log(`  Created multi-flavor combination:`, combination);
      }
      return combinations;
    }
    const baseQuantity = quantities.length > 0 ? quantities[0].value : 1;
    for (const productInfo of products) {
      const combination = {
        itemId: productInfo.product.id.toString(),
        itemName: productInfo.product.name,
        quantity: baseQuantity,
        price: productInfo.product.price,
        confidence: Math.min(0.8, productInfo.confidence)
      };
      combinations.push(combination);
      console.log(`  Created fallback multi-flavor combination:`, combination);
    }
    return combinations;
  }

  /**
   * FALLBACK CON IA CUANDO FALLA EL PARSING
   */
  async handleWithAIFallback(message, phoneNumber, menuItems) {
    console.log(`\n--- AI FALLBACK ANALYSIS ---`);
    try {
      if (!this.aiService || !this.aiService.groq) {
        console.log(`No AI service available, using basic fallback`);
        return this.handleUnknownOrder(message, phoneNumber, menuItems);
      }
      const prompt = `El cliente dice: "${message}"
\nMenú disponible:\n${menuItems.map(item => `${item.id}: ${item.name} - $${item.price}`).join('\n')}
\nExtrae EXACTAMENTE qué quiere ordenar. Responde SOLO en JSON:\n{\n  "items": [\n    {"itemId": "1", "itemName": "Empanada de carne", "quantity": 6}\n  ],\n  "success": true\n}`;
      console.log(`Sending to AI:`, prompt);
      const completion = await this.aiService.groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: "Extrae pedidos de restaurante. Responde SOLO JSON válido sin texto adicional."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        model: "llama3-8b-8192",
        temperature: 0.1,
        max_tokens: 200
      });
      const response = completion.choices[0].message.content.trim();
      console.log(`AI Response:`, response);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const aiResult = JSON.parse(jsonMatch[0]);
        console.log(`Parsed AI result:`, aiResult);
        if (aiResult.success && aiResult.items && aiResult.items.length > 0) {
          const validItems = aiResult.items.filter(item => {
            const menuItem = menuItems.find(m => m.id.toString() === item.itemId);
            return menuItem && item.quantity > 0;
          });
          if (validItems.length > 0) {
            console.log(`AI successfully extracted valid items:`, validItems);
            return await this.handleValidOrder(validItems, phoneNumber, message);
          }
        }
      }
      throw new Error('AI did not provide valid result');
    } catch (error) {
      console.error(`AI fallback failed:`, error);
      return this.handleUnknownOrder(message, phoneNumber, menuItems);
    }
  }

  // --- REMAINING METHODS: DB context, confirmation, summary, etc. ---

  deduplicateQuantities(quantities) {
    const seen = new Map();
    for (const qty of quantities) {
      const key = qty.value;
      if (!seen.has(key) || seen.get(key).confidence < qty.confidence) {
        seen.set(key, qty);
      }
    }
    return Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get context from DB: active orderDrafts, last order, etc.
   */
  async getContext(phoneNumber) {
    const conversation = await prisma.conversation.findFirst({
      where: { phoneNumber, status: 'BOT_ACTIVE' },
      orderBy: { createdAt: 'desc' }
    });
    if (!conversation) return { activeOrder: null, lastProducts: [], phoneNumber };
    const drafts = await prisma.orderDraft.findMany({ where: { conversationId: conversation.id } });
    return {
      activeOrder: drafts.length > 0 ? { items: drafts } : null,
      lastProducts: drafts.map(d => ({ id: d.itemId, name: d.itemName })),
      phoneNumber,
      conversationId: conversation.id
    };
  }

  /**
   * Set context in DB: update orderDrafts for active order
   */
  async setContext(phoneNumber, context) {
    // Find or create conversation
    let conversation = await prisma.conversation.findFirst({
      where: { phoneNumber, status: 'BOT_ACTIVE' },
      orderBy: { createdAt: 'desc' }
    });
    if (!conversation) {
      conversation = await prisma.conversation.create({ data: { phoneNumber, status: 'BOT_ACTIVE' } });
    }
    // Remove old drafts
    await prisma.orderDraft.deleteMany({ where: { conversationId: conversation.id } });
    // Add new drafts
    if (context.activeOrder && context.activeOrder.items.length > 0) {
      for (const item of context.activeOrder.items) {
        await prisma.orderDraft.create({
          data: {
            conversationId: conversation.id,
            itemId: item.itemId ? item.itemId.toString() : null, // Always store as string
            itemName: item.itemName,
            quantity: item.quantity,
            // Store price and unit in extraData JSON
            extraData: {
              price: item.price || 0,
              unit: item.unit || 'unidades',
              confidence: item.confidence || undefined,
              // Add any other custom fields here if needed
            }
          }
        });
      }
    }
  }

  /**
   * Detect simple intents (greeting, confirm, cancel, menu, status)
   */
  async detectSimpleIntents(message, context, phoneNumber) {
    const msg = message.toLowerCase().trim();
    // Confirmations
    if (/(sí|si|yes|confirmo|perfecto|listo|ok|dale|va|está bien|correcto)/i.test(msg)) {
      if (context && context.activeOrder && context.activeOrder.items.length > 0) {
        return await this.confirmOrder(phoneNumber);
      }
    }
    // Cancellations
    if (/(no|cancel|cancela|olvid|mejor.*después|cambio.*idea|borra|elimina)/i.test(msg)) {
      if (context && context.activeOrder) {
        return await this.cancelOrder(phoneNumber);
      }
    }
    // Order status
    if (/(pedido|orden|resumen|total|cuanto|cuánto|que.*tengo|mi.*orden)/i.test(msg)) {
      if (context && context.activeOrder && context.activeOrder.items.length > 0) {
        return await this.getOrderStatus(phoneNumber);
      }
    }
    // Menu
    if (/(menu|carta|ver.*menu|que.*tienen|opciones|disponible|mostrar|lista)/i.test(msg)) {
      return this.showMenu();
    }
    // Greeting
    if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches|hello|hi|saludos|holi|holis|qué tal|que tal|quiero hacer un pedido)/i.test(msg)) {
      // Reset context: delete all drafts for this user
      if (context && context.conversationId) {
        await prisma.orderDraft.deleteMany({ where: { conversationId: context.conversationId } });
      }
      return this.buildGreeting(phoneNumber);
    }
    return null;
  }

  /**
   * Build personalized greeting (Argentinian style, menu link, etc)
   */
  async buildGreeting(phoneNumber) {
    const APP_URL = process.env.APP_URL && process.env.APP_URL !== '' ? process.env.APP_URL : 'http://localhost:5173';
    const menuLink = `${APP_URL}/menu?phone=${phoneNumber}`;
    // Check if user is returning or VIP
    const customer = await prisma.customerProfile.findUnique({ where: { phoneNumber } });
    let customerType = 'NEW_CUSTOMER';
    if (customer) {
      if (customer.orderCount >= 10) customerType = 'VIP_CUSTOMER';
      else if (customer.orderCount > 0) customerType = 'RETURNING_CUSTOMER';
    }
    if (customerType === 'NEW_CUSTOMER') {
      return {
        success: true,
        intent: 'greeting',
        response: `¡Hola! 👋 Bienvenido a nuestro restaurante 🇦🇷\n\nPodés pedir de dos formas:\n\n1️⃣ *Por chat*: Decime qué querés y te ayudo a armar el pedido.\n2️⃣ *Por link*: Mirá el menú digital y pedí directo acá:\n${menuLink}\n\n¿Qué te gustaría pedir hoy?`,
        aiService: 'universal_hybrid'
      };
    } else if (customerType === 'RETURNING_CUSTOMER') {
      let lastOrder = null;
      if (customer?.lastOrderId) {
        lastOrder = await prisma.order.findUnique({ where: { id: customer.lastOrderId } });
      }
      let lastOrderSummary = '';
      if (lastOrder) {
        const items = Array.isArray(lastOrder.items) ? lastOrder.items : [];
        lastOrderSummary = items.map(i => `${i.quantity}x ${i.name || i.itemName}`).join(' + ');
      }
      return {
        success: true,
        intent: 'greeting',
        response: `¡Hola de nuevo! 😊 ¿Cómo quieres ordenar hoy?\n\n🔄 Repetir tu último pedido${lastOrderSummary ? ` (${lastOrderSummary} - $${lastOrder?.totalAmount || ''})` : ''}\n📱 Menú digital: ${menuLink}\n💬 Decime algo nuevo\n\n¿Qué prefieres?`,
        aiService: 'universal_hybrid'
      };
    } else if (customerType === 'VIP_CUSTOMER') {
      let lastOrder = null;
      if (customer?.lastOrderId) {
        lastOrder = await prisma.order.findUnique({ where: { id: customer.lastOrderId } });
      }
      let lastOrderSummary = '';
      if (lastOrder) {
        const items = Array.isArray(lastOrder.items) ? lastOrder.items : [];
        lastOrderSummary = items.map(i => `${i.quantity}x ${i.name || i.itemName}`).join(' + ');
      }
      const favorites = (customer?.favoriteItems || []).slice(0, 3).join(', ');
      return {
        success: true,
        intent: 'greeting',
        response: `¡Hola${customer?.name ? ' ' + customer.name : ''}! 🌟\n\n🔄 Lo de siempre${lastOrderSummary ? ` (${lastOrderSummary})` : ''}\n⭐ Tus favoritos: ${favorites || 'Sin favoritos aún'}\n📱 Menú completo: ${menuLink}\n💬 Algo diferente hoy\n\n¿Qué te provoca? 😋`,
        aiService: 'universal_hybrid'
      };
    }
    return {
      success: true,
      intent: 'greeting',
      response: `¡Hola! ¿Qué te gustaría pedir hoy?\n\n📱 Menú digital: ${menuLink}\n💬 Decime qué quieres`,
      aiService: 'universal_hybrid'
    };
  }

  /**
   * Handle valid order: persist in DB, update drafts, return summary
   */
  async handleValidOrder(orderItems, phoneNumber, originalMessage) {
    // Find or create conversation
    let conversation = await prisma.conversation.findFirst({
      where: { phoneNumber, status: 'BOT_ACTIVE' },
      orderBy: { createdAt: 'desc' }
    });
    if (!conversation) {
      conversation = await prisma.conversation.create({ data: { phoneNumber, status: 'BOT_ACTIVE' } });
    }
    // Get existing drafts for this conversation
    const existingDrafts = await prisma.orderDraft.findMany({ where: { conversationId: conversation.id } });
    // Map for quick lookup by itemId
    const draftMap = new Map();
    for (const draft of existingDrafts) {
      if (draft.itemId) draftMap.set(draft.itemId, draft);
    }
    // Add or update drafts
    for (const item of orderItems) {
      const itemIdStr = item.itemId ? item.itemId.toString() : null;
      if (itemIdStr && draftMap.has(itemIdStr)) {
        // If exists, increment quantity
        const existing = draftMap.get(itemIdStr);
        await prisma.orderDraft.update({
          where: { id: existing.id },
          data: {
            quantity: (existing.quantity || 0) + item.quantity,
            // Optionally update extraData (e.g., price, confidence)
            extraData: {
              price: item.price || 0,
              unit: item.unit || 'unidades',
              confidence: item.confidence || undefined,
              // Add any other custom fields here if needed
            }
          }
        });
      } else {
        // If not exists, create new draft
        await prisma.orderDraft.create({
          data: {
            conversationId: conversation.id,
            itemId: itemIdStr,
            itemName: item.itemName,
            quantity: item.quantity,
            extraData: {
              price: item.price || 0,
              unit: item.unit || 'unidades',
              confidence: item.confidence || undefined,
              // Add any other custom fields here if needed
            }
          }
        });
      }
    }
    // Build summary
    const summary = this.buildOrderSummary({ items: orderItems });
    return {
      success: true,
      intent: 'order',
      items: orderItems,
      response: `✅ ¡Perfecto! He agregado a tu pedido:\n\n${summary}\n\n¿Querés agregar algo más o confirmar el pedido?`,
      orderSummary: this.calculateOrderSummary({ items: orderItems }),
      aiService: 'universal_hybrid'
    };
  }

  /**
   * Handle unknown order: fallback response
   */
  handleUnknownOrder(message, phoneNumber, aiAnalysis) {
    return {
      success: true,
      intent: 'clarification',
      response: 'No entendí bien tu pedido. Podés decirme algo como: "2 pizzas margarita" o "medio kilo de asado"',
      aiService: 'universal_hybrid'
    };
  }

  /**
   * Confirm order: finalize in DB, clear drafts
   */
  async confirmOrder(phoneNumber) {
    let conversation = await prisma.conversation.findFirst({
      where: { phoneNumber, status: 'BOT_ACTIVE' },
      orderBy: { createdAt: 'desc' }
    });
    if (!conversation) {
      return {
        success: false,
        intent: 'error',
        response: 'No tenés ningún pedido activo para confirmar.',
        aiService: 'universal_hybrid'
      };
    }
    const drafts = await prisma.orderDraft.findMany({ where: { conversationId: conversation.id } });
    if (!drafts || drafts.length === 0) {
      return {
        success: false,
        intent: 'error',
        response: 'No tenés ningún pedido activo para confirmar.',
        aiService: 'universal_hybrid'
      };
    }
    // Create order
    const total = drafts.reduce((sum, i) => sum + (i.extraData?.price || 0) * (i.quantity || 1), 0);
    const itemCount = drafts.reduce((sum, i) => sum + (i.quantity || 1), 0);
    const order = await prisma.order.create({
      data: {
        conversationId: conversation.id,
        items: JSON.stringify(drafts.map(d => ({
          itemId: d.itemId,
          itemName: d.itemName,
          quantity: d.quantity,
          // Extract price and unit from extraData if present
          price: d.extraData?.price || 0,
          unit: d.extraData?.unit || 'unidades',
          confidence: d.extraData?.confidence || undefined
        })) ),
        total,
        status: 'confirmed',
        customerPhone: phoneNumber,
        itemCount
      }
    });
    // Clear drafts
    await prisma.orderDraft.deleteMany({ where: { conversationId: conversation.id } });
    // Build summary
    const summary = this.buildOrderSummary({ items: drafts });
    return {
      success: true,
      intent: 'confirm_order',
      orderSummary: { items: drafts, total, itemCount },
      response: `🎉 ¡PEDIDO CONFIRMADO!\n\n${summary}\n\n✅ Tu pedido fue enviado. Te contactamos pronto para coordinar la entrega.`,
      aiService: 'universal_hybrid'
    };
  }

  /**
   * Cancel order: clear drafts
   */
  async cancelOrder(phoneNumber) {
    let conversation = await prisma.conversation.findFirst({
      where: { phoneNumber, status: 'BOT_ACTIVE' },
      orderBy: { createdAt: 'desc' }
    });
    if (conversation) {
      await prisma.orderDraft.deleteMany({ where: { conversationId: conversation.id } });
    }
    return {
      success: true,
      intent: 'cancel_order',
      response: '❌ Pedido cancelado. ¿Hay algo más en lo que pueda ayudarte?',
      aiService: 'universal_hybrid'
    };
  }

  /**
   * Get order status: show current draft
   */
  async getOrderStatus(phoneNumber) {
    let conversation = await prisma.conversation.findFirst({
      where: { phoneNumber, status: 'BOT_ACTIVE' },
      orderBy: { createdAt: 'desc' }
    });
    if (!conversation) {
      return {
        success: true,
        intent: 'no_order',
        response: 'No tenés ningún pedido activo en este momento.',
        aiService: 'universal_hybrid'
      };
    }
    const drafts = await prisma.orderDraft.findMany({ where: { conversationId: conversation.id } });
    if (!drafts || drafts.length === 0) {
      return {
        success: true,
        intent: 'no_order',
        response: 'No tenés ningún pedido activo en este momento.',
        aiService: 'universal_hybrid'
      };
    }
    const summary = this.buildOrderSummary({ items: drafts });
    return {
      success: true,
      intent: 'order_status',
      response: `${summary}\n\n¿Querés agregar algo más o confirmar el pedido?`,
      aiService: 'universal_hybrid'
    };
  }

  /**
   * Show menu: group by category, show up to 8 per category
   */
  showMenu() {
    if (!this.menuItems || this.menuItems.length === 0) {
      return {
        success: true,
        intent: 'show_menu',
        response: 'Disculpa, estoy cargando el menú. Intentá en un momento.',
        aiService: 'universal_hybrid'
      };
    }
    let response = '📋 **NUESTRO MENÚ:**\n\n';
    const categories = this.groupByCategory(this.menuItems);
    for (const [category, items] of Object.entries(categories)) {
      if (category !== 'sin_categoria') {
        response += `**${category.toUpperCase()}:**\n`;
      }
      items.slice(0, 8).forEach(item => {
        const emoji = this.getUniversalEmoji(item);
        response += `${emoji} **${item.name}** - $${item.price.toLocaleString()}\n`;
        if (item.description) {
          response += `   📝 ${item.description.substring(0, 50)}${item.description.length > 50 ? '...' : ''}\n`;
        }
      });
      if (items.length > 8) {
        response += `   ... y ${items.length - 8} opciones más\n`;
      }
      response += '\n';
    }
    response += '💬 **¿Qué te gustaría ordenar?** Solo decime el producto y la cantidad.';
    return {
      success: true,
      intent: 'show_menu',
      response,
      aiService: 'universal_hybrid'
    };
  }

  // --- Helpers from artifact (groupByCategory, getUniversalEmoji, buildOrderSummary, calculateOrderSummary, buildContextForAI, buildMenuForAI, basicAnalysis) ---
  groupByCategory(items) {
    const grouped = {};
    for (const item of items) {
      const category = item.category || 'sin_categoria';
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push(item);
    }
    return grouped;
  }

  getUniversalEmoji(item) {
    const name = item.name.toLowerCase();
    const category = (item.category || '').toLowerCase();
    const description = (item.description || '').toLowerCase();
    const text = `${name} ${category} ${description}`;
    if (text.includes('pizza')) return '🍕';
    if (text.includes('hamburger') || text.includes('burger')) return '🍔';
    if (text.includes('empanada')) return '🥟';
    if (text.includes('taco')) return '🌮';
    if (text.includes('sushi')) return '🍣';
    if (text.includes('pasta') || text.includes('fideos') || text.includes('spaguetti')) return '🍝';
    if (text.includes('ensalada')) return '🥗';
    if (text.includes('sandwich') || text.includes('sándwich')) return '🥪';
    if (text.includes('hot dog')) return '🌭';
    if (text.includes('pollo') || text.includes('chicken')) return '🍗';
    if (text.includes('pescado') || text.includes('fish')) return '🐟';
    if (text.includes('carne') || text.includes('beef') || text.includes('steak')) return '🥩';
    if (text.includes('helado') || text.includes('ice cream')) return '🍦';
    if (text.includes('torta') || text.includes('cake')) return '🍰';
    if (text.includes('café') || text.includes('coffee')) return '☕';
    if (text.includes('cerveza') || text.includes('beer')) return '🍺';
    if (text.includes('vino') || text.includes('wine')) return '🍷';
    if (text.includes('agua') || text.includes('water')) return '💧';
    if (text.includes('jugo') || text.includes('juice')) return '🧃';
    if (text.includes('refresco') || text.includes('soda') || text.includes('coca')) return '🥤';
    return '🍽️';
  }

  buildOrderSummary(order) {
    if (!order || !order.items || order.items.length === 0) {
      return '🛒 Pedido vacío';
    }
    let summary = '🛒 **TU PEDIDO ACTUAL:**\n';
    let total = 0;
    let totalItems = 0;
    order.items.forEach(item => {
      const itemTotal = item.price * item.quantity;
      total += itemTotal;
      totalItems += item.quantity;
      const emoji = this.getUniversalEmoji({ name: item.itemName });
      const unit = item.unit && item.unit !== 'unidades' ? ` ${item.unit}` : '';
      summary += `${emoji} ${item.quantity}${unit} **${item.itemName}** - $${itemTotal.toLocaleString()}\n`;
    });
    summary += `\n💰 **TOTAL: $${total.toLocaleString()}** (${totalItems} items)`;
    return summary;
  }

  calculateOrderSummary(order) {
    let total = 0;
    let totalItems = 0;
    const items = order.items.map(item => {
      const itemTotal = item.price * item.quantity;
      total += itemTotal;
      totalItems += item.quantity;
      return { ...item, itemTotal };
    });
    return { items, total, itemCount: totalItems };
  }

  buildContextForAI(context) {
    if (!context || !context.activeOrder) {
      return 'Cliente nuevo, sin pedidos anteriores.';
    }
    const orderSummary = context.activeOrder.items.map(item => `${item.quantity}x ${item.itemName}`).join(', ');
    return `Cliente tiene pedido activo: ${orderSummary}`;
  }

  buildMenuForAI(menuItems) {
    return menuItems.slice(0, 10).map(item => `${item.id}: ${item.name} - $${item.price}${item.category ? ` (${item.category})` : ''}`).join('\n');
  }

  basicAnalysis(message) {
    return {
      intent: 'order',
      extractedQuantities: [],
      extractedProducts: [],
      isModification: false,
      contextualClues: [],
      suggestedResponse: null,
      confidence: 0.5
    };
  }

  // Overwrite the old stubs to ensure only the new logic is used
  extractUniversalQuantities(message) {
    // DEPRECATED: Use extractQuantitiesDetailed instead
    return this.extractQuantitiesDetailed(message);
  }

  async findProducts(message, aiAnalysis, menuItems) {
    // DEPRECATED: Use extractProductsDetailed instead
    return this.extractProductsDetailed(message, menuItems);
  }

  combineQuantitiesWithProducts(quantities, products, message, context) {
    // DEPRECATED: Use combineDetailedLogging instead
    return this.combineDetailedLogging(quantities, products, message);
  }
}

export default UniversalOrderProcessor; 