// UniversalQuantityParser: Extracts quantities and product names from Spanish natural language
// Example: 'media docena de carne y 3 de pollo' => [{quantity: 6, productName: 'carne'}, {quantity: 3, productName: 'pollo'}]

const quantityWords = {
  'media docena': 6,
  'una docena': 12,
  'un docena': 12,
  'docena': 12,
  'un cuarto': 3,
  'par': 2,
  'una pareja': 2,
  'un par': 2
};
const numberWords = {
  'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10, 'once': 11, 'doce': 12
};

function parseQuantities(text) {
  const lower = text.toLowerCase();
  const results = [];
  // Handle patterns like 'media docena de carne y 3 de pollo'
  const parts = lower.split(/y|,|\band\b/);
  for (let part of parts) {
    part = part.trim();
    let quantity = 1;
    let productName = '';
    // Check for explicit quantity words
    for (const [phrase, value] of Object.entries(quantityWords)) {
      if (part.includes(phrase)) {
        quantity = value;
        part = part.replace(phrase, '').trim();
        break;
      }
    }
    // Check for number words
    for (const [word, value] of Object.entries(numberWords)) {
      if (part.includes(word)) {
        quantity = value;
        part = part.replace(word, '').trim();
        break;
      }
    }
    // Check for digits
    const digitMatch = part.match(/(\d+)/);
    if (digitMatch) {
      quantity = parseInt(digitMatch[1], 10);
      part = part.replace(digitMatch[0], '').trim();
    }
    // Extract product name
    productName = part.replace(/^de\s+/, '').trim();
    if (productName) {
      results.push({ quantity, productName });
    }
  }
  return results;
}

export { parseQuantities }; 