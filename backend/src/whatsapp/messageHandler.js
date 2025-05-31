import { messageFilter } from '../services/contentFilter.js';
import { processWithGemini } from '../services/gemini.js';
import { rateLimiter } from '../services/rateLimiter.js';
import { escalationDetector } from '../services/escalationDetector.js';
import prisma from '../utils/database.js';
import { findBestMenuMatch } from '../services/gemini.js';
import {
  getOrCreateDraft,
  updateDraft,
  finalizeDraft,
  deleteDraft,
  getDraftByConversationId
} from '../services/orderDraftService.js';
import {
  extractOrderItemsAndQuantities,
  isOrderConfirmation,
  isOrderCancellation,
  isQuantityOnlyMessage,
  isAddIntent,
  isRemoveIntent,
  detectReplaceIntent
} from '../utils/validators.js';
import { extractOrderWithGemini } from '../services/gemini.js';

const APP_URL = process.env.APP_URL && process.env.APP_URL !== '' ? process.env.APP_URL : 'http://localhost:5173';

// Helper to get customer type
async function getCustomerType(phoneNumber) {
  const customer = await prisma.customerProfile.findUnique({ where: { phoneNumber } });
  if (!customer || customer.orderCount === 0) return 'NEW_CUSTOMER';
  if (customer.orderCount >= 10) return 'VIP_CUSTOMER';
  if (customer.lastOrderDate) {
    const daysSince = (Date.now() - new Date(customer.lastOrderDate).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince <= 30) return 'RETURNING_CUSTOMER';
  }
  return 'DORMANT_CUSTOMER';
}

// Helper to generate personalized greeting/options
async function generateOrderOptions(phoneNumber) {
  const customerType = await getCustomerType(phoneNumber);
  const customer = await prisma.customerProfile.findUnique({ where: { phoneNumber } });
  const config = await prisma.restaurantConfig.findFirst();
  const menuLink = `${APP_URL}/menu?phone=${phoneNumber}`;
  switch (customerType) {
    case 'NEW_CUSTOMER':
      return `¡Bienvenido a ${config.restaurantName || 'nuestro restaurante'}! ¿Cómo prefieres ordenar?\n\n📱 Menú digital: ${menuLink}\n💬 Decime qué quieres\n\n💡 Tip: El menú digital es más fácil con fotos 😊`;
    case 'RETURNING_CUSTOMER': {
      // Get last order summary
      let lastOrder = null;
      if (customer?.lastOrderId) {
        lastOrder = await prisma.order.findUnique({ where: { id: customer.lastOrderId } });
      }
      let lastOrderSummary = '';
      if (lastOrder) {
        const items = Array.isArray(lastOrder.items) ? lastOrder.items : [];
        lastOrderSummary = items.map(i => `${i.quantity}x ${i.name || i.itemName}`).join(' + ');
      }
      return `¡Hola de nuevo! 😊 ¿Cómo quieres ordenar hoy?\n\n🔄 Repetir tu último pedido${lastOrderSummary ? ` (${lastOrderSummary} - $${lastOrder?.totalAmount || ''})` : ''}\n📱 Menú digital: ${menuLink}\n💬 Decime algo nuevo\n\n¿Qué prefieres?`;
    }
    case 'VIP_CUSTOMER': {
      // Get last order and favorites
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
      return `¡Hola${customer?.name ? ' ' + customer.name : ''}! 🌟\n\n🔄 Lo de siempre${lastOrderSummary ? ` (${lastOrderSummary})` : ''}\n⭐ Tus favoritos: ${favorites || 'Sin favoritos aún'}\n📱 Menú completo: ${menuLink}\n💬 Algo diferente hoy\n\n¿Qué te provoca? 😋`;
    }
    default:
      return `¡Hola! ¿Qué te gustaría pedir hoy?\n\n📱 Menú digital: ${menuLink}\n💬 Decime qué quieres`;
  }
}

