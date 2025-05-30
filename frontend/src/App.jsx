// Main app component
import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import { fetchConfig, updateConfig, fetchKeywords, updateKeywords } from './api';
import { GoogleOAuthProvider, GoogleLogin, googleLogout } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';
import Menu from './components/Menu.jsx';

// Helper for default barrios
const DEFAULT_BARRIOS = ["Los Perales", "Chijra", "Barrio Centro", "Huaico"];

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const ADMIN_WHITELIST_KEY = 'adminWhitelist';
console.log('Google Client ID:', GOOGLE_CLIENT_ID);
// Default whitelist (can be edited in settings page)
const DEFAULT_WHITELIST = [
  'yourdad@gmail.com',
  'lautoonix02@gmail.com',
  'lautitomasalejo@gmail.com',
  // Add more emails here or via settings page
];

function getWhitelist() {
  const stored = localStorage.getItem(ADMIN_WHITELIST_KEY);
  if (stored) {
    try { return JSON.parse(stored); } catch { return DEFAULT_WHITELIST; }
  }
  return DEFAULT_WHITELIST;
}
function setWhitelist(list) {
  localStorage.setItem(ADMIN_WHITELIST_KEY, JSON.stringify(list));
}

function Sidebar() {
  return (
    <aside className="w-64 h-screen bg-white shadow-md flex flex-col">
      <div className="p-6 font-bold text-xl border-b">Ordenalo Admin</div>
      <nav className="flex-1 p-4 space-y-2">
        <Link to="/config" className="block px-3 py-2 rounded hover:bg-gray-100">Restaurant Config</Link>
        <Link to="/keywords" className="block px-3 py-2 rounded hover:bg-gray-100">Bot Keywords/Triggers</Link>
        <Link to="/whitelist" className="block px-3 py-2 rounded hover:bg-gray-100">Whitelist Settings</Link>
        {/* Add more links as needed */}
      </nav>
    </aside>
  );
}

function Header() {
  return (
    <header className="h-16 flex items-center px-8 bg-gray-50 border-b shadow-sm">
      <h1 className="text-lg font-semibold">Admin Dashboard</h1>
    </header>
  );
}

