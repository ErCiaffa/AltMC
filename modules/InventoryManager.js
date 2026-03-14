// InventoryManager.js

class InventoryManager {
    constructor() {
        this.inventory = {};
    }

    // Persist inventory data
    loadInventory() {
        // Load inventory from local storage or database
        // This is a placeholder for actual data loading logic.
        this.inventory = JSON.parse(localStorage.getItem('inventory')) || {};
    }

    saveInventory() {
        // Save inventory data to local storage or database
        // This is a placeholder for actual data saving logic.
        localStorage.setItem('inventory', JSON.stringify(this.inventory));
    }

    // Handle item synchronization
    synchronizeItems(items) {
        items.forEach(item => {
            if (this.inventory[item.id]) {
                this.inventory[item.id].quantity += item.quantity;
            } else {
                this.inventory[item.id] = item;
            }
        });
        this.saveInventory();
    }

    // Add an item to the inventory
    addItem(item) {
        if (this.inventory[item.id]) {
            this.inventory[item.id].quantity += item.quantity;
        } else {
            this.inventory[item.id] = item;
        }
        this.saveInventory();
    }

    // Remove an item from the inventory
    removeItem(itemId, quantity) {
        if (this.inventory[itemId]) {
            this.inventory[itemId].quantity -= quantity;
            if (this.inventory[itemId].quantity <= 0) {
                delete this.inventory[itemId];
            }
            this.saveInventory();
        }
    }

    // Get the current inventory state
    getInventory() {
        return this.inventory;
    }
}

// Usage example:
const manager = new InventoryManager();
manager.loadInventory();

// Adding an item
manager.addItem({id: 'item1', name: 'Health Potion', quantity: 10});

// Synchronizing items
manager.synchronizeItems([{id: 'item2', name: 'Mana Potion', quantity: 5}, {id: 'item1', quantity: 3}]);

// Removing an item
manager.removeItem('item1', 5);

console.log(manager.getInventory());