// Main function to handle incoming WhatsApp messages
export async function handleIncomingMessage(msg, client) {
  try {
    const phoneNumber = msg.from;
    const messageContent = msg.body;
    console.log('[WA] Received message:', messageContent, 'from:', phoneNumber);

    // Fetch config for banned numbers and open status
    const config = await prisma.restaurantConfig.findFirst();
    if (config?.bannedNumbers?.includes(phoneNumber)) {
      await msg.reply('No tienes permiso para interactuar con este restaurante.');
      return;
    }

    // Check if restaurant is open
    if (config && !config.isOpen) {
      await msg.reply(config.outOfHoursMessage || 'El restaurante está cerrado en este momento.');
      return;
    }

    // Rate limiting per phone number
    const allowed = await rateLimiter.check(phoneNumber);
    if (!allowed) {
      await msg.reply('Has superado el límite de mensajes. Por favor, intenta más tarde.');
      return;
    }

    // Prepare menuItems ONCE for the whole handler
    let menuItems = config.menuItems;
    if (!Array.isArray(menuItems)) {
      if (typeof menuItems === 'string') {
        try { menuItems = JSON.parse(menuItems); } catch { menuItems = []; }
      } else if (typeof menuItems === 'object' && menuItems !== null) {
        menuItems = Object.values(menuItems).every(i => typeof i === 'object' && i.name) ? Object.values(menuItems) : [];
      } else {
        menuItems = [];
      }
    }
    console.log('[WA] Loaded menu items:', menuItems);

    // Improved menu inquiry detection (Argentinian/Spanish phrases)
    const lowerContent = messageContent.trim().toLowerCase();
    const menuInquiryRegex = /\b(menu|menú|carta|productos|ver productos|ver opciones|ver el menu|ver el menú|mostrar menu|mostrar menú|mostrar carta|quiero el menu|quiero el menú|quiero la carta|la carta|pasame el menu|pasame el menú|dame el menu|dame el menú|puedo ver el menu|puedo ver el menú|opciones|oferta|ofertas|promos|promociones|promoción|promocion|ver promo|ver promociones|ver oferta|ver ofertas)\b/i;
    if (menuInquiryRegex.test(lowerContent)) {
      const menuLink = `${APP_URL}/menu?phone=${phoneNumber}`;
      const menuList = menuItems.map(i => `• ${i.name} - $${i.price}`).join('\n');
      const menuMsg = `El menú lo podés ver en el siguiente link y también podés realizar tu orden allí:\n${menuLink}\n\nSi preferís, también te lo muestro acá:\n${menuList}`;
      await msg.reply(menuMsg);
      return;
    }

    // --- Conversational Order Draft Logic ---
    // Find or create conversation
    let conversation = await prisma.conversation.findFirst({ where: { phoneNumber }, orderBy: { createdAt: 'desc' } });
    if (!conversation) {
      conversation = await prisma.conversation.create({ data: { phoneNumber } });
    }
    const now = new Date();
    let shouldResetDraft = false;
    if (conversation) {
      // Check if last message was more than 15 minutes ago
      const lastMsg = conversation.updatedAt || conversation.createdAt;
      const diffMinutes = (now - new Date(lastMsg)) / 60000;
      if (diffMinutes > 15) shouldResetDraft = true;
    }
    // Greeting detection (reuse greetings array)
    const greetings = [
      'hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'hello', 'hi', 'saludos', 'holi', 'holis', 'qué tal', 'que tal', 'quiero hacer un pedido'
    ];
    if (greetings.some(greet => lowerContent.startsWith(greet))) {
      shouldResetDraft = true;
      console.log('[WA] Greeting detected, will reset draft and reply.');
      // Personalized greeting/options
      const optionsMsg = await generateOrderOptions(phoneNumber);
      // Always delete draft on greeting
      let draft = await getDraftByConversationId(conversation.id);
      if (draft) {
        await deleteDraft(draft.id);
        console.log('[WA] Draft deleted due to greeting.');
      }
      await prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: now } });
      await msg.reply(optionsMsg);
      return;
    }
    // If should reset, delete draft and start fresh
    if (shouldResetDraft) {
      let draft = await getDraftByConversationId(conversation.id);
      if (draft) {
        await deleteDraft(draft.id);
        console.log('[WA] Draft deleted due to expiration.');
      }
      await prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: now } });
      await msg.reply('¡Hola! ¿Qué te gustaría pedir hoy? Te paso nuestro menú: ' + menuItems.map(i => i.name).join(', ') + '.');
      return;
    }
    // Always update last message timestamp
    await prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: now } });

    // Check for in-progress draft
    let draft = await getDraftByConversationId(conversation.id);
    console.log('[WA] Draft found:', !!draft);

    // Handle quantity-only message for pending item
    const quantityOnly = isQuantityOnlyMessage(messageContent);
    if (quantityOnly && draft && draft.extraData?.items?.length > 0) {
      let items = draft.extraData.items;
      const idx = items.findIndex(i => !i.quantity);
      if (idx >= 0) {
        items[idx].quantity = quantityOnly;
        await updateDraft(draft.id, { extraData: { ...draft.extraData, items } });
        const summary = items.map(i => `${i.itemName} x${i.quantity || '?'}`).join(', ');
        const total = items.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0);
        await msg.reply(`¡Perfecto! Actualicé tu pedido: ${summary}\nTotal: $${total}\nResponde CONFIRMAR para finalizar el pedido, agrega más productos o edita tu pedido.`);
        return;
      }
    }

    // Handle order confirmation/cancellation
    if (isOrderConfirmation(lowerContent)) {
      if (draft && draft.extraData?.items?.length > 0 && draft.extraData.items.every(i => i.quantity)) {
        const orderData = {
          conversationId: conversation.id,
          items: draft.extraData.items,
          totalAmount: draft.extraData.items.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0),
          deliveryAddress: draft.extraData?.deliveryAddress || '',
          status: 'PENDING',
        };
        await finalizeDraft(draft.id, orderData);
        await msg.reply('¡Tu pedido ha sido confirmado! Pronto te avisaremos cuando esté listo.');
        return;
      } else if (draft && draft.extraData?.items?.some(i => !i.quantity)) {
        await msg.reply('Por favor, indícame la cantidad de cada producto antes de confirmar el pedido.');
        return;
      } else {
        await msg.reply('No tienes ningún pedido pendiente para confirmar.');
        return;
      }
    }
    if (isOrderCancellation(lowerContent)) {
      if (draft) {
        await deleteDraft(draft.id);
        await msg.reply('Tu pedido en curso ha sido cancelado. Si quieres pedir otra cosa, avísame.');
        return;
      } else {
        await msg.reply('No tienes ningún pedido en curso para cancelar.');
        return;
      }
    }

    // If there is a draft, update it with new info or handle add/remove/change
    if (draft) {
      // Handle pending replace confirmation
      if (draft.extraData?.pendingAction === 'replace' && (lowerContent === 'sí' || lowerContent === 'si')) {
        // Replace draft items with last proposedItems
        const proposedItems = draft.extraData.proposedItems || [];
        await updateDraft(draft.id, { extraData: { items: proposedItems } });
        const summary = proposedItems.map(i => `${i.itemName} x${i.quantity}`).join(', ');
        const total = proposedItems.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0);
        await msg.reply(`Listo, actualicé tu pedido: ${summary}\nTotal: $${total}`);
        return;
      } else if (draft.extraData?.pendingAction === 'replace' && (lowerContent === 'no')) {
        // Cancel replace
        await updateDraft(draft.id, { extraData: { ...draft.extraData, pendingAction: undefined, proposedItems: undefined } });
        await msg.reply('Perfecto, mantengo tu pedido anterior. ¿Querés agregar o quitar algo más?');
        return;
      }
      // Handle pending remove confirmation
      if (draft.extraData?.pendingAction === 'remove' && (lowerContent === 'sí' || lowerContent === 'si')) {
        // Remove the proposed items from the draft
        const items = draft.extraData.items || [];
        const toRemove = draft.extraData.proposedItems || [];
        const remaining = items.filter(i => !toRemove.some(r => r.itemId === i.itemId));
        await updateDraft(draft.id, { extraData: { items: remaining } });
        if (remaining.length > 0) {
          const summary = remaining.map(i => `${i.itemName} x${i.quantity}`).join(', ');
          const total = remaining.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0);
          await msg.reply(`Listo, quité los productos. Tu pedido ahora es: ${summary}\nTotal: $${total}`);
        } else {
          await msg.reply('Listo, quité los productos. Tu pedido está vacío. ¿Querés agregar algo más?');
        }
        return;
      } else if (draft.extraData?.pendingAction === 'remove' && (lowerContent === 'no')) {
        await updateDraft(draft.id, { extraData: { ...draft.extraData, pendingAction: undefined, proposedItems: undefined } });
        await msg.reply('Perfecto, mantengo tu pedido anterior. ¿Querés agregar o quitar algo más?');
        return;
      }
      let extracted = extractOrderItemsAndQuantities(messageContent, menuItems);
      console.log('[WA] extractOrderItemsAndQuantities result:', extracted);
      // --- Handle generic item requests with multiple variants ---
      if (extracted.length === 0) {
        // Try to find a generic word in the message that matches multiple menu items
        const words = messageContent.toLowerCase().split(/\s|,|\./).filter(Boolean);
        let genericMatches = [];
        for (const word of words) {
          // Find all menu items that include this word (singular/plural)
          const baseWord = word.replace(/s$/, '');
          const matches = menuItems.filter(i => i.name.toLowerCase().includes(baseWord));
          if (matches.length > 1) {
            genericMatches = matches;
            break;
          }
        }
        if (genericMatches.length > 1) {
          const options = genericMatches.map(i => i.name).join(', ');
          await msg.reply(`¿De qué tipo de ${genericMatches[0].name.split(' ')[0].toLowerCase()} querés? Tenemos: ${options}.`);
          return;
        }
      }
      // --- Detect 'mejor quiero', 'prefiero', etc. as replace intent ---
      const replacePhrases = ['mejor quiero', 'prefiero', 'cambio a', 'cambiá a', 'cambia a', 'mejor pedí', 'mejor pido'];
      if (replacePhrases.some(phrase => messageContent.toLowerCase().includes(phrase))) {
        if (draft && draft.extraData?.items?.length > 0 && extracted.length > 0) {
          // Force replace intent logic
          const normalize = str => str.toLowerCase().replace(/\s+/g, '');
          const extractedNames = extracted.map(i => normalize(i.itemName)).sort().join(',');
          const currentNames = draft.extraData.items.map(i => normalize(i.itemName)).sort().join(',');
          if (extractedNames !== currentNames) {
            const summary = extracted.map(i => `${i.itemName} x${i.quantity || '? '}`).join(', ');
            console.log('[WA] Replace intent (mejor quiero/prefiero) detected, asking for confirmation:', summary);
            await updateDraft(draft.id, { extraData: { ...draft.extraData, pendingAction: 'replace', proposedItems: extracted } });
            await msg.reply(`¿Querés que quite los otros ítems y deje solo ${summary} en tu pedido? Responde SÍ para confirmar o NO para mantener el pedido anterior.`);
            return;
          }
        }
      }
      // --- Robust replace intent detection and confirmation ---
      if (detectReplaceIntent(messageContent) && extracted.length > 0) {
        // Compare by normalized name if IDs are missing
        const normalize = str => str.toLowerCase().replace(/\s+/g, '');
        const extractedNames = extracted.map(i => normalize(i.itemName)).sort().join(',');
        const currentNames = draft.extraData.items.map(i => normalize(i.itemName)).sort().join(',');
        if (extractedNames !== currentNames) {
          // Log and ask for confirmation before replacing
          const summary = extracted.map(i => `${i.itemName} x${i.quantity}`).join(', ');
          console.log('[WA] Replace intent detected, asking for confirmation:', summary);
          await updateDraft(draft.id, { extraData: { ...draft.extraData, pendingAction: 'replace', proposedItems: extracted } });
          await msg.reply(`¿Querés que quite los otros ítems y deje solo ${summary} en tu pedido? Responde SÍ para confirmar o NO para mantener el pedido anterior.`);
          return;
        }
      }
      // --- Smarter remove intent detection ---
      if (isRemoveIntent(messageContent) && extracted.length > 0 && draft.extraData?.items?.length > 0) {
        // Find which items to remove
        const items = draft.extraData.items;
        const toRemove = items.filter(i => extracted.some(e => e.itemId === i.itemId));
        if (toRemove.length > 0) {
          const summary = toRemove.map(i => `${i.itemName} x${i.quantity}`).join(', ');
          await updateDraft(draft.id, { extraData: { ...draft.extraData, pendingAction: 'remove', proposedItems: toRemove } });
          await msg.reply(`¿Seguro que querés quitar ${summary} del pedido? Responde SÍ para confirmar o NO para mantener el pedido anterior.`);
          return;
        }
      }
      let needsQuantityPrompt = false;
      let quantityPrompt = '';
      let clarificationPrompt = '';
      for (const ex of extracted) {
        const menuItem = menuItems.find(i => i.id === ex.itemId);
        if (!menuItem) continue;
        const idx = items.findIndex(i => i.itemId === ex.itemId);
        const addIntent = isAddIntent(messageContent);
        const removeIntent = isRemoveIntent(messageContent);
        if (ex.quantity && ex.itemId) {
          if (idx >= 0) {
            if (addIntent) {
              items[idx].quantity += ex.quantity;
            } else if (removeIntent) {
              items[idx].quantity -= ex.quantity;
              if (items[idx].quantity <= 0) items.splice(idx, 1);
            } else {
              items[idx].quantity = ex.quantity;
            }
          } else {
            items.push({ ...ex, price: menuItem.price });
          }
          continue;
        }
        if (!ex.itemId && (addIntent || removeIntent) && items.length > 1) {
          clarificationPrompt = '¿A qué producto te referís? Por favor, especifica el producto.';
        } else if (!ex.quantity) {
          needsQuantityPrompt = true;
          quantityPrompt = `¿Cuántos/as ${menuItem.name} te gustaría pedir?`;
          if (idx < 0) items.push({ ...ex, price: menuItem.price });
        }
      }
      if (clarificationPrompt) {
        console.log('[WA] Clarification needed, replying:', clarificationPrompt);
        await updateDraft(draft.id, { extraData: { ...draft.extraData, items } });
        await msg.reply(clarificationPrompt);
        return;
      }
      const missingQty = items.find(i => !i.quantity);
      if (needsQuantityPrompt && quantityPrompt) {
        console.log('[WA] Needs quantity prompt, replying:', quantityPrompt);
        await updateDraft(draft.id, { extraData: { ...draft.extraData, items } });
        await msg.reply(quantityPrompt);
        return;
      } else if (missingQty) {
        console.log('[WA] Missing quantity for item, replying:', missingQty.itemName);
        await updateDraft(draft.id, { extraData: { ...draft.extraData, items } });
        await msg.reply(`¿Cuántos/as ${missingQty.itemName} te gustaría pedir?`);
        return;
      }
      if (items.length > 0) {
        const summary = items.map(i => `${i.itemName} x${i.quantity}`).join(', ');
        const total = items.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0);
        console.log('[WA] Draft summary, replying:', summary, 'Total:', total);
        await updateDraft(draft.id, { extraData: { ...draft.extraData, items } });
        await msg.reply(`Resumen de tu pedido: ${summary}\nTotal: $${total}\nResponde CONFIRMAR para finalizar el pedido, agrega más productos o edita tu pedido.`);
        return;
      } else {
        console.log('[WA] No items in draft after extraction, replying fallback.');
        await updateDraft(draft.id, { extraData: { ...draft.extraData, items } });
        await msg.reply('No pude identificar productos en tu mensaje. ¿Qué te gustaría pedir?');
        return;
      }
    }

    // If no draft and message looks like an order, start a draft
    let extracted = extractOrderItemsAndQuantities(messageContent, menuItems);
    console.log('[WA] extractOrderItemsAndQuantities (no draft) result:', extracted);
    if (extracted.length > 0) {
      const items = [];
      let needsQuantityPrompt = false;
      let quantityPrompt = '';
      for (const ex of extracted) {
        const menuItem = menuItems.find(i => i.id === ex.itemId);
        if (!menuItem) continue;
        if (ex.quantity) {
          items.push({ ...ex, price: menuItem.price });
        } else {
          needsQuantityPrompt = true;
          quantityPrompt = `¿Cuántos/as ${menuItem.name} te gustaría pedir?`;
          items.push({ ...ex, price: menuItem.price });
        }
      }
      // Always create a draft if a possible order is detected
      await getOrCreateDraft(conversation.id);
      let draft = await getDraftByConversationId(conversation.id);
      await updateDraft(draft.id, { extraData: { items } });
      if (needsQuantityPrompt && quantityPrompt) {
        console.log('[WA] Needs quantity prompt (no draft), replying:', quantityPrompt);
        await msg.reply(quantityPrompt);
        return;
      }
      const summary = items.map(i => `${i.itemName} x${i.quantity}`).join(', ');
      const total = items.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0);
      console.log('[WA] Started draft, replying:', summary, 'Total:', total);
      await msg.reply(`¡Perfecto! Inicié tu pedido: ${summary}\nTotal: $${total}\nResponde CONFIRMAR para finalizar el pedido o agrega más productos.`);
      return;
    }

    // Fallback: If not a clear order but food-related, reply with a helpful message
    const matchResult = menuItems.length ? findBestMenuMatch(messageContent, menuItems) : null;
    console.log('[WA] findBestMenuMatch result:', matchResult);
    if (!matchResult) {
      console.log('[WA] No match, replying fallback with menu.');
      await msg.reply(`¡Sí! 😊 ¿Qué te gustaría pedir? Te paso nuestro menú: ${menuItems.map(i => i.name).join(', ')}.`);
      return;
    }
    if (matchResult && matchResult.best && (matchResult.bestDistance <= 3 || matchResult.bestScore > 0.5)) {
      console.log('[WA] Matched menu item, replying:', matchResult.best.name);
      await msg.reply(`Pedido: ${matchResult.best.name} x1\nPrecio: $${matchResult.best.price || 0}\nResponde CONFIRMAR para realizar el pedido.`);
      return;
    }

    // Fallback: Use Gemini for unrelated or unclear messages
    console.log('[WA] Using Gemini fallback for message:', messageContent);
    const response = await processWithGemini(messageContent, phoneNumber, menuItems);
    console.log('[WA] Gemini fallback response:', response);
    if (!response || response === 'undefined') {
      await msg.reply('Todavía no me enseñaron a responder eso, pero pronto podré ayudarte con esa consulta. ¿Querés ver el menú o hacer un pedido?');
      return;
    }
    await msg.reply(response);
    return;
  } catch (err) {
    console.error('[WA] Error in handleIncomingMessage:', err);
    try { await msg.reply('Ocurrió un error inesperado. Por favor, intenta de nuevo.'); } catch {}
  }
  // Global fallback: if for any reason no reply was sent
  try {
    console.log('[WA] Global fallback: no reply sent, sending fallback message.');
    await msg.reply('No pude procesar tu mensaje. ¿Podrías aclararlo o elegir del menú?');
  } catch {}
} 