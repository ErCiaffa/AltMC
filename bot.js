// Fixed Inventory System Implementation

class Inventory {
    constructor() {
        this.items = new Map();
    }

    addItem(item, quantity) {
        if (this.items.has(item)) {
            this.items.set(item, this.items.get(item) + quantity);
        } else {
            this.items.set(item, quantity);
        }
    }

    removeItem(item, quantity) {
        if (this.items.has(item)) {
            const currentQuantity = this.items.get(item);
            if (currentQuantity > quantity) {
                this.items.set(item, currentQuantity - quantity);
            } else {
                this.items.delete(item);
            }
        }
    }

    getItemQuantity(item) {
        return this.items.get(item) || 0;
    }

    listItems() {
        return Array.from(this.items.entries()).map(([item, quantity]) => `${item}: ${quantity}`);
    }
}

// Example usage
const inventory = new Inventory();
inventory.addItem('apple', 10);
inventory.addItem('banana', 5);
inventory.removeItem('apple', 3);
console.log(inventory.listItems()); // [ 'apple: 7', 'banana: 5' ]