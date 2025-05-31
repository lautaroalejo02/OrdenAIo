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
 * UNIVERSAL EXTRACTION FUNCTION THAT WORKS
 * Replaces the previous extractOrderItemsAndQuantities
 */
export function extractOrderItemsAndQuantities(message, menuItems) {
  console.log('[EXTRACT] Universal extraction for:', message);
  
  if (!message || !menuItems || menuItems.length === 0) {
    return [];
  }

  const results = [];
  const normalized = message.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  console.log('[EXTRACT] Normalized:', normalized);

  // STEP 1: Special quantities (docena, media docena, par)
  const specialPatterns = [
    { 
      regex: /(?:(\d+)\s+)?(?:media\s+)?docenas?\s*(?:de\s+)?(.+?)(?:\s|$)/gi, 
      multiplier: 12,
      name: 'docena'
    },
    { 
      regex: /(?:(\d+)\s+)?medias?\s+docenas?\s*(?:de\s+)?(.+?)(?:\s|$)/gi, 
      multiplier: 6,
      name: 'media_docena'
    },
    { 
      regex: /media\s+docena\s*(?:de\s+)?(.+?)(?:\s|$)/gi, 
      multiplier: 6,
      name: 'media_docena_simple'
    },
    {
      regex: /(?:un\s+)?par\s*(?:de\s+)?(.+?)(?:\s|$)/gi,
      multiplier: 2,
      name: 'par'
    }
  ];

  for (const pattern of specialPatterns) {
    let match;
    const regex = new RegExp(pattern.regex.source, 'gi');
    
    while ((match = regex.exec(normalized)) !== null) {
      const count = parseInt(match[1]) || 1;
      const productPhrase = (match[2] || match[1] || '').trim();
      const quantity = pattern.multiplier * count;
      
      console.log(`[EXTRACT] ${pattern.name} found:`, { count, productPhrase, quantity });

      if (productPhrase.length > 2) {
        const matchedItems = findProductMatches(productPhrase, menuItems);
        
        for (const item of matchedItems) {
          results.push({
            itemId: item.id,
            itemName: item.name,
            quantity: quantity,
            confidence: 0.9,
            method: pattern.name
          });
          console.log('[EXTRACT] Added:', item.name, 'qty:', quantity);
        }
      }
    }
  }

  // STEP 2: Normal quantities if no special found
  if (results.length === 0) {
    const normalPatterns = [
      /(\d+)\s+(.+?)(?:\s|$)/gi,  // "3 empanadas"
      /(una?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(.+?)(?:\s|$)/gi,  // "dos pizzas"
      /quiero\s+(\d+|una?|dos|tres)\s+(.+?)(?:\s|$)/gi,  // "quiero 2 empanadas"
      /(?:dame|vendeme|necesito)\s+(.+?)(?:\s|$)/gi,  // "dame pizza"
      /(.+?)\s*(?:por|x)\s*(\d+)/gi  // "empanada x 3"
    ];

    for (const pattern of normalPatterns) {
      let match;
      const regex = new RegExp(pattern.source, 'gi');
      
      while ((match = regex.exec(normalized)) !== null) {
        let quantity = 1;
        let productPhrase = '';

        // Determine quantity and product
        if (pattern.source.includes('\\d+.*\\.+')) {
          // Pattern "3 empanadas"
          quantity = parseInt(match[1]) || 1;
          productPhrase = match[2];
        } else if (pattern.source.includes('una?|dos')) {
          // Pattern "dos empanadas"
          const qtyMap = {
            'una': 1, 'un': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 
            'cinco': 5, 'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10
          };
          quantity = qtyMap[match[1]] || 1;
          productPhrase = match[2];
        } else if (pattern.source.includes('dame|vendeme')) {
          // Pattern "dame pizza"
          productPhrase = match[1];
          quantity = 1;
        } else if (pattern.source.includes('por|x')) {
          // Pattern "empanada x 3"
          productPhrase = match[1];
          quantity = parseInt(match[2]) || 1;
        } else if (pattern.source.includes('quiero')) {
          // Pattern "quiero 2 empanadas"
          if (isNaN(parseInt(match[1]))) {
            const qtyMap = { 'una': 1, 'un': 1, 'dos': 2, 'tres': 3 };
            quantity = qtyMap[match[1]] || 1;
          } else {
            quantity = parseInt(match[1]) || 1;
          }
          productPhrase = match[2];
        }

        console.log('[EXTRACT] Normal pattern found:', { quantity, productPhrase });

        if (productPhrase && productPhrase.length > 2) {
          const matchedItems = findProductMatches(productPhrase, menuItems);
          
          for (const item of matchedItems) {
            results.push({
              itemId: item.id,
              itemName: item.name,
              quantity: quantity,
              confidence: 0.8,
              method: 'normal_pattern'
            });
            console.log('[EXTRACT] Added normal:', item.name, 'qty:', quantity);
          }
        }
      }
    }
  }

  // STEP 3: Fallback - find any mentioned product
  if (results.length === 0) {
    console.log('[EXTRACT] Trying fallback matching...');
    
    const words = normalized.split(/\s+/).filter(w => w.length > 2);
    
    for (const item of menuItems) {
      const itemWords = item.name.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2);
      
      // Find word matches
      const matchingWords = words.filter(word => 
        itemWords.some(itemWord => 
          itemWord.includes(word) || word.includes(itemWord)
        )
      );
      
      if (matchingWords.length > 0) {
        results.push({
          itemId: item.id,
          itemName: item.name,
          quantity: 1,
          confidence: 0.6,
          method: 'fallback'
        });
        console.log('[EXTRACT] Fallback match:', item.name);
        break; // Only take the first match in fallback
      }
    }
  }

  // Remove duplicates and keep highest confidence
  const deduped = deduplicateResults(results);
  
  console.log('[EXTRACT] Final results:', deduped);
  return deduped;
}

