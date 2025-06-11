import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function checkMenuConfiguration() {
  console.log('🔍 Checking restaurant menu configuration...\n');
  
  try {
    const config = await prisma.restaurantConfig.findFirst();
    
    if (!config) {
      console.log('❌ No restaurant configuration found in database!');
      console.log('🔧 You need to create initial configuration through the admin dashboard.');
      return;
    }
    
    console.log(`✅ Restaurant found: ${config.restaurantName || 'Unknown'}`);
    
    let menuItems = config.menuItems;
    
    // Parse menu items if they're stored as string
    if (typeof menuItems === 'string') {
      try {
        menuItems = JSON.parse(menuItems);
      } catch (error) {
        console.log('❌ Error parsing menu items JSON:', error.message);
        return;
      }
    }
    
    if (!Array.isArray(menuItems) || menuItems.length === 0) {
      console.log('❌ No menu items configured!');
      console.log('🔧 Add menu items through: http://localhost:5173/admin');
      return;
    }
    
    console.log(`\n📋 Found ${menuItems.length} menu items:\n`);
    
    // Group by category
    const categorized = {};
    menuItems.forEach(item => {
      const category = item.category || 'Sin categoría';
      if (!categorized[category]) categorized[category] = [];
      categorized[category].push(item);
    });
    
    // Display menu
    for (const [category, items] of Object.entries(categorized)) {
      console.log(`📁 ${category}:`);
      items.forEach(item => {
        const emoji = getEmoji(item.name);
        console.log(`  ${emoji} ${item.name} - $${item.price}`);
        if (item.description) {
          console.log(`     ${item.description}`);
        }
      });
      console.log('');
    }
    
    console.log('✅ Menu configuration looks good!');
    console.log('🤖 The AI system can now process orders with these products.');
    
  } catch (error) {
    console.error('❌ Database error:', error.message);
    console.log('\n🔧 Make sure:');
    console.log('1. PostgreSQL is running');
    console.log('2. DATABASE_URL is correct in .env');
    console.log('3. Database migrations are up to date: npx prisma migrate dev');
  } finally {
    await prisma.$disconnect();
  }
}

function getEmoji(name) {
  const n = name.toLowerCase();
  if (n.includes('empanada')) return '🥟';
  if (n.includes('pizza')) return '🍕';
  if (n.includes('hamburguesa')) return '🍔';
  if (n.includes('bebida') || n.includes('gaseosa')) return '🥤';
  if (n.includes('ensalada')) return '🥗';
  if (n.includes('sandwich')) return '🥪';
  return '🍽️';
}

checkMenuConfiguration(); 