// API utility for backend communication
// All variables, comments, and errors are in English

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function prepareConfigForSave(config) {
  return {
    ...config,
    menuItems: config.menuItems,
    openingHours: typeof config.openingHours === 'object' ? JSON.stringify(config.openingHours) : config.openingHours,
    deliveryZones: typeof config.deliveryZones === 'object' ? JSON.stringify(config.deliveryZones) : config.deliveryZones,
    preparationTimes: typeof config.preparationTimes === 'object' ? JSON.stringify(config.preparationTimes) : config.preparationTimes,
  };
}

function getAuthHeaders() {
  const session = localStorage.getItem('adminSession');
  if (!session) return {};
  try {
    const { token } = JSON.parse(session);
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {}
  return {};
}

export async function fetchConfig() {
  const response = await fetch(`${API_BASE_URL}/api/config`);
  if (!response.ok) throw new Error('Failed to fetch config');
  const data = await response.json();
  // Parse JSON fields
  if (typeof data.menuItems === 'string') data.menuItems = JSON.parse(data.menuItems);
  if (typeof data.openingHours === 'string') data.openingHours = JSON.parse(data.openingHours);
  if (typeof data.deliveryZones === 'string') data.deliveryZones = JSON.parse(data.deliveryZones);
  if (typeof data.preparationTimes === 'string') data.preparationTimes = JSON.parse(data.preparationTimes);
  return data;
}

export async function updateConfig(config) {
  const response = await fetch(`${API_BASE_URL}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(prepareConfigForSave(config)),
  });
  if (!response.ok) throw new Error('Failed to update config');
  return response.json();
}

export async function fetchKeywords() {
  const response = await fetch(`${API_BASE_URL}/api/keywords`);
  if (!response.ok) throw new Error('Failed to fetch keywords');
  return response.json();
}

export async function updateKeywords(keywords) {
  const response = await fetch(`${API_BASE_URL}/api/keywords`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ keywords }),
  });
  if (!response.ok) throw new Error('Failed to update keywords');
  return response.json();
} 