/**
 * Finds products that match a phrase
 */
function findProductMatches(phrase, menuItems) {
  if (!phrase || phrase.length < 2) return [];

  const matches = [];
  const phraseWords = phrase.split(/\s+/).filter(w => w.length > 2);

  for (const item of menuItems) {
    const score = calculateProductMatchScore(phraseWords, item);
    if (score > 0.3) {
      matches.push({ item, score });
    }
  }

  // Sort by score and return best
  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)  // Max 2 matches per phrase
    .map(m => m.item);
}

/**
 * Calculates match score between phrase words and product
 */
function calculateProductMatchScore(phraseWords, item) {
  const itemText = [
    item.name,
    item.category || '',
    item.description || ''
  ].join(' ').toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const itemWords = itemText.split(/\s+/).filter(w => w.length > 2);

  if (phraseWords.length === 0 || itemWords.length === 0) return 0;

  let score = 0;
  
  for (const phraseWord of phraseWords) {
    let bestWordScore = 0;
    
    for (const itemWord of itemWords) {
      // Exact match
      if (phraseWord === itemWord) {
        bestWordScore = 1;
        break;
      }
      
      // Contains the word
      if (itemWord.includes(phraseWord)) {
        bestWordScore = Math.max(bestWordScore, 0.9);
      } else if (phraseWord.includes(itemWord)) {
        bestWordScore = Math.max(bestWordScore, 0.8);
      }
      
      // Similarity by common prefix length
      const commonLength = getCommonPrefixLength(phraseWord, itemWord);
      if (commonLength >= 3) {
        const similarity = commonLength / Math.max(phraseWord.length, itemWord.length);
        bestWordScore = Math.max(bestWordScore, similarity * 0.7);
      }
    }
    
    score += bestWordScore;
  }

  return score / phraseWords.length;
}

/**
 * Gets common prefix length
 */
function getCommonPrefixLength(str1, str2) {
  let i = 0;
  while (i < str1.length && i < str2.length && str1[i] === str2[i]) {
    i++;
  }
  return i;
}

/**
 * Removes duplicates keeping highest confidence
 */
function deduplicateResults(results) {
  const seen = new Map();
  
  for (const result of results) {
    const key = result.itemId;
    if (!seen.has(key) || seen.get(key).confidence < result.confidence) {
      seen.set(key, result);
    }
  }
  
  return Array.from(seen.values())
    .sort((a, b) => b.confidence - a.confidence);
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

/**
 * Detects if the message is a 'replace' intent (e.g., 'solo', 'nomás', 'nada más', 'únicamente', etc.)
 * @param {string} message
 * @returns {boolean}
 */
export function detectReplaceIntent(message) {
  const lower = message.toLowerCase();
  return (
    lower.includes('solo ') ||
    lower.includes('sólo ') ||
    lower.includes('nomás') ||
    lower.includes('nomas') ||
    lower.includes('nada más') ||
    lower.includes('únicamente') ||
    lower.includes('solamente') ||
    lower.includes('dejar solo') ||
    lower.includes('deja solo')
  );
} 