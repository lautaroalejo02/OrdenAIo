import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config({ path: join(__dirname, '.env') });

import IntelligentOrderProcessor from './src/services/intelligentOrderProcessor.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function setupTestEnvironment() {
  console.log('🔧 Setting up test environment...\n');
  
  try {
    // Clean up existing test data in correct order (foreign key constraints)
    await prisma.order.deleteMany({ where: { conversation: { phoneNumber: 'test123' } } });
    await prisma.orderDraft.deleteMany({ where: { conversation: { phoneNumber: 'test123' } } });
    await prisma.conversation.deleteMany({ where: { phoneNumber: 'test123' } });
    
    // Delete existing config to ensure fresh setup
    await prisma.restaurantConfig.deleteMany({});
    
    // Create test-friendly hours (always open for testing)
    const now = new Date();
    const currentHour = now.getHours().toString().padStart(2, '0');
    const openTime = `${currentHour}:00`;
    const closeTime = `${(parseInt(currentHour) + 2).toString().padStart(2, '0')}:00`;
    
    // Create restaurant config with current time to ensure it's "open"
    const config = await prisma.restaurantConfig.create({
      data: {
        restaurantName: 'Restaurante La Esquina',
        menuItems: JSON.stringify([
          { id: '1', name: 'Empanada de carne', price: 7, description: 'Deliciosa empanada casera de carne', category: 'Empanadas' },
          { id: '2', name: 'Empanada de Pollo', price: 7, description: 'Empanada de pollo con especias', category: 'Empanadas' },
          { id: '3', name: 'Pizza Margarita', price: 25, description: 'Pizza con mozzarella y albahaca', category: 'Pizzas' },
          { id: '4', name: 'Gaseosa Coca Cola', price: 5, description: 'Bebida 500ml', category: 'Bebidas' }
        ]),
        openingHours: JSON.stringify({
          monday: { open: openTime, close: closeTime },
          tuesday: { open: openTime, close: closeTime },
          wednesday: { open: openTime, close: closeTime },
          thursday: { open: openTime, close: closeTime },
          friday: { open: openTime, close: closeTime },
          saturday: { open: openTime, close: closeTime },
          sunday: { open: openTime, close: closeTime }
        }),
        deliveryZones: JSON.stringify({
          'Centro': { cost: 50, time: '30-45 min' },
          'Barrio Norte': { cost: 80, time: '45-60 min' },
          'Zona Sur': { cost: 100, time: '45-60 min' },
          'Cercanías': { cost: 120, time: '60-75 min' }
        }),
        preparationTimes: JSON.stringify({
          'Empanadas': 15,
          'Pizzas': 25,
          'Bebidas': 2,
          'General': 20
        }),
        autoResponses: JSON.stringify({})
      }
    });
    
    console.log(`✅ Test environment setup complete - Restaurant open from ${openTime} to ${closeTime}`);
    return config;
    
  } catch (error) {
    console.error('❌ Error setting up test environment:', error);
    throw error;
  }
}

