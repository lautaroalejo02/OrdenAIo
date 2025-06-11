/**
 * UNIVERSAL PRODUCT MATCHER
 * Works for any type of restaurant and menu
 * All user-facing texts are customizable via config.autoResponses
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

class UniversalProductMatcher {
  constructor(menuItems, aiRouter, config) {
    this.menuItems = menuItems;
    this.aiRouter = aiRouter;
    this.config = config || {};
    this.productIndex = this.buildProductIndex();
    this.categoryIndex = this.buildCategoryIndex();
    this.ingredientIndex = this.buildIngredientIndex();
  }

  /**
   * Helper: Extracts quantity from text (handles 'media docena', 'docena', etc)
   */
  parseQuantityFromText(text) {
    const lower = text.toLowerCase();
    // Common Spanish quantity phrases
    if (/media docena/.test(lower)) return 6;
    if (/una docena|un docena|docena/.test(lower)) return 12;
    if (/un cuarto/.test(lower)) return 3;
    // Numbers in text
    const numberMatch = lower.match(/(\d+)/);
    if (numberMatch) return parseInt(numberMatch[1], 10);
    // Words for numbers
    const wordToNumber = {
      'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10, 'once': 11, 'doce': 12
    };
    for (const [word, num] of Object.entries(wordToNumber)) {
      if (lower.includes(word)) return num;
    }
    return 1; // Default to 1 if not found
  }

  /**
   * Main method: finds product or suggests alternatives
   * Now extracts quantity from userRequest
   */
  async findProductOrSuggest(userRequest, customerProfile = null) {
    console.log(`[MATCHER] Searching for: "${userRequest}"`);
    const quantity = this.parseQuantityFromText(userRequest);
    // 1. Exact match
    const exactMatches = this.findExactMatches(userRequest);
    if (exactMatches.length > 0) {
      // Attach quantity to matches
      exactMatches.forEach(m => m.quantity = quantity);
      return {
        found: true,
        matches: exactMatches,
        type: 'exact_match',
        quantity
      };
    }
    // 2. Partial/fuzzy match
    const partialMatches = this.findPartialMatches(userRequest);
    if (partialMatches.length > 0) {
      partialMatches.forEach(m => m.quantity = quantity);
      return {
        found: true,
        matches: partialMatches,
        type: 'partial_match',
        message: this.buildPartialMatchMessage(userRequest, partialMatches),
        quantity
      };
    }
    // 3. No match: suggest alternatives
    const alternatives = await this.findIntelligentAlternatives(userRequest, customerProfile);
    return {
      found: false,
      alternatives: alternatives,
      type: 'suggestions',
      message: this.buildSuggestionMessage(userRequest, alternatives, customerProfile),
      quantity
    };
  }

  buildProductIndex() {
    const index = new Map();
    this.menuItems.forEach(item => {
      const nameWords = this.extractKeywords(item.name);
      nameWords.forEach(word => {
        if (!index.has(word)) index.set(word, []);
        index.get(word).push({ item, source: 'name', score: 1.0 });
      });
      if (item.description) {
        const descWords = this.extractKeywords(item.description);
        descWords.forEach(word => {
          if (!index.has(word)) index.set(word, []);
          index.get(word).push({ item, source: 'description', score: 0.8 });
        });
      }
      if (item.category) {
        const catWords = this.extractKeywords(item.category);
        catWords.forEach(word => {
          if (!index.has(word)) index.set(word, []);
          index.get(word).push({ item, source: 'category', score: 0.9 });
        });
      }
    });
    return index;
  }

  buildCategoryIndex() {
    const categories = new Map();
    this.menuItems.forEach(item => {
      const category = item.category || 'otros';
      if (!categories.has(category)) categories.set(category, []);
      categories.get(category).push(item);
    });
    return categories;
  }

  buildIngredientIndex() {
    const ingredients = new Map();
    this.menuItems.forEach(item => {
      const text = `${item.name} ${item.description || ''}`.toLowerCase();
      const detectedIngredients = this.detectIngredients(text);
      detectedIngredients.forEach(ingredient => {
        if (!ingredients.has(ingredient)) ingredients.set(ingredient, []);
        ingredients.get(ingredient).push(item);
      });
    });
    return ingredients;
  }

  detectIngredients(text) {
    const commonIngredients = [
      'pollo', 'carne', 'cerdo', 'jamón', 'jamon', 'chorizo', 'bacon', 'pavo', 'res',
      'pescado', 'salmón', 'atún', 'camarón', 'langostino', 'mariscos',
      'tomate', 'cebolla', 'lechuga', 'pepino', 'zanahoria', 'apio', 'pimiento',
      'champiñón', 'hongos', 'aceitunas', 'aguacate', 'palta', 'espinaca',
      'queso', 'mozzarella', 'parmesano', 'cheddar', 'ricotta', 'crema', 'yogurt',
      'huevo', 'pasta', 'arroz', 'papa', 'papas', 'pan', 'masa', 'salsa',
      'mayonesa', 'mostaza', 'ketchup', 'chimichurri'
    ];
    return commonIngredients.filter(ingredient => text.includes(ingredient));
  }

  findExactMatches(userRequest) {
    const keywords = this.extractKeywords(userRequest);
    const matches = new Map();
    keywords.forEach(keyword => {
      if (this.productIndex.has(keyword)) {
        this.productIndex.get(keyword).forEach(({ item, source, score }) => {
          const key = item.id;
          if (!matches.has(key) || matches.get(key).score < score) {
            matches.set(key, { item, score, matchedBy: source });
          }
        });
      }
    });
    return Array.from(matches.values())
      .filter(match => match.score >= 0.8)
      .sort((a, b) => b.score - a.score);
  }

  findPartialMatches(userRequest) {
    const keywords = this.extractKeywords(userRequest);
    const matches = new Map();
    this.menuItems.forEach(item => {
      let totalScore = 0;
      let matchCount = 0;
      keywords.forEach(keyword => {
        const itemText = `${item.name} ${item.description || ''} ${item.category || ''}`.toLowerCase();
        if (itemText.includes(keyword) || keyword.includes(itemText.split(' ')[0])) {
          totalScore += 0.6;
          matchCount++;
        }
        const phoneticScore = this.calculatePhoneticSimilarity(keyword, itemText);
        if (phoneticScore > 0.7) {
          totalScore += phoneticScore * 0.5;
          matchCount++;
        }
      });
      if (matchCount > 0) {
        const avgScore = totalScore / keywords.length;
        if (avgScore > 0.4) {
          matches.set(item.id, { item, score: avgScore, matchType: 'partial' });
        }
      }
    });
    return Array.from(matches.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }

  async findIntelligentAlternatives(userRequest, customerProfile) {
    const alternatives = [];
    const aiAnalysis = await this.analyzeRequestWithAI(userRequest);
    if (aiAnalysis.category) {
      const categoryItems = this.findByCategory(aiAnalysis.category);
      alternatives.push(...categoryItems.map(item => ({
        item,
        reason: `Producto similar de ${aiAnalysis.category}`,
        score: 0.8,
        type: 'category'
      })));
    }
    if (aiAnalysis.characteristics && aiAnalysis.characteristics.length > 0) {
      const characteristicItems = this.findByCharacteristics(aiAnalysis.characteristics);
      alternatives.push(...characteristicItems.map(item => ({
        item,
        reason: `Tiene características similares`,
        score: 0.7,
        type: 'characteristics'
      })));
    }
    if (customerProfile && customerProfile.favoriteItems) {
      const preferenceItems = this.findByCustomerPreferences(customerProfile.favoriteItems);
      alternatives.push(...preferenceItems.map(item => ({
        item,
        reason: `Basado en tus gustos anteriores`,
        score: 0.9,
        type: 'preference'
      })));
    }
    const popularItems = this.getPopularItems();
    alternatives.push(...popularItems.map(item => ({
      item,
      reason: `Uno de nuestros más populares`,
      score: 0.6,
      type: 'popular'
    })));
    return this.deduplicateAndRank(alternatives).slice(0, 4);
  }

  async analyzeRequestWithAI(userRequest) {
    try {
      const prompt = `Analiza esta solicitud de comida y extrae información:\n\nSolicitud: "${userRequest}"\n\nResponde SOLO en JSON:\n{\n  "category": "tipo de comida (pizza, pasta, carne, bebida, postre, etc)",\n  "characteristics": ["características buscadas"],\n  "mood": "casual|formal|quick|comfort",\n  "dietaryNeeds": ["vegetariano", "sin gluten", etc],\n  "mealTime": "desayuno|almuerzo|cena|snack"\n}`;
      const completion = await this.aiRouter.groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama3-8b-8192",
        temperature: 0.1,
        max_tokens: 200
      });
      return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
      console.error('[MATCHER] AI analysis failed:', error);
      return { category: null, characteristics: [] };
    }
  }

  findByCategory(requestedCategory) {
    const normalizedCategory = requestedCategory.toLowerCase();
    const categoryMappings = {
      'pizza': ['pizza', 'italiana'],
      'pasta': ['pasta', 'italiana', 'fideos'],
      'carne': ['carne', 'parrilla', 'asado'],
      'pollo': ['pollo', 'aves'],
      'pescado': ['pescado', 'mariscos', 'mar'],
      'vegetariano': ['vegetariano', 'verdura', 'ensalada'],
      'bebida': ['bebida', 'líquido', 'refresco'],
      'postre': ['postre', 'dulce', 'helado']
    };
    const possibleCategories = categoryMappings[normalizedCategory] || [normalizedCategory];
    const matches = [];
    possibleCategories.forEach(cat => {
      const categoryItems = Array.from(this.categoryIndex.entries())
        .filter(([category, items]) => category.toLowerCase().includes(cat))
        .flatMap(([category, items]) => items);
      matches.push(...categoryItems);
    });
    return [...new Set(matches)];
  }

  findByCharacteristics(characteristics) {
    const matches = [];
    characteristics.forEach(char => {
      const charMatches = this.menuItems.filter(item => {
        const text = `${item.name} ${item.description || ''}`.toLowerCase();
        return text.includes(char.toLowerCase());
      });
      matches.push(...charMatches);
    });
    return [...new Set(matches)];
  }

  findByCustomerPreferences(favoriteItems) {
    const matches = [];
    favoriteItems.forEach(favorite => {
      const preferenceMatches = this.menuItems.filter(item => {
        const favoriteWords = this.extractKeywords(favorite);
        const itemWords = this.extractKeywords(item.name);
        const commonWords = favoriteWords.filter(word =>
          itemWords.some(itemWord => itemWord.includes(word) || word.includes(itemWord))
        );
        return commonWords.length > 0;
      });
      matches.push(...preferenceMatches);
    });
    return [...new Set(matches)];
  }

  getPopularItems() {
    return this.menuItems.slice(0, 3);
  }

  buildSuggestionMessage(userRequest, alternatives, customerProfile) {
    // Use config.autoResponses if available
    const custom = this.getCustomText('productNotFound',
      `No tenemos "${userRequest}" disponible. ¿Te gustaría ver nuestro menú completo? 📋`);
    if (alternatives.length === 0) {
      return custom;
    }
    let message = this.getCustomText('suggestionHeader',
      `No tenemos **"${userRequest}"** en este momento, pero puedo sugerirte algo delicioso:\n\n`);
    alternatives.forEach((alt, index) => {
      const emoji = this.getUniversalEmoji(alt.item);
      message += `${emoji} **${alt.item.name}** - $${alt.item.price.toLocaleString()}`;
      if (alt.reason) {
        message += ` _(${alt.reason})_`;
      }
      if (alt.item.description) {
        message += `\n   📝 ${alt.item.description.substring(0, 50)}...`;
      }
      message += '\n\n';
    });
    if (customerProfile && customerProfile.orderCount > 5) {
      message += this.getCustomText('suggestionFrequent',
        '¿Cuál te gustaría probar hoy? 😊 Como cliente frecuente, ¡seguro te va a encantar!');
    } else {
      message += this.getCustomText('suggestionDefault',
        '¿Cuál te llama la atención? ¡Te aseguro que están deliciosas! 😋');
    }
    return message;
  }

  buildPartialMatchMessage(userRequest, matches) {
    if (matches.length === 1) {
      const match = matches[0];
      return this.getCustomText('partialMatchOne',
        `¿Te refieres a **${match.item.name}**? ($${match.item.price.toLocaleString()})`);
    }
    let message = this.getCustomText('partialMatchHeader',
      `Encontré varias opciones similares a "${userRequest}":\n\n`);
    matches.forEach((match, index) => {
      const emoji = this.getUniversalEmoji(match.item);
      message += `${index + 1}. ${emoji} **${match.item.name}** - $${match.item.price.toLocaleString()}\n`;
    });
    message += '\n¿A cuál te referías? Responde con el número o el nombre completo.';
    return message;
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
    if (text.includes('pasta') || text.includes('fideos')) return '🍝';
    if (text.includes('ensalada')) return '🥗';
    if (text.includes('sushi')) return '🍣';
    if (text.includes('pollo')) return '🍗';
    if (text.includes('pescado')) return '🐟';
    if (text.includes('carne') || text.includes('steak')) return '🥩';
    if (text.includes('hot dog') || text.includes('perro')) return '🌭';
    if (text.includes('sandwich') || text.includes('sándwich')) return '🥪';
    if (text.includes('café') || text.includes('coffee')) return '☕';
    if (text.includes('cerveza') || text.includes('beer')) return '🍺';
    if (text.includes('vino') || text.includes('wine')) return '🍷';
    if (text.includes('agua') || text.includes('water')) return '💧';
    if (text.includes('jugo') || text.includes('juice')) return '🧃';
    if (text.includes('refresco') || text.includes('soda') || text.includes('coca')) return '🥤';
    if (text.includes('helado') || text.includes('ice cream')) return '🍦';
    if (text.includes('torta') || text.includes('cake')) return '🍰';
    if (text.includes('galleta') || text.includes('cookie')) return '🍪';
    if (text.includes('flan') || text.includes('pudding')) return '🍮';
    return '🍽️';
  }

  extractKeywords(text) {
    if (!text) return [];
    return text.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word =>
        word.length > 2 &&
        !['con', 'sin', 'para', 'por', 'una', 'dos', 'tres', 'de', 'la', 'el', 'y', 'o'].includes(word)
      );
  }

  calculatePhoneticSimilarity(str1, str2) {
    const clean1 = str1.replace(/[áéíóú]/g, match => 'aeiou'['áéíóú'.indexOf(match)]);
    const clean2 = str2.replace(/[áéíóú]/g, match => 'aeiou'['áéíóú'.indexOf(match)]);
    const longer = clean1.length > clean2.length ? clean1 : clean2;
    const shorter = clean1.length > clean2.length ? clean2 : clean1;
    if (longer.length === 0) return 1;
    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  levenshteinDistance(str1, str2) {
    const matrix = Array.from({ length: str1.length + 1 }, () =>
      Array(str2.length + 1).fill(0)
    );
    for (let i = 0; i <= str1.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= str2.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= str1.length; i++) {
      for (let j = 1; j <= str2.length; j++) {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + (str1[i - 1] === str2[j - 1] ? 0 : 1)
        );
      }
    }
    return matrix[str1.length][str2.length];
  }

  deduplicateAndRank(alternatives) {
    const seen = new Map();
    alternatives.forEach(alt => {
      const key = alt.item.id;
      if (!seen.has(key) || seen.get(key).score < alt.score) {
        seen.set(key, alt);
      }
    });
    return Array.from(seen.values())
      .sort((a, b) => b.score - a.score);
  }

  getCustomText(key, defaultText) {
    if (this.config && this.config.autoResponses && this.config.autoResponses[key]) {
      return this.config.autoResponses[key];
    }
    return defaultText;
  }
}

export default UniversalProductMatcher; 