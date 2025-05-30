// Placeholder for input validation utilities
// Add validation functions for API endpoints as needed 

/**
 * Helper to extract quantity from a string (supports numbers, 'una', 'un', 'dos', ..., 'media docena', 'docena', etc.)
 * @param {string} str
 * @returns {number|null}
 */
function extractQuantity(str) {
  if (!str) return null;
  const map = {
    'una': 1, 'un': 1, 'uno': 1,
    'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
    'media docena': 6, 'media': 6, 'docena': 12, 'una docena': 12, 'dos docenas': 24
  };
  const cleaned = str.trim().toLowerCase();
  if (map[cleaned]) return map[cleaned];
  const num = parseInt(cleaned, 10);
  if (!isNaN(num)) return num;
  return null;
}

/**
 * Detects if the message is an add/remove/change action for an item.
 * @param {string} message
 * @returns {'add'|'remove'|'change'|null}
 */
export function detectOrderAction(message) {
  const lower = message.toLowerCase();
  if (lower.match(/(agrega|sum(a|á)|añad(e|í|i)|pon(e|é)|incorpora|adiciona|agregame|sumame|añadime|poneme|incorporame|adicioname)/)) return 'add';
  if (lower.match(/(quita|saca|elimina|borra|remueve|sacame|quitame|eliminame|borrame|removeme)/)) return 'remove';
  if (lower.match(/(cambia|modifica|cambiar|modificar|cambiale|modificale|cambiame|modificame)/)) return 'change';
  return null;
}

/**
 * Detects if a message is a quantity-only message (e.g., 'una docena', '2', 'media docena').
 * Returns the parsed quantity or null.
 * @param {string} message
 * @returns {number|null}
 */
export function isQuantityOnlyMessage(message) {
  const lower = message.trim().toLowerCase();
  // Accepts numbers, 'una', 'un', 'uno', 'media docena', 'docena', etc.
  const regex = /^(\d+|una|un|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|media docena|media|docena|una docena|dos docenas)$/;
  const match = lower.match(regex);
  if (match) {
    return extractQuantity(match[1] || match[0]);
  }
  return null;
}

// Add similarity functions from gemini.js

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

// Helper to get singular and plural forms for matching
function getSingularAndPlural(word) {
  if (!word) return [];
  word = word.toLowerCase().trim();
  // Simple Spanish pluralization rules
  if (word.endsWith('s')) {
    // Plural to singular
    if (word.endsWith('es')) {
      return [word, word.slice(0, -2)];
    } else {
      return [word, word.slice(0, -1)];
    }
  } else {
    // Singular to plural
    if (word.endsWith('z')) {
      return [word, word.slice(0, -1) + 'ces'];
    } else {
      return [word, word + 's'];
    }
  }
}

// Normalize a string for matching (remove accents, lowercase, trim)
function normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9áéíóúüñ\s]/gi, '')
    .trim();
}

/**
 * Enhanced extraction: matches (quantity) + (category/item) + (optional 'de' + filling)
 * Handles 'docena', 'media docena', plurals, and fuzzy category+filling matching.
 * Now also matches all menu items containing the category word in singular or plural if no filling is specified.
 * @param {string} message - The user's message
 * @param {Array} menuItems - The menu items to match against
 * @returns {Array} Array of { itemId, itemName, quantity, action }
 */