async function runIntelligentTests() {
  console.log('🧠 =============== INTELLIGENT AI ORDER PROCESSOR TESTS ===============\n');
  
  if (!process.env.OPENAI_API_KEY) {
    console.log('⚠️  OPENAI_API_KEY not found in environment variables');
    console.log('ℹ️  Some tests will be skipped');
    return;
  }
  
  const processor = new IntelligentOrderProcessor();
  const testPhone = 'test123';
  
  await setupTestEnvironment();
  
  const menuItems = [
    { id: '1', name: 'Empanada de carne', price: 7, description: 'Deliciosa empanada casera de carne', category: 'Empanadas' },
    { id: '2', name: 'Empanada de Pollo', price: 7, description: 'Empanada de pollo con especias', category: 'Empanadas' },
    { id: '3', name: 'Pizza Margarita', price: 25, description: 'Pizza con mozzarella y albahaca', category: 'Pizzas' },
    { id: '4', name: 'Gaseosa Coca Cola', price: 5, description: 'Bebida 500ml', category: 'Bebidas' }
  ];

  const testCases = [
    {
      description: '🔥 CRITICAL BUG FIX TEST - "una docena de empanadas de pollo"',
      message: 'Quiero una docena de empanadas de pollo',
      expectedItems: [{ itemId: '2', quantity: 12 }],
      shouldNotInclude: [{ itemId: '1' }] // Should NOT include carne empanadas
    },
    {
      description: '📋 Show menu test',
      message: 'mostrame el menú',
      expectedIntent: 'menu'
    },
    {
      description: '📍 Show delivery zones test',
      message: 'que zonas de delivery tienen?',
      expectedIntent: 'delivery_zones'
    },
    {
      description: '🕙 Show opening hours test',
      message: 'cuales son los horarios?',
      expectedIntent: 'hours'
    },
    {
      description: '⏱️ Complex order with multiple categories',
      message: 'quiero 2 empanadas de carne, una pizza margarita y una coca cola',
      expectedItems: [
        { itemId: '1', quantity: 2 },
        { itemId: '3', quantity: 1 },
        { itemId: '4', quantity: 1 }
      ]
    },
    {
      description: '🧠 Argentine quantities understanding',
      message: 'media docena de empanadas de pollo y docena y media de carne',
      expectedItems: [
        { itemId: '2', quantity: 6 },
        { itemId: '1', quantity: 18 }
      ]
    },
    {
      description: '❓ Ambiguous order (needs clarification)',
      message: 'quiero una empanada',
      expectedIntent: 'clarification'
    },
    {
      description: '🚫 OFF-TOPIC: Politics question',
      message: '¿Qué pensás sobre las elecciones?',
      expectedIntent: 'off_topic'
    },
    {
      description: '🚫 OFF-TOPIC: Sports question',
      message: '¿Viste el partido de Boca ayer?',
      expectedIntent: 'off_topic'
    },
    {
      description: '🚫 OFF-TOPIC: Weather question',
      message: '¿Va a llover mañana?',
      expectedIntent: 'off_topic'
    }
  ];

  console.log(`Running ${testCases.length} test cases...\n`);

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`🧪 Test ${i + 1}: ${testCase.description}`);
    console.log(`💬 Message: "${testCase.message}"`);
    
    try {
      const result = await processor.processOrder(testCase.message, testPhone, menuItems);
      
      console.log(`🤖 AI Service: ${result.aiService}`);
      console.log(`✉️  Response: ${result.response}`);
      
      // Validate expected intent
      if (testCase.expectedIntent) {
        if (result.intent === testCase.expectedIntent) {
          console.log(`✅ Intent match: ${result.intent}`);
        } else {
          console.log(`❌ Intent mismatch: expected '${testCase.expectedIntent}', got '${result.intent}'`);
        }
      }
      
      // Validate expected items
      if (testCase.expectedItems) {
        console.log(`📋 Expected items: ${JSON.stringify(testCase.expectedItems)}`);
        if (result.items) {
          console.log(`📦 Actual items: ${JSON.stringify(result.items.map(item => ({ itemId: item.itemId, quantity: item.quantity })))}`);
          
          let allMatch = true;
          for (const expected of testCase.expectedItems) {
            const found = result.items.find(item => item.itemId === expected.itemId && item.quantity === expected.quantity);
            if (!found) {
              console.log(`❌ Missing expected item: ${JSON.stringify(expected)}`);
              allMatch = false;
            }
          }
          
          if (allMatch && result.items.length === testCase.expectedItems.length) {
            console.log(`✅ All items match perfectly`);
          }
        } else {
          console.log(`❌ No items returned, but expected: ${JSON.stringify(testCase.expectedItems)}`);
        }
      }
      
      // Validate items that should NOT be included
      if (testCase.shouldNotInclude && result.items) {
        for (const shouldNotHave of testCase.shouldNotInclude) {
          const found = result.items.find(item => item.itemId === shouldNotHave.itemId);
          if (found) {
            console.log(`❌ CRITICAL: Found item that should NOT be included: ${JSON.stringify(found)}`);
          } else {
            console.log(`✅ Correctly excluded unwanted item: ${shouldNotHave.itemId}`);
          }
        }
      }
      
      // Show preparation time if included
      if (result.response.includes('⏱️')) {
        console.log(`✅ Preparation time included in response`);
      }
      
    } catch (error) {
      console.log(`❌ Test failed with error: ${error.message}`);
    }
    
    console.log('─'.repeat(80));
    
    // Wait a bit between tests to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Test order confirmation
  console.log('\n🔄 Testing order confirmation flow...');
  try {
    const confirmResult = await processor.processOrder('confirmar pedido', testPhone, menuItems);
    console.log(`✉️  Confirmation response: ${confirmResult.response}`);
    if (confirmResult.intent === 'order_confirmed') {
      console.log('✅ Order confirmation working correctly');
    }
  } catch (error) {
    console.log(`❌ Confirmation test failed: ${error.message}`);
  }
}

