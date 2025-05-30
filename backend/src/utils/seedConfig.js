import prisma from './database.js';

async function seedRestaurantConfig() {
  const existing = await prisma.restaurantConfig.findFirst();
  if (existing) {
    console.log('RestaurantConfig already exists.');
    process.exit(0);
  }
  await prisma.restaurantConfig.create({
    data: {
      isOpen: true,
      openingHours: { monday: { open: '08:00', close: '22:00' } },
      menuItems: [],
      deliveryZones: {},
      preparationTimes: {},
      maxMessagesPerHour: 10,
      escalationKeywords: ['human', 'agent', 'help'],
      autoResponses: {},
      filterKeywords: ['menu', 'order', 'pizza', 'burger'],
    },
  });
  console.log('RestaurantConfig seeded.');
  process.exit(0);
}

seedRestaurantConfig(); 