function MenuEditor({ menu, setMenu }) {
  const [newItem, setNewItem] = useState({ name: '', price: '', description: '', category: '' });

  // Helper to generate a unique id
  function generateId() {
    return Date.now() + Math.floor(Math.random() * 10000);
  }

  // Ensure all items have an id when loaded
  useEffect(() => {
    if (menu.some(item => !item.id)) {
      setMenu(menu.map(item => item.id ? item : { ...item, id: generateId() }));
    }
    // eslint-disable-next-line
  }, []);

  function handleAdd() {
    if (!newItem.name || !newItem.price) return;
    setMenu([...menu, { ...newItem, price: parseFloat(newItem.price), id: generateId() }]);
    setNewItem({ name: '', price: '', description: '', category: '' });
  }

  function handleRemove(idx) {
    setMenu(menu.filter((_, i) => i !== idx));
  }

  function handleChange(idx, field, value) {
    setMenu(menu.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className="border rounded px-2 py-1 flex-1" placeholder="Name" value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })} />
        <input className="border rounded px-2 py-1 w-24" placeholder="Price" type="number" value={newItem.price} onChange={e => setNewItem({ ...newItem, price: e.target.value })} />
        <input className="border rounded px-2 py-1 flex-1" placeholder="Description" value={newItem.description} onChange={e => setNewItem({ ...newItem, description: e.target.value })} />
        <input className="border rounded px-2 py-1 flex-1" placeholder="Category" value={newItem.category} onChange={e => setNewItem({ ...newItem, category: e.target.value })} />
        <button className="bg-green-500 text-white px-3 py-1 rounded" type="button" onClick={handleAdd}>Add</button>
      </div>
      <ul className="divide-y">
        {menu.map((item, idx) => (
          <li key={idx} className="flex items-center gap-2 py-1">
            <input className="border rounded px-2 py-1 flex-1" value={item.name} onChange={e => handleChange(idx, 'name', e.target.value)} />
            <input className="border rounded px-2 py-1 w-24" type="number" value={item.price} onChange={e => handleChange(idx, 'price', e.target.value)} />
            <input className="border rounded px-2 py-1 flex-1" value={item.description} onChange={e => handleChange(idx, 'description', e.target.value)} />
            <input className="border rounded px-2 py-1 flex-1" value={item.category} onChange={e => handleChange(idx, 'category', e.target.value)} />
            <button className="bg-red-500 text-white px-2 py-1 rounded" type="button" onClick={() => handleRemove(idx)}>Remove</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OpeningHoursEditor({ value, onChange }) {
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const labels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const localValue = { ...value };
  function handleTime(day, field, val) {
    localValue[day] = { ...localValue[day], [field]: val };
    onChange({ ...localValue });
  }
  return (
    <div className="space-y-2">
      {days.map((day, i) => (
        <div key={day} className="flex items-center gap-2">
          <span className="w-24">{labels[i]}</span>
          <input type="time" className="border rounded px-2 py-1" value={localValue[day]?.open || ''} onChange={e => handleTime(day, 'open', e.target.value)} />
          <span>-</span>
          <input type="time" className="border rounded px-2 py-1" value={localValue[day]?.close || ''} onChange={e => handleTime(day, 'close', e.target.value)} />
        </div>
      ))}
    </div>
  );
}

function DeliveryZonesEditor({ value, onChange }) {
  // Ensure zones is always an array
  let initialZones = value;
  if (typeof initialZones === 'string') {
    try { initialZones = JSON.parse(initialZones); } catch { initialZones = []; }
  }
  if (!Array.isArray(initialZones)) initialZones = [];
  const [zones, setZones] = useState(initialZones.length ? initialZones : DEFAULT_BARRIOS);
  const [newZone, setNewZone] = useState('');
  function handleToggle(zone) {
    if (zones.includes(zone)) {
      setZones(zones.filter(z => z !== zone));
    } else {
      setZones([...zones, zone]);
    }
  }
  function handleAdd() {
    if (newZone && !zones.includes(newZone)) {
      setZones([...zones, newZone]);
      setNewZone('');
    }
  }
  useEffect(() => { onChange(zones); }, [zones]);
  return (
    <div className="space-y-2">
      {DEFAULT_BARRIOS.map(zone => (
        <label key={zone} className="flex items-center gap-2">
          <input type="checkbox" checked={zones.includes(zone)} onChange={() => handleToggle(zone)} />
          {zone}
        </label>
      ))}
      <div className="flex gap-2 mt-2">
        <input className="border rounded px-2 py-1 flex-1" placeholder="Add new barrio" value={newZone} onChange={e => setNewZone(e.target.value)} />
        <button type="button" className="bg-green-500 text-white px-3 py-1 rounded" onClick={handleAdd}>Add</button>
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        {zones.filter(z => !DEFAULT_BARRIOS.includes(z)).map(zone => (
          <span key={zone} className="bg-gray-200 px-2 py-1 rounded flex items-center gap-1">{zone} <button type="button" onClick={() => handleToggle(zone)} className="text-red-500">&times;</button></span>
        ))}
      </div>
    </div>
  );
}

function PreparationTimesEditor({ value, onChange }) {
  const [prep, setPrep] = useState(value || {});
  function handleChange(field, val) {
    setPrep({ ...prep, [field]: val });
  }
  useEffect(() => { onChange(prep); }, [prep]);
  return (
    <div className="space-y-2">
      {Object.keys(prep).map(key => (
        <div key={key} className="flex gap-2 items-center">
          <span className="w-32">{key}</span>
          <input type="number" className="border rounded px-2 py-1 w-24" value={prep[key]} onChange={e => handleChange(key, e.target.value)} placeholder="Minutes" />
        </div>
      ))}
      <div className="flex gap-2 mt-2">
        <input className="border rounded px-2 py-1 flex-1" placeholder="Add item/category" id="prep-add-key" />
        <button type="button" className="bg-green-500 text-white px-3 py-1 rounded" onClick={() => {
          const key = document.getElementById('prep-add-key').value;
          if (key && !prep[key]) handleChange(key, '');
          document.getElementById('prep-add-key').value = '';
        }}>Add</button>
      </div>
    </div>
  );
}

function BannedNumbersEditor({ value, onChange }) {
  const [numbers, setNumbers] = useState(value || []);
  const [newNumber, setNewNumber] = useState('');
  function handleAdd() {
    if (newNumber && !numbers.includes(newNumber)) {
      setNumbers([...numbers, newNumber]);
      setNewNumber('');
    }
  }
  function handleRemove(num) {
    setNumbers(numbers.filter(n => n !== num));
  }
  useEffect(() => { onChange(numbers); }, [numbers]);
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className="border rounded px-2 py-1 flex-1" placeholder="Add phone number" value={newNumber} onChange={e => setNewNumber(e.target.value)} />
        <button type="button" className="bg-green-500 text-white px-3 py-1 rounded" onClick={handleAdd}>Add</button>
      </div>
      <ul className="flex flex-wrap gap-2 mt-2">
        {numbers.map(num => (
          <li key={num} className="bg-gray-200 px-2 py-1 rounded flex items-center gap-1">{num} <button type="button" onClick={() => handleRemove(num)} className="text-red-500">&times;</button></li>
        ))}
      </ul>
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [error, setError] = useState('');
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded shadow max-w-sm w-full flex flex-col items-center">
        <h2 className="text-2xl font-bold mb-4">Admin Login</h2>
        <GoogleLogin
          onSuccess={credentialResponse => {
            const decoded = jwtDecode(credentialResponse.credential);
            const email = decoded.email;
            const whitelist = getWhitelist();
            if (!whitelist.includes(email)) {
              setError('Your email is not authorized.');
              googleLogout();
              return;
            }
            localStorage.setItem('adminSession', JSON.stringify({ email, token: credentialResponse.credential }));
            setError('');
            onLogin({ email, token: credentialResponse.credential });
          }}
          onError={() => setError('Login failed. Please try again.')}
        />
        {error && <div className="text-red-500 mt-4">{error}</div>}
      </div>
    </div>
  );
}

function useAdminSession() {
  const [session, setSession] = useState(() => {
    const stored = localStorage.getItem('adminSession');
    if (stored) return JSON.parse(stored);
    return null;
  });
  useEffect(() => {
    if (!session) return;
    // Check token expiration (1 hour default)
    const decoded = jwtDecode(session.token);
    if (decoded.exp && Date.now() / 1000 > decoded.exp) {
      localStorage.removeItem('adminSession');
      setSession(null);
    }
  }, [session]);
  return [session, setSession];
}

function WhitelistSettings() {
  const [whitelist, setWhitelistState] = useState(getWhitelist());
  const [newEmail, setNewEmail] = useState('');
  function handleAdd() {
    if (newEmail && !whitelist.includes(newEmail)) {
      const updated = [...whitelist, newEmail];
      setWhitelistState(updated);
      setWhitelist(updated);
      setNewEmail('');
    }
  }
  function handleRemove(email) {
    const updated = whitelist.filter(e => e !== email);
    setWhitelistState(updated);
    setWhitelist(updated);
  }
  return (
    <div className="p-8 max-w-lg">
      <h2 className="text-xl font-bold mb-4">Admin Whitelist</h2>
      <div className="flex gap-2 mb-4">
        <input className="border rounded px-2 py-1 flex-1" placeholder="Add email" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
        <button className="bg-green-500 text-white px-3 py-1 rounded" type="button" onClick={handleAdd}>Add</button>
      </div>
      <ul className="divide-y">
        {whitelist.map(email => (
          <li key={email} className="flex items-center gap-2 py-2">
            <span className="flex-1">{email}</span>
            <button className="bg-red-500 text-white px-2 py-1 rounded" type="button" onClick={() => handleRemove(email)}>Remove</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RestaurantConfigPage() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    fetchConfig().then(setConfig).catch(() => setToast('Failed to load config')).finally(() => setLoading(false));
  }, []);

  function handleChange(field, value) {
    setConfig({ ...config, [field]: value });
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    // Ensure menuItems is always an array
    const safeConfig = { ...config, menuItems: Array.isArray(config.menuItems) ? config.menuItems : [] };
    try {
      await updateConfig(safeConfig);
      setToast('Config saved successfully');
    } catch {
      setToast('Failed to save config');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-8">Loading...</div>;
  if (!config) return <div className="p-8 text-red-500">Failed to load config.</div>;

  return (
    <div className="p-8 max-w-3xl">
      <h2 className="text-2xl font-bold mb-4">Restaurant Config</h2>
      <form className="space-y-6" onSubmit={handleSave}>
        <div>
          <label className="block font-medium mb-1">Restaurant Name</label>
          <input className="border rounded px-3 py-2 w-full" value={config.restaurantName || ''} onChange={e => handleChange('restaurantName', e.target.value)} />
        </div>
        <div>
          <label className="block font-medium mb-1">Menu</label>
          <MenuEditor menu={Array.isArray(config.menuItems) ? config.menuItems : []} setMenu={menu => handleChange('menuItems', menu)} />
        </div>
        <div>
          <label className="block font-medium mb-1">Opening Hours</label>
          <OpeningHoursEditor value={config.openingHours || {}} onChange={val => handleChange('openingHours', val)} />
        </div>
        <div>
          <label className="block font-medium mb-1">Delivery Zones</label>
          <DeliveryZonesEditor value={config.deliveryZones || DEFAULT_BARRIOS} onChange={val => handleChange('deliveryZones', val)} />
        </div>
        <div>
          <label className="block font-medium mb-1">Preparation Times</label>
          <PreparationTimesEditor value={config.preparationTimes || {}} onChange={val => handleChange('preparationTimes', val)} />
        </div>
        <div>
          <label className="block font-medium mb-1">Max Messages Per Hour</label>
          <input
            className="border rounded px-3 py-2 w-full"
            type="number"
            min="0"
            value={config.maxMessagesPerHour ?? 10}
            onChange={e => handleChange('maxMessagesPerHour', Number(e.target.value))}
          />
          <div className="text-sm text-gray-500">Set to 0 for unlimited. Controls how many messages a user can send per hour.</div>
        </div>
        <div>
          <label className="block font-medium mb-1">Order Method</label>
          <select className="border rounded px-3 py-2 w-full" value={config.orderMethod || ''} onChange={e => handleChange('orderMethod', e.target.value)}>
            <option value="">Select...</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="dashboard">Dashboard</option>
          </select>
        </div>
        <div>
          <label className="block font-medium mb-1">Bot Conversation Tone</label>
          <select className="border rounded px-3 py-2 w-full" value={config.botTone || ''} onChange={e => handleChange('botTone', e.target.value)}>
            <option value="">Select...</option>
            <option value="friendly">Friendly</option>
            <option value="formal">Formal</option>
            <option value="playful">Playful</option>
          </select>
        </div>
        <div>
          <label className="block font-medium mb-1">Unrelated Message</label>
          <input className="border rounded px-3 py-2 w-full" value={config.unrelatedMessage || ''} onChange={e => handleChange('unrelatedMessage', e.target.value)} placeholder="Message for unrelated topics" />
        </div>
        <div>
          <label className="block font-medium mb-1">Out-of-Hours Message</label>
          <input className="border rounded px-3 py-2 w-full" value={config.outOfHoursMessage || ''} onChange={e => handleChange('outOfHoursMessage', e.target.value)} placeholder="Message when closed" />
        </div>
        <div>
          <label className="block font-medium mb-1">Banned Numbers</label>
          <BannedNumbersEditor value={config.bannedNumbers || []} onChange={val => handleChange('bannedNumbers', val)} />
        </div>
        <button className="bg-blue-600 text-white px-6 py-2 rounded font-semibold" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Config'}</button>
      </form>
      {toast && (
        <div className="fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-2 rounded shadow" onClick={() => setToast(null)}>{toast}</div>
      )}
    </div>
  );
}

function KeywordsPage() {
  const [keywords, setKeywords] = useState([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    fetchKeywords()
      .then(data => setKeywords(data.keywords || []))
      .catch(() => setToast('Failed to load keywords'))
      .finally(() => setLoading(false));
  }, []);

  function handleAdd() {
    if (!newKeyword.trim()) return;
    setKeywords([...keywords, newKeyword.trim()]);
    setNewKeyword('');
  }

  function handleRemove(idx) {
    setKeywords(keywords.filter((_, i) => i !== idx));
  }

  function handleChange(idx, value) {
    setKeywords(keywords.map((k, i) => (i === idx ? value : k)));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateKeywords(keywords);
      setToast('Keywords saved successfully');
    } catch {
      setToast('Failed to save keywords');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8 max-w-2xl">
      <h2 className="text-2xl font-bold mb-4">Bot Keywords/Triggers</h2>
      <form className="space-y-6" onSubmit={handleSave}>
        <div>
          <label className="block font-medium mb-1">Add Keyword/Trigger</label>
          <div className="flex gap-2">
            <input className="border rounded px-3 py-2 flex-1" value={newKeyword} onChange={e => setNewKeyword(e.target.value)} placeholder="Type a keyword or phrase" />
            <button className="bg-green-500 text-white px-4 py-2 rounded" type="button" onClick={handleAdd}>Add</button>
          </div>
        </div>
        <ul className="divide-y">
          {keywords.map((keyword, idx) => (
            <li key={idx} className="flex items-center gap-2 py-2">
              <input className="border rounded px-3 py-2 flex-1" value={keyword} onChange={e => handleChange(idx, e.target.value)} />
              <button className="bg-red-500 text-white px-3 py-2 rounded" type="button" onClick={() => handleRemove(idx)}>Remove</button>
            </li>
          ))}
        </ul>
        <button className="bg-blue-600 text-white px-6 py-2 rounded font-semibold" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Keywords'}</button>
      </form>
      {toast && (
        <div className="fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-2 rounded shadow" onClick={() => setToast(null)}>{toast}</div>
      )}
    </div>
  );
}

function App() {
  const [session, setSession] = useAdminSession();
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <Router>
        <Routes>
          {/* Public menu route for customers */}
          <Route path="/menu" element={<Menu />} />
          {/* Admin routes (require session) */}
          {session ? (
            <Route
              path="*"
              element={
                <div className="min-h-screen flex bg-gray-100">
                  <Sidebar />
                  <div className="flex-1 flex flex-col">
                    <Header />
                    <main className="flex-1">
                      <Routes>
                        <Route path="/config" element={<RestaurantConfigPage />} />
                        <Route path="/keywords" element={<KeywordsPage />} />
                        <Route path="/whitelist" element={<WhitelistSettings />} />
                        <Route path="*" element={<Navigate to="/config" replace />} />
                      </Routes>
                    </main>
                  </div>
                </div>
              }
            />
          ) : (
            <Route path="*" element={<LoginPage onLogin={setSession} />} />
          )}
        </Routes>
      </Router>
    </GoogleOAuthProvider>
  );
}

export default App; 