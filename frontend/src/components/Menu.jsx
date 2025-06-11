import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Minus, ShoppingCart, X, MapPin } from 'lucide-react';

const Menu = () => {
  const [menuData, setMenuData] = useState(null);
  const [cart, setCart] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deliveryAddress, setDeliveryAddress] = useState('');

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

      // Use relative path - Vite proxy will handle redirecting to backend
      const apiUrl = `/api/menu/data?phone=${customerPhone}`;
      console.log('Making API call to:', apiUrl);
      
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('API response:', data);

      setMenuData(data);
    } catch (err) {
      console.error('Error loading menu:', err);
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
      alert('Agregá productos a tu pedido primero 😊');
      return;
    }

    if (!deliveryAddress.trim()) {
      alert('Por favor, ingresá tu dirección de entrega 📍');
      return;
    }

    // Group items by category for better formatting
    const itemsByCategory = {};
    cartItems.forEach(([productId, quantity]) => {
      const product = menuData.menu.find(p => p.id == productId);
      if (product) {
        const category = product.category || 'Otros';
        if (!itemsByCategory[category]) {
          itemsByCategory[category] = [];
        }
        itemsByCategory[category].push({
          name: product.name,
          quantity,
          price: product.price,
          subtotal: product.price * quantity,
          emoji: getProductEmoji(product.name, product.category)
        });
      }
    });

    // Generate formatted message in Spanish
    let message = `🛒 *MI PEDIDO - ${menuData.restaurant.name}*\n\n`;
    
    let totalPrice = 0;

    // Add items by category
    Object.entries(itemsByCategory).forEach(([category, items]) => {
      message += `📋 *${category.toUpperCase()}*\n`;
      items.forEach(item => {
        message += `${item.emoji} ${item.name} x${item.quantity} - $${item.subtotal.toFixed(2)}\n`;
        totalPrice += item.subtotal;
      });
      message += '\n';
    });

    message += `💰 *TOTAL: $${totalPrice.toFixed(2)}*\n\n`;
    message += `📍 *DIRECCIÓN DE ENTREGA:*\n${deliveryAddress}\n\n`;
    message += `✅ *Para confirmar este pedido, escribí:* CONFIRMAR\n`;
    message += `❌ *Para cancelar, escribí:* CANCELAR\n\n`;
    message += `📞 Cualquier consulta sobre tiempos o zonas, preguntame! 🚀`;

    // Open WhatsApp - clean phone number from @c.us suffix
    const cleanPhone = customerPhone.replace('@c.us', '');
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
    window.open(whatsappUrl, '_blank');
  };

  const getProductEmoji = (name, category) => {
    const nameLC = name.toLowerCase();
    if (nameLC.includes('empanada')) return '🥟';
    if (nameLC.includes('pizza')) return '🍕';
    if (nameLC.includes('hamburguesa') || nameLC.includes('burger')) return '🍔';
    if (nameLC.includes('bebida') || nameLC.includes('gaseosa') || nameLC.includes('drink')) return '🥤';
    if (nameLC.includes('ensalada')) return '🥗';
    if (nameLC.includes('postre')) return '🍰';
    if (nameLC.includes('cafe') || nameLC.includes('café')) return '☕';
    return '🍽️';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin mb-4" />
          <p>Cargando menú...</p>
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
            <p className="text-red-600 font-medium mb-4">Cerrado en este momento</p>
            <p className="text-gray-600">{menuData.restaurant.outOfHoursMessage}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Group products by category
  const categories = menuData.menu.reduce((acc, item) => {
    const category = item.category || 'Otros';
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-400 to-red-600">
      {/* Header */}
      <div className="bg-white shadow-lg sticky top-0 z-40">
        <div className="max-w-6xl mx-auto p-4">
          <div className="text-center">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-800">
              🍕 {menuData.restaurant.name}
            </h1>
            <p className="text-gray-600">Seleccioná tus productos favoritos</p>
            <div className="mt-2 flex justify-center items-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm text-green-600 font-medium">Abierto ahora</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - Responsive Layout */}
      <div className="max-w-6xl mx-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Menu Section - Takes 2 columns on large screens */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-md">
              <div className="p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-6">📋 Nuestro Menú</h2>
                
                {/* Categories Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {Object.entries(categories).map(([category, items]) => (
                    <div key={category} className="space-y-4">
                      <div className="flex items-center space-x-2 border-b border-gray-200 pb-2">
                        <h3 className="text-lg font-semibold text-gray-800">
                          {category === 'Otros' ? '🍽️ Otros' : `${getProductEmoji(items[0].name, category)} ${category}`}
                        </h3>
                        <Badge variant="secondary">
                          {items.length}
                        </Badge>
                      </div>
                      
                      <div className="space-y-3">
                        {items.map((item) => {
                          const quantity = cart[item.id] || 0;
                          const emoji = getProductEmoji(item.name, item.category);
                          return (
                            <Card key={item.id} className="hover:shadow-md transition-shadow">
                              <CardContent className="p-4">
                                <div className="flex items-center justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center space-x-2 mb-1">
                                      <span className="text-lg">{emoji}</span>
                                      <h4 className="font-semibold text-gray-800">{item.name}</h4>
                                    </div>
                                    {item.description && (
                                      <p className="text-sm text-gray-600 mb-2">{item.description}</p>
                                    )}
                                    <p className="text-lg font-bold text-green-600">
                                      ${item.price.toFixed(2)}
                                    </p>
                                  </div>
                                  
                                  <div className="flex items-center space-x-2 ml-4">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => updateQuantity(item.id, -1)}
                                      disabled={quantity === 0}
                                      className="h-8 w-8 p-0"
                                    >
                                      <Minus className="h-4 w-4" />
                                    </Button>
                                    <span className="w-8 text-center font-semibold text-lg">{quantity}</span>
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
              </div>
            </div>
          </div>

          {/* Cart Section - Takes 1 column on large screens, sticky */}
          <div className="lg:col-span-1">
            <div className="sticky top-24">
              <Card className="bg-white shadow-lg">
                <CardContent className="p-6">
                  <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
                    <ShoppingCart className="mr-2 h-5 w-5" />
                    Tu Pedido
                  </h3>
                  
                  {getCartItemCount() === 0 ? (
                    <p className="text-gray-500 text-center py-8">
                      Tu carrito está vacío.<br />
                      ¡Agregá productos del menú!
                    </p>
                  ) : (
                    <>
                      {/* Cart Items */}
                      <div className="space-y-3 mb-4 max-h-60 overflow-y-auto">
                        {Object.entries(cart).map(([productId, quantity]) => {
                          const product = menuData.menu.find(p => p.id == productId);
                          if (!product) return null;
                          
                          const emoji = getProductEmoji(product.name, product.category);
                          return (
                            <div key={productId} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2">
                              <div className="flex-1">
                                <span className="mr-1">{emoji}</span>
                                <span className="font-medium">{product.name}</span>
                                <div className="text-gray-500">
                                  {quantity} x ${product.price.toFixed(2)}
                                </div>
                              </div>
                              <span className="font-semibold">
                                ${(product.price * quantity).toFixed(2)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      
                      {/* Delivery Address */}
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          <MapPin className="inline h-4 w-4 mr-1" />
                          Dirección de entrega *
                        </label>
                        <textarea
                          value={deliveryAddress}
                          onChange={(e) => setDeliveryAddress(e.target.value)}
                          placeholder="Ingresá tu dirección completa..."
                          className="w-full p-3 border border-gray-300 rounded-md resize-none"
                          rows="3"
                          required
                        />
                      </div>
                      
                      {/* Total */}
                      <div className="border-t border-gray-200 pt-4">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-bold text-lg">Total:</span>
                          <span className="font-bold text-xl text-green-600">
                            ${getCartTotal().toFixed(2)}
                          </span>
                        </div>
                        <div className="text-sm text-gray-600 mb-4">
                          {getCartItemCount()} productos
                        </div>
                        
                        <div className="space-y-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCart({})}
                            className="w-full text-red-500 hover:text-red-700 hover:bg-red-50"
                          >
                            Vaciar carrito
                          </Button>
                          
                          <Button
                            onClick={sendToWhatsApp}
                            className="w-full bg-green-500 hover:bg-green-600 text-white"
                            size="lg"
                          >
                            <ShoppingCart className="mr-2 h-4 w-4" />
                            Enviar Pedido por WhatsApp
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Menu; 