export function extractOrderItemsAndQuantities(message, menuItems) {
  const resultsMap = new Map(); // key: itemId, value: { itemId, itemName, quantity }
  const normalizedMsg = normalize(message);
  // If the message contains 'no' (negation/correction), split and only use the last part
  let segments = normalizedMsg.split(/\bno\b/);
  let segmentToUse = segments[segments.length - 1].trim();
  // Enhanced regex to support plural 'docenas', 'medias docenas', and quantity before them
  const regex = /(?:(\d+|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?(media docena|media docenas|docena|docenas|medias docenas|[a-záéíóúüñ]+)(?:\s+de\s+([a-záéíóúüñ\s]+))?/gi;
  let match;
  while ((match = regex.exec(segmentToUse)) !== null) {
    let [, qtyRaw, categoryRaw, fillingRaw] = match;
    let quantity = 1;
    let itemForms = [];
    // Special handling for 'docena', 'docenas', 'media docena', 'medias docenas'
    const isDocena = /^(docena|docenas)$/.test(categoryRaw);
    const isMediaDocena = /^(media docena|media docenas|medias docenas)$/.test(categoryRaw);
    if ((isDocena || isMediaDocena) && fillingRaw) {
      let baseQty = isDocena ? 12 : 6;
      let multiplier = 1;
      if (qtyRaw) {
        const map = {
          'una': 1, 'un': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10
        };
        multiplier = map[qtyRaw] || parseInt(qtyRaw) || 1;
      }
      quantity = baseQty * multiplier;
      itemForms = getSingularAndPlural(fillingRaw.trim());
      // Try to match menu items where filling is a substring of the item name
      let fillingMatches = menuItems.filter(item => {
        const itemNameNorm = normalize(item.name);
        return itemForms.some(form => itemNameNorm.includes(form));
      });
      if (fillingMatches.length === 1) {
        const item = fillingMatches[0];
        resultsMap.set(item.id, { itemId: item.id, itemName: item.name, quantity });
        continue;
      } else if (fillingMatches.length > 1) {
        // Multiple matches, skip extraction so bot can ask for clarification
        continue;
      }
      // If no match, fallback to original logic
    } else {
      if (qtyRaw) {
        const map = {
          'una': 1, 'un': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10
        };
        quantity = map[qtyRaw] || parseInt(qtyRaw) || 1;
      }
      itemForms = getSingularAndPlural(categoryRaw);
    }
    // Try to match menu items by name (robust, both singular/plural)
    let matchedItems = menuItems.filter(item => {
      const itemNameNorm = normalize(item.name);
      if ((isDocena || isMediaDocena) && fillingRaw) {
        // For 'docenas de empanadas de carne', match fillingRaw
        return itemForms.some(form => itemNameNorm.includes(form));
      } else if (fillingRaw) {
        const fillingForms = getSingularAndPlural(fillingRaw);
        return itemForms.some(form => itemNameNorm.includes(form)) && fillingForms.some(form => itemNameNorm.includes(form));
      } else {
        return itemForms.some(form => itemNameNorm.includes(form));
      }
    });
    if (matchedItems.length === 0 && fillingRaw && menuItems[0]?.category) {
      matchedItems = menuItems.filter(item => {
        const catNorm = normalize(item.category || '');
        return itemForms.some(form => catNorm.includes(form));
      });
    }
    // For each item, keep only the largest quantity found in the message
    for (const item of matchedItems) {
      if (resultsMap.has(item.id)) {
        resultsMap.get(item.id).quantity = Math.max(resultsMap.get(item.id).quantity, quantity);
      } else {
        resultsMap.set(item.id, { itemId: item.id, itemName: item.name, quantity });
      }
    }
  }
  // If nothing matched, try matching the whole message to any menu item (fuzzy)
  if (resultsMap.size === 0) {
    for (const item of menuItems) {
      const itemNameNorm = normalize(item.name);
      if (segmentToUse.includes(itemNameNorm)) {
        resultsMap.set(item.id, { itemId: item.id, itemName: item.name, quantity: 1 });
      }
    }
  }
  const results = Array.from(resultsMap.values());
  console.log('[EXTRACT] extractOrderItemsAndQuantities:', { message, results });
  return results;
}

/**
 * Checks if the message is an order confirmation.
 * @param {string} message
 * @returns {boolean}
 */
export function isOrderConfirmation(message) {
  const lower = message.toLowerCase();
  return (
    lower.includes('confirmar') ||
    lower.includes('sí, está bien') ||
    lower.includes('listo') ||
    lower.includes('dale')
  );
}

/**
 * Checks if the message is an order cancellation.
 * @param {string} message
 * @returns {boolean}
 */
export function isOrderCancellation(message) {
  const lower = message.toLowerCase();
  return (
    lower.includes('cancelar') ||
    lower.includes('no quiero') ||
    lower.includes('olvidalo') ||
    lower.includes('me arrepentí')
  );
}

/**
 * Detects if the message is an 'add' intent (e.g., 'más', 'agrega', 'sumar', 'añade', etc.)
 * @param {string} message
 * @returns {boolean}
 */
export function isAddIntent(message) {
  const lower = message.toLowerCase();
  return (
    lower.includes('más') ||
    lower.includes('mas') ||
    lower.includes('agrega') ||
    lower.includes('sumar') ||
    lower.includes('suma') ||
    lower.includes('añade') ||
    lower.includes('añadir') ||
    lower.includes('agregá') ||
    lower.includes('sumá')
  );
}

/**
 * Detects if the message is a 'remove' intent (e.g., 'quita', 'saca', 'elimina', 'borra', 'remueve', 'menos', etc.)
 * @param {string} message
 * @returns {boolean}
 */
export function isRemoveIntent(message) {
  const lower = message.toLowerCase();
  return (
    lower.includes('quita') ||
    lower.includes('saca') ||
    lower.includes('elimina') ||
    lower.includes('borra') ||
    lower.includes('remueve') ||
    lower.includes('menos') ||
    lower.includes('sacá') ||
    lower.includes('quitá') ||
    lower.includes('eliminá') ||
    lower.includes('borrá') ||
    lower.includes('remové')
  );
} 