import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

class IntelligentOrderProcessor {
  constructor(openaiApiKey) {
    this.openai = new OpenAI({
      apiKey: openaiApiKey || process.env.OPENAI_API_KEY
    });
  }

  /**
   * Main method to process orders using OpenAI's intelligence
   * This replaces the regex-based system with true natural language understanding
   */
  async processOrder(message, phoneNumber, menuItems) {
    console.log(`\n==================== INTELLIGENT ORDER PROCESSING ====================`);
    console.log(`Message: "${message}"`);
    console.log(`Phone: ${phoneNumber}`);
    
    try {
      // Get conversation context
      const context = await this.getContext(phoneNumber);
      
      // Get restaurant configuration
      const restaurantConfig = await this.getRestaurantConfig();
      
      // Check if restaurant is open
      const isOpen = this.isRestaurantOpen(restaurantConfig);
      if (!isOpen.open) {
        return {
          success: true,
          intent: 'closed',
          response: isOpen.message,
          aiService: 'intelligent_simple'
        };
      }
      
      // Check for simple intents first (menu, confirm, cancel, etc.)
      const simpleIntent = await this.detectSimpleIntents(message, context, restaurantConfig);
      if (simpleIntent) return simpleIntent;

      // Use OpenAI to understand the order
      const orderResult = await this.analyzeOrderWithAI(message, menuItems, context, restaurantConfig);
      
      // Check if OpenAI detected off-topic content
      if (orderResult.off_topic) {
        return {
          success: true,
          intent: 'off_topic',
          response: orderResult.suggested_response || 'Hola! Acá te ayudo solo con pedidos del restaurante. ¿Te gustaría ver nuestro menú?',
          aiService: 'openai_intelligent'
        };
      }
      
      if (orderResult.success) {
        return await this.handleValidOrder(orderResult, phoneNumber, message, restaurantConfig);
      } else {
        return await this.handleAmbiguousOrder(orderResult, phoneNumber, menuItems);
      }
      
    } catch (error) {
      console.error('Error processing order:', error);
      return {
        success: false,
        intent: 'error',
        response: 'Disculpa, hubo un error procesando tu pedido. ¿Podrías repetir qué querés pedir?',
        aiService: 'openai_intelligent'
      };
    }
  }

  /**
   * Get restaurant configuration from database
   */
  async getRestaurantConfig() {
    try {
      const config = await prisma.restaurantConfig.findFirst();
      return config;
    } catch (error) {
      console.error('Error getting restaurant config:', error);
      return null;
    }
  }

  /**
   * Check if restaurant is open and return appropriate message
   */
  isRestaurantOpen(config) {
    if (!config || !config.openingHours) {
      return { open: true, message: null };
    }

    const now = new Date();
    const currentDay = now.toLocaleDateString('es-AR', { weekday: 'long' }).toLowerCase();
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM format

    // Convert English day names to Spanish
    const dayMapping = {
      'monday': 'lunes',
      'tuesday': 'martes', 
      'wednesday': 'miércoles',
      'thursday': 'jueves',
      'friday': 'viernes',
      'saturday': 'sábado',
      'sunday': 'domingo'
    };

    let hours;
    try {
      hours = typeof config.openingHours === 'string' 
        ? JSON.parse(config.openingHours) 
        : config.openingHours;
    } catch {
      return { open: true, message: null };
    }

    // Check if we have hours for today (try both English and Spanish keys)
    const todayHoursEn = hours[Object.keys(dayMapping).find(en => dayMapping[en] === currentDay)];
    const todayHoursEs = hours[currentDay];
    const todayHours = todayHoursEn || todayHoursEs;

    if (!todayHours || !todayHours.open || !todayHours.close) {
      return { 
        open: false, 
        message: `🕙 Estamos cerrados hoy (${currentDay}). \n\n📅 Nuestros horarios:\n${this.formatOpeningHours(hours)}\n\n¡Te esperamos pronto! 😊`
      };
    }

    // Handle cross-midnight hours (e.g., 18:00-04:00 or 08:00-04:00)
    if (todayHours.close < todayHours.open) {
      // Cross-midnight schedule: open if time >= open OR time <= close
      const isOpen = currentTime >= todayHours.open || currentTime <= todayHours.close;
      
      if (!isOpen) {
        // Closed during the gap (e.g., between 04:01 and 17:59)
        return {
          open: false,
          message: `🕙 Estamos cerrados en este momento.\n\n📅 Hoy (${currentDay}) atendemos de ${todayHours.open} a ${todayHours.close}hs\n\n¡Te esperamos en nuestro horario de atención! 😊`
        };
      }
    } else {
      // Normal schedule: open if time >= open AND time <= close
      if (currentTime < todayHours.open || currentTime > todayHours.close) {
        return {
          open: false,
          message: `🕙 Estamos cerrados en este momento.\n\n📅 Hoy (${currentDay}) atendemos de ${todayHours.open} a ${todayHours.close}hs\n\n¡Te esperamos en nuestro horario de atención! 😊`
        };
      }
    }

    return { open: true, message: null };
  }

  /**
   * Format opening hours in Spanish
   */
  formatOpeningHours(hours) {
    const dayMapping = {
      'monday': 'Lunes',
      'tuesday': 'Martes', 
      'wednesday': 'Miércoles',
      'thursday': 'Jueves',
      'friday': 'Viernes',
      'saturday': 'Sábado',
      'sunday': 'Domingo'
    };

    let schedule = '';
    for (const [englishDay, spanishDay] of Object.entries(dayMapping)) {
      const dayHours = hours[englishDay.toLowerCase()] || hours[spanishDay.toLowerCase()];
      if (dayHours && dayHours.open && dayHours.close) {
        schedule += `${spanishDay}: ${dayHours.open} - ${dayHours.close}hs\n`;
      } else {
        schedule += `${spanishDay}: Cerrado\n`;
      }
    }
    return schedule;
  }

