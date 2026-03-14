/**
 * ModuleManager — Gestisce tutti i moduli di automazione
 * Carica automaticamente tutti i file in automations/ (tranne BaseModule)
 */
const fs = require('fs');
const path = require('path');

class ModuleManager {
  constructor() {
    this.modules = new Map(); // name → istanza modulo
  }

  // Carica tutti i moduli dalla cartella automations/
  loadAll(bot, ipc, account) {
    const dir = path.join(__dirname, '../automations');
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'BaseModule.js');

    files.forEach(file => {
      try {
        const ModuleClass = require(path.join(dir, file));
        const instance = new ModuleClass();

        // Passa la config dell'account al modulo
        const config = {
          loginPassword: account.loginPassword,
          registerPassword: account.registerPassword || account.loginPassword,
          ...account.moduleConfig?.[instance.name]
        };

        instance.init(bot, ipc, config);
        this.modules.set(instance.name, instance);
        console.log(`[MODULES] Caricato: ${instance.name}`);
      } catch (e) {
        console.error(`[MODULES] Errore caricamento ${file}: ${e.message}`);
      }
    });
  }

  // Notifica spawn a tutti i moduli abilitati
  onSpawn() {
    this.modules.forEach(m => { if (m.enabled) { try { m.onSpawn(); } catch {} } });
  }

  // Notifica messaggio chat a tutti i moduli
  onChat(raw) {
    this.modules.forEach(m => { if (m.enabled) { try { m.onChat(raw); } catch {} } });
  }

  // Notifica apertura finestra a tutti i moduli
  onWindowOpen(title) {
    this.modules.forEach(m => { if (m.enabled) { try { m.onWindowOpen?.(title); } catch {} } });
  }

  // Aggiorna il riferimento bot (dopo riconnessione)
  updateBot(bot) {
    this.modules.forEach(m => { m.bot = bot; });
  }

  // Toggle modulo per nome
  toggle(name, value) {
    const m = this.modules.get(name);
    if (!m) return null;
    if (value !== undefined) {
      value ? m.enable() : m.disable();
    } else {
      m.toggle();
    }
    return m.getStatus();
  }

  // Azione su modulo (es. cambia strategia antiafk)
  action(name, action, params) {
    const m = this.modules.get(name);
    if (!m) return null;
    if (typeof m[action] === 'function') {
      return m[action](params);
    }
    return null;
  }

  // Stato di tutti i moduli
  getAllStatus() {
    const result = {};
    this.modules.forEach((m, name) => { result[name] = m.getStatus(); });
    return result;
  }

  // Reset (prima di riconnessione)
  reset() {
    this.modules.forEach(m => {
      try { if (m.enabled) m.onDisable?.(); } catch {}
    });
    this.modules.clear();
  }
}

module.exports = new ModuleManager();
