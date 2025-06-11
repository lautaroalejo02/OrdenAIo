// ConversationContext: Manages active order context per customer
class ConversationContext {
  constructor() {
    this.context = new Map(); // phoneNumber -> { items: [], lastUpdated: Date }
  }

  getActiveOrder(phoneNumber) {
    return this.context.get(phoneNumber) || { items: [] };
  }

  addItem(phoneNumber, item) {
    const order = this.getActiveOrder(phoneNumber);
    order.items.push(item);
    order.lastUpdated = new Date();
    this.context.set(phoneNumber, order);
  }

  removeItem(phoneNumber, itemName) {
    const order = this.getActiveOrder(phoneNumber);
    order.items = order.items.filter(i => i.itemName !== itemName);
    order.lastUpdated = new Date();
    this.context.set(phoneNumber, order);
  }

  finalizeOrder(phoneNumber) {
    this.context.delete(phoneNumber);
  }

  clear(phoneNumber) {
    this.context.delete(phoneNumber);
  }

  getOrderSummary(phoneNumber) {
    const order = this.getActiveOrder(phoneNumber);
    let total = 0;
    order.items.forEach(i => { total += (i.price || 0) * (i.quantity || 1); });
    return {
      items: order.items,
      total,
      itemCount: order.items.reduce((sum, i) => sum + (i.quantity || 1), 0)
    };
  }
}

export default new ConversationContext(); 