  /**
   * Use OpenAI to analyze the order with true natural language understanding
   */
  async analyzeOrderWithAI(message, menuItems, context, restaurantConfig) {
    const menuFormatted = menuItems.map(item => ({
      id: item.id,
      name: item.name,
      price: item.price,
      description: item.description || '',
      category: item.category || 'General'
    }));

    const existingOrder = context.activeOrder ? 
      context.activeOrder.items.map(item => ({
        itemId: item.itemId,
        itemName: item.itemName,
        quantity: item.quantity
      })) : [];

    const prompt = this.buildAnalysisPrompt(message, menuFormatted, existingOrder, restaurantConfig);

    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o", // Using the latest and most capable model
        messages: [
          {
            role: "system",
            content: this.getSystemPrompt(restaurantConfig)
          },
          {
            role: "user", 
            content: prompt
          }
        ],
        temperature: 0.2, // Slightly higher for more natural Argentine responses
        max_tokens: 1000,
        response_format: { type: "json_object" }
      });

      const response = completion.choices[0].message.content;
      console.log('OpenAI Response:', response);
      
      const parsed = JSON.parse(response);
      return this.validateAndProcessAIResponse(parsed, menuItems);
      
    } catch (error) {
      console.error('OpenAI API error:', error);
      throw error;
    }
  }

  /**
   * System prompt with Argentine personality and restaurant context
   */
  getSystemPrompt(restaurantConfig) {
    const restaurantName = restaurantConfig?.restaurantName || 'nuestro restaurante';
    
    return `Sos un asistente virtual argentino que ayuda EXCLUSIVAMENTE con pedidos para ${restaurantName}.

TU PERSONALIDAD:
- Hablás con tono argentino, amable y bueno
- Usás expresiones típicas argentinas pero sin exagerar
- Sos servicial y paciente con los clientes
- Te gusta ayudar y hacer sentir cómodo al cliente
- SOS PROACTIVO: ayudás sin hacer muchas preguntas

TU TRABAJO ESPECÍFICO:
- SOLO procesar pedidos y responder consultas del restaurante
- SER MUY FLEXIBLE y asumir cosas razonables
- Si alguien dice "una docena de empanadas" y hay 2 sabores, ofrecer MIX en lugar de preguntar
- Si no especifica sabor y hay pocas opciones, SUGERIR directamente en lugar de preguntar
- Entender cantidades en español: "una docena"=12, "media docena"=6, "docena y media"=18
- Usar los tiempos de preparación y zonas de delivery de la configuración del restaurante

REGLAS PARA SER MENOS QUISQUILLOSO:
1. Si dice "empanadas" sin cantidad, asumir que quiere algunas (3-6) y sugerir
2. Si dice cantidad sin sabor y hay 2-3 opciones, OFRECER MIX o las más populares
3. Si hay ambigüedad menor, hacer suposiciones razonables
4. SOLO pedir clarificación si es absolutamente necesario
5. Ser más resolutivo que preguntón

EJEMPLOS BUENOS (menos quisquilloso):
- "una docena de empanadas" → "¡Dale! ¿Te hago mitad carne y mitad pollo? ¿O preferís un solo sabor?"
- "quiero empanadas" → "¡Perfecto! ¿Te parece media docena? Tenemos de carne y pollo."
- "dos docenas" → "¡Bárbaro! ¿Te armo una docena de cada sabor (carne y pollo)?"

MANEJO DE MODIFICACIONES DEL PEDIDO EXISTENTE:
CRÍTICO: Si hay un PEDIDO EXISTENTE, analizá cuidadosamente si el cliente quiere MODIFICAR el pedido actual.

Frases de MODIFICACIÓN (no son off-topic):
- "mejor solamente deja las de carne" → QUITAR todo excepto empanadas de carne
- "solo quiero las de pollo" → QUITAR todo excepto empanadas de pollo  
- "cambio las de pollo por carne" → REEMPLAZAR pollo por carne
- "mejor sin las bebidas" → QUITAR bebidas del pedido
- "agregale una coca" → AGREGAR coca al pedido existente
- "quita las empanadas de pollo" → REMOVER empanadas de pollo específicamente
- "sacá dos empanadas" → REDUCIR cantidad en 2

ACCIONES DE MODIFICACIÓN:
- REPLACE_ALL: cuando dice "solo", "solamente", "únicamente" → reemplazar TODO el pedido
- REMOVE_ITEM: cuando especifica quitar algo específico
- ADD_ITEM: cuando especifica agregar algo
- CHANGE_QUANTITY: cuando cambia cantidades

LIMITACIONES ESTRICTAS:
- NO responder preguntas sobre otros temas (política, deportes, noticias, etc.)
- NO dar consejos que no sean sobre el menú del restaurante
- NO inventar productos que no estén en el menú
- Si te preguntan algo NO relacionado al restaurante, redirigir amablemente al menú

EJEMPLOS DE REDIRECCIÓN:
- "Hola! Acá te ayudo solo con pedidos del restaurante. ¿Te gustaría ver nuestro menú?"
- "Esa información no la tengo, pero puedo ayudarte con tu pedido. ¿Qué te gustaría comer?"

REGLAS CRÍTICAS:
1. Si hay PEDIDO EXISTENTE, priorizar modificaciones sobre nuevos pedidos
2. Ser específico con las cantidades y productos
3. SIEMPRE mantenerte en el contexto del restaurante
4. PRIORIZAR FLUIDEZ sobre precisión extrema

FORMATO DE RESPUESTA - Siempre responder con JSON válido:
{
  "success": true/false,
  "action": "ADD_ITEM|REPLACE_ALL|REMOVE_ITEM|CHANGE_QUANTITY",
  "items": [
    {
      "itemId": "id_del_menu",
      "itemName": "nombre_exacto_del_menu", 
      "quantity": numero,
      "confidence": 0.0-1.0
    }
  ],
  "remove_items": [
    {
      "itemId": "id_a_remover",
      "itemName": "nombre_del_item",
      "remove_all": true/false,
      "remove_quantity": numero_opcional
    }
  ],
  "clarification_needed": true/false,
  "clarification_question": "string o null",
  "reasoning": "breve explicación de tu análisis",
  "suggested_response": "respuesta amigable en tono argentino",
  "off_topic": true/false
}

Si el mensaje está fuera del contexto del restaurante, marcá "off_topic": true y redirigí amablemente.`;
  }

  /**
   * Build the specific prompt for order analysis with restaurant context
   */
  buildAnalysisPrompt(message, menuItems, existingOrder, restaurantConfig) {
    let prompt = `MENSAJE DEL CLIENTE: "${message}"

MENÚ DISPONIBLE:
${menuItems.map(item => `ID: ${item.id} | ${item.name} - $${item.price}${item.description ? ` | ${item.description}` : ''}${item.category ? ` | Categoría: ${item.category}` : ''}`).join('\n')}`;

    // Add preparation times if available
    if (restaurantConfig?.preparationTimes) {
      let prepTimes;
      try {
        prepTimes = typeof restaurantConfig.preparationTimes === 'string' 
          ? JSON.parse(restaurantConfig.preparationTimes) 
          : restaurantConfig.preparationTimes;
        
        prompt += `\n\nTIEMPOS DE PREPARACIÓN:
${Object.entries(prepTimes).map(([category, time]) => `${category}: ${time} minutos`).join('\n')}`;
      } catch (error) {
        console.log('Error parsing preparation times:', error);
      }
    }

    // Add delivery zones if available
    if (restaurantConfig?.deliveryZones) {
      let zones;
      try {
        zones = typeof restaurantConfig.deliveryZones === 'string' 
          ? JSON.parse(restaurantConfig.deliveryZones) 
          : restaurantConfig.deliveryZones;
        
        prompt += `\n\nZONAS DE DELIVERY:
${Object.entries(zones).map(([zone, info]) => `${zone}: ${typeof info === 'object' ? `$${info.cost} - ${info.time || '30-45'} min` : info}`).join('\n')}`;
      } catch (error) {
        console.log('Error parsing delivery zones:', error);
      }
    }

    if (existingOrder.length > 0) {
      prompt += `\n\nPEDIDO ACTUAL EN PROGRESO:
${existingOrder.map(item => `- ${item.quantity}x ${item.itemName} (ID: ${item.itemId})`).join('\n')}`;
    }

    prompt += `\n\nTAREA: Analizar el mensaje del cliente y extraer exactamente qué quiere pedir.

EJEMPLOS DE MANEJO INTELIGENTE:
- "quiero una docena de empanadas" → MEJOR: sugerir mix que preguntar sabor
- "media docena de carne y media de pollo" → 6 empanadas de carne + 6 empanadas de pollo  
- "2 pizzas margarita" → 2 pizzas margarita
- "una empanada" → MEJOR: sugerir sabor popular que solo preguntar
- "empanadas" → MEJOR: sugerir cantidad y mix que pedir todo

INSTRUCCIONES ESPECÍFICAS:
1. Si dice cantidad SIN sabor pero hay 2-3 opciones, SUGERIR mix inteligente
2. Si dice sabor SIN cantidad, asumir cantidad razonable (3-6 empanadas)
3. Si es muy ambiguo, ser PROACTIVO con sugerencias
4. PRIORIZAR respuestas útiles sobre preguntas adicionales
5. Hacer el proceso MÁS FLUIDO, menos preguntón

Analizá el mensaje y respondé con el formato JSON especificado, incluyendo una respuesta amigable en tono argentino que sea RESOLUTIVA.`;

    return prompt;
  }

  /**
   * Validate and process the AI response
   */
  validateAndProcessAIResponse(aiResponse, menuItems) {
    // Check if the response is off-topic
    if (aiResponse.off_topic) {
      return {
        success: false,
        off_topic: true,
        suggested_response: aiResponse.suggested_response || 'Hola! Acá te ayudo solo con pedidos del restaurante. ¿Te gustaría ver nuestro menú?'
      };
    }

    if (!aiResponse.success) {
      return {
        success: false,
        clarification_needed: aiResponse.clarification_needed || true,
        clarification_question: aiResponse.clarification_question || 'No pude entender tu pedido. ¿Podrías especificar qué querés pedir?',
        reasoning: aiResponse.reasoning,
        suggested_response: aiResponse.suggested_response,
        off_topic: aiResponse.off_topic || false
      };
    }

    // Validate items to add/modify
    const validItems = [];
    for (const item of aiResponse.items || []) {
      const menuItem = menuItems.find(m => m.id.toString() === item.itemId.toString());
      if (menuItem && item.quantity > 0) {
        validItems.push({
          itemId: item.itemId.toString(),
          itemName: menuItem.name,
          quantity: item.quantity,
          price: menuItem.price,
          category: menuItem.category || 'General',
          confidence: item.confidence || 0.9
        });
      }
    }

    // Validate items to remove
    const validRemoveItems = [];
    for (const removeItem of aiResponse.remove_items || []) {
      const menuItem = menuItems.find(m => m.id.toString() === removeItem.itemId.toString());
      if (menuItem) {
        validRemoveItems.push({
          itemId: removeItem.itemId.toString(),
          itemName: menuItem.name,
          remove_all: removeItem.remove_all || false,
          remove_quantity: removeItem.remove_quantity || null
        });
      }
    }

    // Check if we have valid operations
    if (validItems.length === 0 && validRemoveItems.length === 0) {
      return {
        success: false,
        clarification_needed: true,
        clarification_question: 'No encontré productos válidos en tu pedido. ¿Podrías especificar qué querés del menú?',
        reasoning: 'No valid menu items found',
        off_topic: false
      };
    }

    return {
      success: true,
      action: aiResponse.action || 'ADD_ITEM',
      items: validItems,
      remove_items: validRemoveItems,
      reasoning: aiResponse.reasoning,
      suggested_response: aiResponse.suggested_response,
      off_topic: aiResponse.off_topic || false
    };
  }

  /**
   * Handle simple intents like showing menu, confirming order, etc.
   */
  async detectSimpleIntents(message, context, restaurantConfig) {
    const text = message.toLowerCase().trim();
    
    // Check for off-topic questions first
    const offTopicKeywords = [
      'política', 'politica', 'elecciones', 'gobierno',
      'deportes', 'fútbol', 'futbol', 'boca', 'river', 'messi',
      'clima', 'tiempo', 'lluvia', 'sol',
      'noticias', 'coronavirus', 'covid',
      'trabajo', 'empleo', 'busco trabajo',
      'amor', 'pareja', 'novio', 'novia',
      'salud', 'doctor', 'medicina'
    ];
    
    const hasOffTopicKeyword = offTopicKeywords.some(keyword => text.includes(keyword));
    if (hasOffTopicKeyword) {
      return {
        success: true,
        intent: 'off_topic',
        response: 'Hola! Acá te ayudo solo con pedidos del restaurante. ¿Te gustaría ver nuestro menú? 😊',
        aiService: 'intelligent_simple'
      };
    }
    
    // Show menu with both digital and chat options
    if (text.includes('menu') || text.includes('menú') || text.includes('carta')) {
      const menuLink = `${process.env.APP_URL || 'https://ordenalo-front-production.up.railway.app'}/menu?phone=${context.phoneNumber}`;
      
      return {
        success: true,
        intent: 'menu',
        response: `📋 **NUESTRO MENÚ**

🌐 **Menú Digital Interactivo:**
${menuLink}

👆 _Hacé clic en el link para ver el menú completo, agregar productos y generar tu pedido automáticamente_

💬 **O pedí por chat:**
Decime qué querés y te ayudo a armar el pedido.

_Ejemplo: "Quiero una docena de empanadas de carne"_

¿Qué preferís?`,
        aiService: 'intelligent_simple'
      };
    }

    // Show delivery zones
    if (text.includes('zona') || text.includes('delivery') || text.includes('envío') || text.includes('envio')) {
      return {
        success: true,
        intent: 'delivery_zones',
        response: await this.showDeliveryZones(restaurantConfig),
        aiService: 'intelligent_simple'
      };
    }

    // Show hours
    if (text.includes('horario') || text.includes('hora') || text.includes('abierto') || text.includes('cerrado')) {
      return {
        success: true,
        intent: 'hours',
        response: await this.showOpeningHours(restaurantConfig),
        aiService: 'intelligent_simple'
      };
    }

    // Confirm order - handle "CONFIRMAR" command
    if ((text.includes('confirmar') || text.includes('si') || text.includes('sí') || text.includes('ok')) 
        && context.activeOrder && context.activeOrder.items.length > 0) {
      return await this.confirmOrder(context.phoneNumber, restaurantConfig);
    }

    // Cancel order
    if (text.includes('cancelar') || text.includes('no') || text.includes('borrar')) {
      return await this.cancelOrder(context.phoneNumber);
    }

    // Show current order
    if (text.includes('pedido') && (text.includes('actual') || text.includes('ver'))) {
      return await this.showCurrentOrder(context.phoneNumber);
    }

    // Remove item intents
    if (text.includes('quita') || text.includes('saca') || text.includes('elimina') || 
        text.includes('borra') || text.includes('remueve') || text.includes('sacame') ||
        text.includes('quitame') || text.includes('eliminame') || text.includes('borrame')) {
      return await this.handleRemoveIntent(text, context.phoneNumber);
    }

    return null; // No simple intent detected
  }

  /**
   * Show delivery zones information
   */
  async showDeliveryZones(restaurantConfig) {
    if (!restaurantConfig?.deliveryZones) {
      return '📍 Consultá por WhatsApp sobre nuestras zonas de delivery.';
    }

    try {
      const zones = typeof restaurantConfig.deliveryZones === 'string' 
        ? JSON.parse(restaurantConfig.deliveryZones) 
        : restaurantConfig.deliveryZones;

      let zonesText = '📍 **ZONAS DE DELIVERY**\n\n';
      
      for (const [zoneName, info] of Object.entries(zones)) {
        if (typeof info === 'object') {
          zonesText += `🚲 **${zoneName}**\n`;
          zonesText += `   💰 Costo: $${info.cost}\n`;
          zonesText += `   ⏱️ Tiempo: ${info.time || '30-45 min'}\n\n`;
        } else {
          zonesText += `🚲 **${zoneName}**: ${info}\n\n`;
        }
      }

      zonesText += '¿En qué zona estás? 😊';
      return zonesText;
    } catch (error) {
      return '📍 Consultá por WhatsApp sobre nuestras zonas de delivery.';
    }
  }

  /**
   * Show opening hours in Spanish
   */
  async showOpeningHours(restaurantConfig) {
    if (!restaurantConfig?.openingHours) {
      return '🕙 Consultá por WhatsApp sobre nuestros horarios de atención.';
    }

    try {
      const hours = typeof restaurantConfig.openingHours === 'string' 
        ? JSON.parse(restaurantConfig.openingHours) 
        : restaurantConfig.openingHours;

      let hoursText = '🕙 **HORARIOS DE ATENCIÓN**\n\n';
      hoursText += this.formatOpeningHours(hours);
      hoursText += '\n¡Te esperamos! 😊';
      
      return hoursText;
    } catch (error) {
      return '🕙 Consultá por WhatsApp sobre nuestros horarios de atención.';
    }
  }

  /**
   * Handle valid orders by saving to database with preparation time info
   */
  async handleValidOrder(orderResult, phoneNumber, originalMessage, restaurantConfig) {
    try {
      // Check if the response is off-topic
      if (orderResult.off_topic) {
        return {
          success: true,
          intent: 'off_topic',
          response: orderResult.suggested_response || 'Hola! Acá te ayudo solo con pedidos del restaurante. ¿Te gustaría ver nuestro menú?',
          aiService: 'openai_intelligent'
        };
      }

      const orderItems = orderResult.items || [];
      const removeItems = orderResult.remove_items || [];
      const action = orderResult.action || 'ADD_ITEM';

      // Find or create conversation
      let conversation = await prisma.conversation.findFirst({
        where: { phoneNumber, status: 'BOT_ACTIVE' },
        orderBy: { createdAt: 'desc' }
      });

      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: { phoneNumber, status: 'BOT_ACTIVE' }
        });
      }

      // Get existing drafts
      const existingDrafts = await prisma.orderDraft.findMany({
        where: { conversationId: conversation.id }
      });

      let modificationMessage = '';

      // Handle different actions
      switch (action) {
        case 'REPLACE_ALL':
          // Remove all existing items and add only the new ones
          await prisma.orderDraft.deleteMany({
            where: { conversationId: conversation.id }
          });
          
          // Add new items
          for (const item of orderItems) {
            await prisma.orderDraft.create({
              data: {
                conversationId: conversation.id,
                itemId: item.itemId,
                itemName: item.itemName,
                quantity: item.quantity,
                extraData: {
                  price: item.price,
                  confidence: item.confidence,
                  category: item.category,
                  createdAt: new Date().toISOString()
                }
              }
            });
          }
          
          modificationMessage = '✅ ¡Perfecto! Cambié tu pedido por:';
          break;

        case 'REMOVE_ITEM':
          // Remove specific items
          for (const removeItem of removeItems) {
            const existingDraft = existingDrafts.find(d => d.itemId === removeItem.itemId);
            if (existingDraft) {
              if (removeItem.remove_all) {
                // Remove completely
                await prisma.orderDraft.delete({
                  where: { id: existingDraft.id }
                });
                modificationMessage += `\n• Quité todas las ${removeItem.itemName}`;
              } else if (removeItem.remove_quantity) {
                // Reduce quantity
                const newQuantity = Math.max(0, existingDraft.quantity - removeItem.remove_quantity);
                if (newQuantity === 0) {
                  await prisma.orderDraft.delete({
                    where: { id: existingDraft.id }
                  });
                  modificationMessage += `\n• Quité todas las ${removeItem.itemName}`;
                } else {
                  await prisma.orderDraft.update({
                    where: { id: existingDraft.id },
                    data: { quantity: newQuantity }
                  });
                  modificationMessage += `\n• Reduje ${removeItem.remove_quantity} ${removeItem.itemName}`;
                }
              }
            }
          }
          
          // Add new items if any
          for (const item of orderItems) {
            const existingDraft = existingDrafts.find(d => d.itemId === item.itemId);
            if (existingDraft) {
              await prisma.orderDraft.update({
                where: { id: existingDraft.id },
                data: {
                  quantity: existingDraft.quantity + item.quantity,
                  extraData: {
                    price: item.price,
                    confidence: item.confidence,
                    category: item.category,
                    lastUpdate: new Date().toISOString()
                  }
                }
              });
            } else {
              await prisma.orderDraft.create({
                data: {
                  conversationId: conversation.id,
                  itemId: item.itemId,
                  itemName: item.itemName,
                  quantity: item.quantity,
                  extraData: {
                    price: item.price,
                    confidence: item.confidence,
                    category: item.category,
                    createdAt: new Date().toISOString()
                  }
                }
              });
            }
          }
          break;

        case 'ADD_ITEM':
        default:
          // Default behavior: add or update items
          const draftMap = new Map();
          existingDrafts.forEach(draft => {
            if (draft.itemId) draftMap.set(draft.itemId, draft);
          });

          for (const item of orderItems) {
            if (draftMap.has(item.itemId)) {
              // Update existing item
              const existing = draftMap.get(item.itemId);
              await prisma.orderDraft.update({
                where: { id: existing.id },
                data: {
                  quantity: (existing.quantity || 0) + item.quantity,
                  extraData: {
                    price: item.price,
                    confidence: item.confidence,
                    category: item.category,
                    lastUpdate: new Date().toISOString()
                  }
                }
              });
            } else {
              // Create new item
              await prisma.orderDraft.create({
                data: {
                  conversationId: conversation.id,
                  itemId: item.itemId,
                  itemName: item.itemName,
                  quantity: item.quantity,
                  extraData: {
                    price: item.price,
                    confidence: item.confidence,
                    category: item.category,
                    createdAt: new Date().toISOString()
                  }
                }
              });
            }
          }
          
          modificationMessage = existingDrafts.length > 0 
            ? '✅ ¡Perfecto! Agregué a tu pedido:' 
            : '✅ ¡Perfecto! Agregué a tu pedido:';
          break;
      }

      // Get UPDATED drafts to calculate TOTAL accumulated order
      const updatedDrafts = await prisma.orderDraft.findMany({
        where: { conversationId: conversation.id }
      });

      if (updatedDrafts.length === 0) {
        return {
          success: true,
          intent: 'order_empty',
          response: 'Tu pedido quedó vacío. ¿Qué te gustaría pedir?',
          aiService: 'openai_intelligent'
        };
      }

      // Build complete order summary
      const completeOrderSummary = updatedDrafts.map(item => 
        `• ${item.quantity}x ${item.itemName} ($${((item.extraData?.price || 0) * item.quantity).toFixed(2)})`
      ).join('\n');

      // Calculate total
      const accumulatedTotal = updatedDrafts.reduce((sum, item) => {
        const price = item.extraData?.price || 0;
        return sum + (price * item.quantity);
      }, 0);

      const prepTime = this.calculatePreparationTime(orderItems, restaurantConfig);

      let response = modificationMessage;
      
      if (action === 'REPLACE_ALL' || orderItems.length > 0) {
        const newItemsSummary = this.buildOrderSummary(orderItems);
        response += `\n\n${newItemsSummary}`;
      }

      response += `\n\n📋 **Pedido completo:**\n${completeOrderSummary}`;
      response += `\n\n💰 **Total: $${accumulatedTotal.toFixed(2)}**`;
      
      if (prepTime) {
        response += `\n⏱️ Tiempo de preparación: ${prepTime}`;
      }
      
      response += `\n\n¿Querés agregar algo más o confirmar el pedido?`;

      return {
        success: true,
        intent: 'order',
        items: orderItems,
        action: action,
        response,
        aiService: 'openai_intelligent'
      };

    } catch (error) {
      console.error('Error handling valid order:', error);
      throw error;
    }
  }

  /**
   * Calculate preparation time based on items and restaurant config
   */
  calculatePreparationTime(orderItems, restaurantConfig) {
    if (!restaurantConfig?.preparationTimes) return null;

    try {
      const prepTimes = typeof restaurantConfig.preparationTimes === 'string' 
        ? JSON.parse(restaurantConfig.preparationTimes) 
        : restaurantConfig.preparationTimes;

      let maxTime = 0;
      for (const item of orderItems) {
        // Look for category-specific preparation time
        const category = item.category || 'General';
        const time = prepTimes[category] || prepTimes['default'] || prepTimes['General'] || 20;
        maxTime = Math.max(maxTime, time);
        
        console.log(`Item: ${item.itemName}, Category: ${category}, Time: ${time} min`);
      }

      return maxTime > 0 ? `${maxTime} minutos` : null;
    } catch (error) {
      console.log('Error calculating preparation time:', error);
      return null;
    }
  }

  /**
   * Confirm current order with Argentine tone
   */
  async confirmOrder(phoneNumber, restaurantConfig) {
    try {
      const conversation = await prisma.conversation.findFirst({
        where: { phoneNumber, status: 'BOT_ACTIVE' },
        orderBy: { createdAt: 'desc' }
      });

      if (!conversation) {
        return {
          success: true,
          intent: 'error',
          response: 'No tenés un pedido activo para confirmar.',
          aiService: 'intelligent_simple'
        };
      }

      const drafts = await prisma.orderDraft.findMany({
        where: { conversationId: conversation.id }
      });

      if (drafts.length === 0) {
        return {
          success: true,
          intent: 'error', 
          response: 'No tenés productos en tu pedido para confirmar.',
          aiService: 'intelligent_simple'
        };
      }

      // Create confirmed order
      const total = drafts.reduce((sum, item) => {
        const price = item.extraData?.price || 0;
        return sum + (price * item.quantity);
      }, 0);

      const order = await prisma.order.create({
        data: {
          conversationId: conversation.id,
          totalAmount: total,
          deliveryAddress: 'A coordinar',
          items: JSON.stringify(drafts.map(d => ({
            itemId: d.itemId,
            itemName: d.itemName,
            quantity: d.quantity,
            price: d.extraData?.price || 0
          })))
        }
      });

      // Clear drafts and close conversation
      await prisma.orderDraft.deleteMany({
        where: { conversationId: conversation.id }
      });

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: 'COMPLETED' }
      });

      // Send notification to restaurant
      await this.notifyRestaurant(order, drafts, phoneNumber, restaurantConfig);

      const summary = drafts.map(item => 
        `• ${item.quantity}x ${item.itemName}`
      ).join('\n');

      const restaurantName = restaurantConfig?.restaurantName || 'nuestro restaurante';

      return {
        success: true,
        intent: 'order_confirmed',
        response: `🎉 ¡Listo! Tu pedido fue confirmado.\n\n📋 **Resumen:**\n${summary}\n\n💰 **Total: $${total.toFixed(2)}**\n\n📞 Número de pedido: #${order.id}\n\n¡Gracias por elegir ${restaurantName}! Te contactamos pronto para coordinar la entrega 😊`,
        aiService: 'intelligent_simple'
      };

    } catch (error) {
      console.error('Error confirming order:', error);
      return {
        success: false,
        intent: 'error',
        response: 'Hubo un error confirmando tu pedido. Intentá de nuevo por favor.',
        aiService: 'intelligent_simple'
      };
    }
  }

  /**
   * Send notification to restaurant when order is confirmed
   */
  async notifyRestaurant(order, orderItems, customerPhone, restaurantConfig) {
    try {
      const restaurantPhone = process.env.RESTAURANT_PHONE || process.env.WHATSAPP_NUMBER;
      
      if (!restaurantPhone) {
        console.log('No restaurant phone configured for notifications');
        return;
      }

      // Clean customer phone for display
      const cleanCustomerPhone = customerPhone.replace('@c.us', '');
      
      // Group items by category for better formatting
      const itemsByCategory = {};
      orderItems.forEach(item => {
        const category = item.extraData?.category || 'Otros';
        if (!itemsByCategory[category]) {
          itemsByCategory[category] = [];
        }
        itemsByCategory[category].push({
          name: item.itemName,
          quantity: item.quantity,
          price: item.extraData?.price || 0,
          subtotal: (item.extraData?.price || 0) * item.quantity
        });
      });

      // Generate notification message
      let message = `🔔 *NUEVO PEDIDO CONFIRMADO*\n\n`;
      message += `📞 *Pedido:* #${order.id}\n`;
      message += `👤 *Cliente:* ${cleanCustomerPhone}\n`;
      message += `📅 *Fecha:* ${new Date().toLocaleString('es-AR')}\n\n`;
      
      message += `📋 *PRODUCTOS:*\n`;
      let totalPrice = 0;

      Object.entries(itemsByCategory).forEach(([category, items]) => {
        message += `\n*${category.toUpperCase()}:*\n`;
        items.forEach(item => {
          message += `• ${item.name} x${item.quantity} - $${item.subtotal.toFixed(2)}\n`;
          totalPrice += item.subtotal;
        });
      });

      message += `\n💰 *TOTAL: $${totalPrice.toFixed(2)}*\n\n`;
      message += `📍 *Dirección:* A coordinar con cliente\n\n`;
      
      // Add preparation time if available
      const prepTime = this.calculatePreparationTime(orderItems, restaurantConfig);
      if (prepTime > 0) {
        message += `⏱️ *Tiempo estimado:* ${prepTime} minutos\n\n`;
      }
      
      message += `✅ *Estado:* Nuevo pedido confirmado\n`;
      message += `📱 *Contactar:* wa.me/${cleanCustomerPhone}`;

      // Import WhatsApp client dynamically to avoid circular dependency
      const { default: whatsappClient } = await import('../whatsapp/client.js');
      
      if (whatsappClient && whatsappClient.sendMessage) {
        await whatsappClient.sendMessage(`${restaurantPhone}@c.us`, message);
        console.log(`Order notification sent to restaurant: ${restaurantPhone}`);
      } else {
        console.log('WhatsApp client not available for restaurant notification');
      }

    } catch (error) {
      console.error('Error sending restaurant notification:', error);
      // Don't throw error to avoid breaking the order confirmation
    }
  }

  /**
   * Get conversation context from database
   */
  async getContext(phoneNumber) {
    try {
      const conversation = await prisma.conversation.findFirst({
        where: { phoneNumber, status: 'BOT_ACTIVE' },
        orderBy: { createdAt: 'desc' }
      });

      if (!conversation) {
        return { activeOrder: null, phoneNumber };
      }

      const drafts = await prisma.orderDraft.findMany({
        where: { conversationId: conversation.id }
      });

      return {
        activeOrder: drafts.length > 0 ? { items: drafts } : null,
        phoneNumber,
        conversationId: conversation.id
      };
    } catch (error) {
      console.error('Error getting context:', error);
      return { activeOrder: null, phoneNumber };
    }
  }

  /**
   * Show menu to customer
   */
  async showMenu(restaurantConfig) {
    try {
      const config = restaurantConfig || await prisma.restaurantConfig.findFirst();
      if (!config?.menuItems) {
        return '📋 **MENÚ**\n\nEl menú no está disponible en este momento. Consultá por WhatsApp.';
      }

      const menuItems = typeof config.menuItems === 'string' 
        ? JSON.parse(config.menuItems) 
        : config.menuItems;

      let menuText = `📋 **MENÚ - ${config.restaurantName || 'Nuestro Restaurante'}**\n\n`;
      
      // Group by category if available
      const grouped = this.groupByCategory(menuItems);
      
      for (const [category, items] of Object.entries(grouped)) {
        if (category !== 'Sin categoría') {
          menuText += `🔸 **${category.toUpperCase()}**\n`;
        }
        
        for (const item of items) {
          const emoji = this.getUniversalEmoji(item);
          menuText += `${emoji} **${item.name}** - $${item.price}`;
          if (item.description) {
            menuText += `\n   _${item.description}_`;
          }
          menuText += '\n';
        }
        menuText += '\n';
      }

      // Add preparation times if available
      if (config.preparationTimes) {
        try {
          const prepTimes = typeof config.preparationTimes === 'string' 
            ? JSON.parse(config.preparationTimes) 
            : config.preparationTimes;
          
          menuText += '⏱️ **TIEMPOS DE PREPARACIÓN**\n';
          for (const [category, time] of Object.entries(prepTimes)) {
            menuText += `• ${category}: ${time} minutos\n`;
          }
          menuText += '\n';
        } catch (error) {
          console.log('Error parsing preparation times:', error);
        }
      }

      // Add delivery zones if available
      if (config.deliveryZones) {
        try {
          const zones = typeof config.deliveryZones === 'string' 
            ? JSON.parse(config.deliveryZones) 
            : config.deliveryZones;
          
          menuText += '📍 **ZONAS DE DELIVERY**\n';
          for (const [zoneName, info] of Object.entries(zones)) {
            if (typeof info === 'object') {
              menuText += `🚲 ${zoneName}: $${info.cost} (${info.time || '30-45 min'})\n`;
            } else {
              menuText += `🚲 ${zoneName}: ${info}\n`;
            }
          }
          menuText += '\n';
        } catch (error) {
          console.log('Error parsing delivery zones:', error);
        }
      }

      menuText += '💬 **¿Qué te gustaría pedir?**\n';
      menuText += '_Ejemplo: "Quiero una docena de empanadas de carne"_';
      
      return menuText;
    } catch (error) {
      console.error('Error showing menu:', error);
      return 'Hubo un error mostrando el menú. Intentá nuevamente por favor.';
    }
  }

  /**
   * Handle ambiguous orders that need clarification
   */
  async handleAmbiguousOrder(orderResult, phoneNumber, menuItems) {
    if (orderResult.clarification_needed && orderResult.clarification_question) {
      return {
        success: true,
        intent: 'clarification',
        response: orderResult.clarification_question,
        aiService: 'openai_intelligent'
      };
    }

    // Fallback clarification
    return {
      success: true,
      intent: 'clarification', 
      response: 'No entendí bien tu pedido. ¿Podrías ser más específico sobre qué querés pedir?',
      aiService: 'openai_intelligent'
    };
  }

  /**
   * Cancel current order
   */
  async cancelOrder(phoneNumber) {
    try {
      const conversation = await prisma.conversation.findFirst({
        where: { phoneNumber, status: 'BOT_ACTIVE' },
        orderBy: { createdAt: 'desc' }
      });

      if (!conversation) {
        return {
          success: true,
          intent: 'info',
          response: 'No tenés un pedido activo para cancelar.',
          aiService: 'intelligent_simple'
        };
      }

      // Delete drafts and close conversation
      await prisma.orderDraft.deleteMany({
        where: { conversationId: conversation.id }
      });

      // Use COMPLETED instead of CANCELLED (which doesn't exist in ConversationStatus)
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: 'COMPLETED' }
      });

      return {
        success: true,
        intent: 'order_cancelled',
        response: '❌ Pedido cancelado. ¿Querés hacer un nuevo pedido?',
        aiService: 'intelligent_simple'
      };

    } catch (error) {
      console.error('Error cancelling order:', error);
      return {
        success: false,
        intent: 'error',
        response: 'Hubo un error cancelando tu pedido.',
        aiService: 'intelligent_simple'
      };
    }
  }

  /**
   * Show current order in progress
   */
  async showCurrentOrder(phoneNumber) {
    try {
      const conversation = await prisma.conversation.findFirst({
        where: { phoneNumber, status: 'BOT_ACTIVE' },
        orderBy: { createdAt: 'desc' }
      });

      if (!conversation) {
        return {
          success: true,
          intent: 'info',
          response: 'No tenés un pedido activo.',
          aiService: 'intelligent_simple'
        };
      }

      const drafts = await prisma.orderDraft.findMany({
        where: { conversationId: conversation.id }
      });

      if (drafts.length === 0) {
        return {
          success: true,
          intent: 'info',
          response: 'Tu pedido está vacío. ¿Qué te gustaría pedir?',
          aiService: 'intelligent_simple'
        };
      }

      const summary = drafts.map(item => 
        `• ${item.quantity}x ${item.itemName}`
      ).join('\n');

      const total = drafts.reduce((sum, item) => {
        const price = item.extraData?.price || 0;
        return sum + (price * item.quantity);
      }, 0);

      return {
        success: true,
        intent: 'order_status',
        response: `📋 **Tu pedido actual:**\n\n${summary}\n\n💰 **Total: $${total.toFixed(2)}**\n\n¿Querés agregar algo más o confirmar el pedido?`,
        aiService: 'intelligent_simple'
      };

    } catch (error) {
      console.error('Error showing current order:', error);
      return {
        success: false,
        intent: 'error',
        response: 'Hubo un error mostrando tu pedido.',
        aiService: 'intelligent_simple'
      };
    }
  }

  /**
   * Build order summary text
   */
  buildOrderSummary(orderItems) {
    return orderItems.map(item => 
      `• ${item.quantity}x ${item.itemName} ($${(item.price * item.quantity).toFixed(2)})`
    ).join('\n');
  }

  /**
   * Group menu items by category
   */
  groupByCategory(items) {
    const grouped = {};
    for (const item of items) {
      const category = item.category || 'Sin categoría';
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push(item);
    }
    return grouped;
  }

  /**
   * Get emoji for menu item
   */
  getUniversalEmoji(item) {
    const name = item.name.toLowerCase();
    if (name.includes('empanada')) return '🥟';
    if (name.includes('pizza')) return '🍕';
    if (name.includes('hamburguesa') || name.includes('burger')) return '🍔';
    if (name.includes('bebida') || name.includes('gaseosa') || name.includes('refresco')) return '🥤';
    if (name.includes('ensalada')) return '🥗';
    if (name.includes('sandwich') || name.includes('sándwich')) return '🥪';
    if (name.includes('pasta') || name.includes('spaguetti')) return '🍝';
    if (name.includes('pollo')) return '🍗';
    if (name.includes('carne')) return '🥩';
    if (name.includes('pescado')) return '🐟';
    if (name.includes('postre') || name.includes('helado')) return '🍨';
    return '🍽️';
  }

  /**
   * Handle remove item intents
   */
  async handleRemoveIntent(message, phoneNumber) {
    try {
      // Get current order
      const conversation = await prisma.conversation.findFirst({
        where: { phoneNumber, status: 'BOT_ACTIVE' },
        orderBy: { createdAt: 'desc' }
      });

      if (!conversation) {
        return {
          success: true,
          intent: 'info',
          response: 'No tenés un pedido activo para modificar.',
          aiService: 'intelligent_simple'
        };
      }

      const drafts = await prisma.orderDraft.findMany({
        where: { conversationId: conversation.id }
      });

      if (drafts.length === 0) {
        return {
          success: true,
          intent: 'info',
          response: 'Tu pedido está vacío, no hay nada que quitar.',
          aiService: 'intelligent_simple'
        };
      }

      // Try to identify which item to remove
      const lowerMessage = message.toLowerCase();
      
      // Look for item names in the message
      let itemToRemove = null;
      let quantityToRemove = null;
      
      // Extract quantity if mentioned (e.g., "quita 2 empanadas")
      const qtyMatch = lowerMessage.match(/quita(?:me)?\s+(\d+|una?|dos|tres|cuatro|cinco|seis)\s+(.+)/);
      if (qtyMatch) {
        const qtyMap = { 'una': 1, 'un': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'seis': 6 };
        quantityToRemove = qtyMap[qtyMatch[1]] || parseInt(qtyMatch[1]) || 1;
      }

      // Find matching item in current order
      for (const draft of drafts) {
        const itemName = draft.itemName.toLowerCase();
        if (itemName.includes('empanada') && lowerMessage.includes('empanada')) {
          if (itemName.includes('carne') && lowerMessage.includes('carne')) {
            itemToRemove = draft;
            break;
          } else if (itemName.includes('pollo') && lowerMessage.includes('pollo')) {
            itemToRemove = draft;
            break;
          } else if (!lowerMessage.includes('carne') && !lowerMessage.includes('pollo')) {
            // Generic "empanada" - take first empanada found
            itemToRemove = draft;
            break;
          }
        } else if (itemName.includes('pizza') && lowerMessage.includes('pizza')) {
          itemToRemove = draft;
          break;
        }
      }

      if (!itemToRemove) {
        // No specific item identified, show current order for user to specify
        const summary = drafts.map(item => 
          `• ${item.quantity}x ${item.itemName}`
        ).join('\n');
        
        return {
          success: true,
          intent: 'clarification',
          response: `No pude identificar qué querés quitar. Tu pedido actual:\n\n${summary}\n\n¿Qué item querés quitar específicamente?`,
          aiService: 'intelligent_simple'
        };
      }

      // Remove or reduce quantity
      const currentQty = itemToRemove.quantity;
      const toRemove = quantityToRemove || currentQty; // Remove all if no quantity specified
      
      if (toRemove >= currentQty) {
        // Remove completely
        await prisma.orderDraft.delete({
          where: { id: itemToRemove.id }
        });
        
        return {
          success: true,
          intent: 'item_removed',
          response: `✅ Listo! Quité ${currentQty}x ${itemToRemove.itemName} de tu pedido.`,
          aiService: 'intelligent_simple'
        };
      } else {
        // Reduce quantity
        await prisma.orderDraft.update({
          where: { id: itemToRemove.id },
          data: { quantity: currentQty - toRemove }
        });
        
        return {
          success: true,
          intent: 'item_reduced',
          response: `✅ Listo! Reduje ${toRemove}x ${itemToRemove.itemName}. Te quedan ${currentQty - toRemove}x en el pedido.`,
          aiService: 'intelligent_simple'
        };
      }

    } catch (error) {
      console.error('Error handling remove intent:', error);
      return {
        success: false,
        intent: 'error',
        response: 'Hubo un error modificando tu pedido. Intentá de nuevo.',
        aiService: 'intelligent_simple'
      };
    }
  }
}

export default IntelligentOrderProcessor; 