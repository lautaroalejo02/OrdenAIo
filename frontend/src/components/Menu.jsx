import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Minus, ShoppingCart, X } from 'lucide-react';

const Menu = () => {
  const [menuData, setMenuData] = useState(null);
  const [cart, setCart] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Get phone from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const customerPhone = urlParams.get('phone');

  useEffect(() => {
    loadMenuData();
    // eslint-disable-next-line
  }, []);

  const loadMenuData = async () => {
    try {
      if (!customerPhone) {
        setError('Phone number required');
        setLoading(false);
        return;
      }

      const response = await fetch(`/api/menu/data?phone=${customerPhone}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error loading menu');
      }

      setMenuData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateQuantity = (productId, change) => {
    setCart(prev => {
      const newCart = { ...prev };
      const currentQty = newCart[productId] || 0;
      const newQty = Math.max(0, currentQty + change);
      if (newQty === 0) {
        delete newCart[productId];
      } else {
        newCart[productId] = newQty;
      }
      return newCart;
    });
  };

  const getCartTotal = () => {
    return Object.entries(cart).reduce((total, [productId, quantity]) => {
      const product = menuData?.menu.find(p => p.id == productId);
      return total + (product ? product.price * quantity : 0);
    }, 0);
  };

  const getCartItemCount = () => {
    return Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  };

  const sendToWhatsApp = () => {
    const cartItems = Object.entries(cart);
    if (cartItems.length === 0) {
      alert('Add products to your order first 😊');
      return;
    }

    // Generate formatted message
    let message = `🛒 *My Order - ${menuData.restaurant.name}*\n\n`;
    let totalPrice = 0;

    cartItems.forEach(([productId, quantity]) => {
      const product = menuData.menu.find(p => p.id == productId);
      if (product) {
        const subtotal = product.price * quantity;
        totalPrice += subtotal;
        const emoji = getProductEmoji(product.name, product.category);
        message += `${emoji} *${product.name}* - Quantity: ${quantity} - Price: $${subtotal.toLocaleString()}\n`;
      }
    });

    message += `\n💰 *Total: $${totalPrice.toLocaleString()}*\n\n`;
    message += 'Please confirm my order and let me know the delivery time 🚀';

    // Open WhatsApp
    const phoneNumber = menuData.restaurant.phone;
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodedMessage}`;
    window.open(whatsappUrl, '_self');
  };

  const getProductEmoji = (name, category) => {
    const nameLC = name.toLowerCase();
    if (nameLC.includes('empanada')) return '🥟';
    if (nameLC.includes('pizza')) return '🍕';
    if (nameLC.includes('hamburger')) return '🍔';
    if (nameLC.includes('drink') || nameLC.includes('coke')) return '🥤';
    return '🍽️';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin mb-4" />
          <p>Loading menu...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-md">
          <CardContent className="text-center p-6">
            <X className="mx-auto h-12 w-12 text-red-500 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Error</h2>
            <p className="text-gray-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!menuData.restaurant.isOpen) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-md">
          <CardContent className="text-center p-6">
            <div className="text-4xl mb-4">🔒</div>
            <h2 className="text-xl font-semibold mb-2">{menuData.restaurant.name}</h2>
            <p className="text-red-600 font-medium mb-4">Currently Closed</p>
            <p className="text-gray-600">{menuData.restaurant.outOfHoursMessage}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Group products by category
  const categories = menuData.menu.reduce((acc, item) => {
    const category = item.category || 'others';
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-400 to-red-600">
      {/* Header */}
      <div className="bg-white shadow-lg sticky top-0 z-40">
        <div className="max-w-md mx-auto p-4">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-800">
              🍕 {menuData.restaurant.name}
            </h1>
            <p className="text-gray-600">Select your favorite products</p>
            <div className="mt-2 flex justify-center items-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm text-green-600 font-medium">Open now</span>
            </div>
          </div>
        </div>
      </div>

      {/* Menu Content */}
      <div className="max-w-md mx-auto bg-white min-h-screen">
        <div className="p-4 space-y-6">
          {Object.entries(categories).map(([category, items]) => (
            <div key={category}>
              <h2 className="text-xl font-bold text-gray-800 mb-3 flex items-center">
                <span>{category === 'others' ? '🍽️ Products' : `🍕 ${category}`}</span>
                <Badge variant="secondary" className="ml-2">
                  {items.length}
                </Badge>
              </h2>
              <div className="space-y-3">
                {items.map((item) => {
                  const quantity = cart[item.id] || 0;
                  const emoji = getProductEmoji(item.name, item.category);
                  return (
                    <Card key={item.id} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="flex items-center space-x-4">
                          <div className="text-3xl">{emoji}</div>
                          <div className="flex-1">
                            <h3 className="font-semibold text-gray-800">{item.name}</h3>
                            {item.description && (
                              <p className="text-sm text-gray-600">{item.description}</p>
                            )}
                            <p className="text-lg font-bold text-green-600">
                              ${item.price.toLocaleString()}
                            </p>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateQuantity(item.id, -1)}
                              disabled={quantity === 0}
                              className="h-8 w-8 p-0"
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <span className="w-8 text-center font-semibold">{quantity}</span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateQuantity(item.id, 1)}
                              className="h-8 w-8 p-0"
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {/* Bottom spacing for fixed cart */}
        <div className="h-32"></div>
      </div>

      {/* Fixed Cart */}
      {getCartItemCount() > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-50">
          <div className="max-w-md mx-auto p-4">
            <div className="flex justify-between items-center mb-3">
              <div>
                <span className="font-bold text-lg">
                  Total: ${getCartTotal().toLocaleString()}
                </span>
                <div className="text-sm text-gray-600">
                  {getCartItemCount()} products
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCart({})}
                className="text-red-500 hover:text-red-700"
              >
                Clear
              </Button>
            </div>
            <Button
              onClick={sendToWhatsApp}
              className="w-full bg-green-500 hover:bg-green-600 text-white"
              size="lg"
            >
              <ShoppingCart className="mr-2 h-4 w-4" />
              Send Order via WhatsApp
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Menu; 