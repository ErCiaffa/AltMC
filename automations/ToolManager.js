/**
 * ToolManager — Gestisce strumenti: rileva rottura e re-equipaggia dallo slot scelto
 */
const BaseModule = require('./BaseModule');

class ToolManager extends BaseModule {
  constructor() {
    super('ToolManager');
    this.trackedTool = null;      // nome base strumento (es. 'shovel', 'pickaxe')
    this.trackedSlot = 1;      // slot hotbar preferito (0-8)
    this.autoReequip = true;
    this.useItem = false;
    this.checkInterval = null;
    this.lastHeld = null;
    this.usingItem = false;
  }

  onEnable() {
    this.checkInterval = setInterval(() => this._checkTool(), 1000);
  }

  onDisable() {
    if (this.checkInterval) { clearInterval(this.checkInterval); this.checkInterval = null; }
    this._stopUse();
  }

  onSpawn() {
    if (this.enabled) {
      if (this.checkInterval) clearInterval(this.checkInterval);
      this.checkInterval = setInterval(() => this._checkTool(), 1000);
    }
  }

  // Imposta lo strumento da tracciare (es. 'diamond_shovel', 'iron_pickaxe')
  setTrackedTool(toolName) {
    this.trackedTool = toolName;
    this.log('info', `Strumento tracciato: ${toolName || 'nessuno'}`);
  }

  // Imposta lo slot da preferire (0-8)
  setPreferredSlot(slot) {
    this.trackedSlot = parseInt(slot) || 0;
    this.log('info', `Slot preferito: ${this.trackedSlot}`);
  }

  // Attiva/disattiva utilizzo strumento
  startUsing() {
    if (!this.bot || !this.enabled) return;
    this.usingItem = true;
    try {
      this.bot.activateItem();
      this.log('info', 'Utilizzo strumento avviato');
    } catch {}
  }

  stopUsing() {
    this.usingItem = false;
    this._stopUse();
    this.log('info', 'Utilizzo strumento fermato');
  }

  _stopUse() {
    if (!this.bot) return;
    try { this.bot.deactivateItem(); } catch {}
  }

  _checkTool() {
    if (!this.bot?.entity || !this.autoReequip || !this.trackedTool) return;
    try {
      const held = this.bot.heldItem;
      const heldName = held?.name || '';

      // Se non teniamo lo strumento giusto, cerca nell'inventario
      if (!heldName.includes(this.trackedTool)) {
        const wasHolding = this.lastHeld?.includes(this.trackedTool);
        if (wasHolding) {
          this.log('warn', `Strumento "${this.trackedTool}" non più in mano, cerco sostituto...`);
        }
        this._findAndEquip();
      } else {
        this.lastHeld = heldName;
      }
    } catch {}
  }

  _findAndEquip() {
    if (!this.bot) return;
    try {
      const items = this.bot.inventory.items();
      const match = items.find(i => i.name.includes(this.trackedTool));
      if (!match) {
        this.log('warn', `Nessun "${this.trackedTool}" trovato nell'inventario`);
        return;
      }

      // Equipaggia nello slot preferito o in mano
      if (this.trackedSlot !== null) {
        const hotbarSlot = this.trackedSlot + 36; // Slot hotbar offset
        this.bot.inventory.move(match.slot, hotbarSlot, match.count)
          .then(() => {
            this.bot.setQuickBarSlot(this.trackedSlot);
            this.log('success', `Re-equipaggiato: ${match.name} → slot ${this.trackedSlot}`);
            this.lastHeld = match.name;
          })
          .catch(() => {
            // Fallback: usa equip diretto
            this.bot.equip(match, 'hand')
              .then(() => {
                this.log('success', `Re-equipaggiato (fallback): ${match.name}`);
                this.lastHeld = match.name;
              })
              .catch(e => this.log('error', `Equip fallito: ${e.message}`));
          });
      } else {
        this.bot.equip(match, 'hand')
          .then(() => {
            this.log('success', `Re-equipaggiato: ${match.name}`);
            this.lastHeld = match.name;
          })
          .catch(e => this.log('error', `Equip fallito: ${e.message}`));
      }
    } catch (e) {
      this.log('error', `Errore gestione strumento: ${e.message}`);
    }
  }

  getStatus() {
    const held = this.bot?.heldItem?.name || 'nessuno';
    return {
      ...super.getStatus(),
      trackedTool: this.trackedTool,
      trackedSlot: this.trackedSlot,
      heldItem: held,
      autoReequip: this.autoReequip,
      usingItem: this.usingItem
    };
  }
}

module.exports = ToolManager;