async function testOpeningHours() {
  console.log('\n🕙 Testing opening hours functionality...');
  
  const processor = new IntelligentOrderProcessor();
  const testPhone = 'test_hours';
  
  const menuItems = [
    { id: '1', name: 'Empanada de carne', price: 7 }
  ];

  try {
    // For this test, we want to show the static hours display
    await prisma.restaurantConfig.deleteMany({});
    const testConfig = await prisma.restaurantConfig.create({
      data: {
        restaurantName: 'Restaurante La Esquina',
        menuItems: JSON.stringify([{ id: '1', name: 'Empanada de carne', price: 7 }]),
        openingHours: JSON.stringify({
          monday: { open: '18:00', close: '23:00' },
          tuesday: { open: '18:00', close: '23:00' },
          wednesday: { open: '18:00', close: '23:00' },
          thursday: { open: '18:00', close: '23:00' },
          friday: { open: '18:00', close: '00:00' },
          saturday: { open: '18:00', close: '00:00' },
          sunday: { open: '18:00', close: '23:00' }
        }),
        deliveryZones: JSON.stringify({}),
        preparationTimes: JSON.stringify({}),
        autoResponses: JSON.stringify({})
      }
    });
    
    const result = await processor.processOrder('horarios de atencion', testPhone, menuItems);
    console.log(`✉️  Hours response: ${result.response}`);
    
    if (result.response.includes('Lunes') && result.response.includes('18:00')) {
      console.log('✅ Opening hours displayed in Spanish correctly');
    } else {
      console.log('❌ Opening hours format incorrect');
    }
  } catch (error) {
    console.log(`❌ Hours test failed: ${error.message}`);
  }
}

async function testDeliveryZones() {
  console.log('\n📍 Testing delivery zones functionality...');
  
  const processor = new IntelligentOrderProcessor();
  const testPhone = 'test_zones';
  
  const menuItems = [
    { id: '1', name: 'Empanada de carne', price: 7 }
  ];

  try {
    // Create config with current time to be open + delivery zones
    const now = new Date();
    const currentHour = now.getHours().toString().padStart(2, '0');
    const openTime = `${currentHour}:00`;
    const closeTime = `${(parseInt(currentHour) + 2).toString().padStart(2, '0')}:00`;
    
    await prisma.restaurantConfig.deleteMany({});
    const testConfig = await prisma.restaurantConfig.create({
      data: {
        restaurantName: 'Restaurante La Esquina',
        menuItems: JSON.stringify([{ id: '1', name: 'Empanada de carne', price: 7 }]),
        openingHours: JSON.stringify({
          monday: { open: openTime, close: closeTime },
          tuesday: { open: openTime, close: closeTime },
          wednesday: { open: openTime, close: closeTime },
          thursday: { open: openTime, close: closeTime },
          friday: { open: openTime, close: closeTime },
          saturday: { open: openTime, close: closeTime },
          sunday: { open: openTime, close: closeTime }
        }),
        deliveryZones: JSON.stringify({
          'Centro': { cost: 50, time: '30-45 min' },
          'Barrio Norte': { cost: 80, time: '45-60 min' },
          'Zona Sur': { cost: 100, time: '45-60 min' },
          'Cercanías': { cost: 120, time: '60-75 min' }
        }),
        preparationTimes: JSON.stringify({}),
        autoResponses: JSON.stringify({})
      }
    });
    
    const result = await processor.processOrder('zonas de delivery', testPhone, menuItems);
    console.log(`✉️  Zones response: ${result.response}`);
    
    if (result.response.includes('Centro') && result.response.includes('$50')) {
      console.log('✅ Delivery zones displayed correctly');
    } else {
      console.log('❌ Delivery zones format incorrect');
    }
  } catch (error) {
    console.log(`❌ Zones test failed: ${error.message}`);
  }
}

// Cleanup function
async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');
  try {
    // Delete in order to respect foreign key constraints
    await prisma.order.deleteMany({ where: { conversation: { phoneNumber: { startsWith: 'test' } } } });
    await prisma.orderDraft.deleteMany({ where: { conversation: { phoneNumber: { startsWith: 'test' } } } });
    await prisma.conversation.deleteMany({ where: { phoneNumber: { startsWith: 'test' } } });
    await prisma.restaurantConfig.deleteMany({});
    console.log('✅ Cleanup complete');
  } catch (error) {
    console.log(`❌ Cleanup failed: ${error.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

// Run all tests
async function main() {
  try {
    await runIntelligentTests();
    await testOpeningHours();
    await testDeliveryZones();
  } catch (error) {
    console.error('Test suite failed:', error);
  } finally {
    await cleanup();
  }
}

main(); 