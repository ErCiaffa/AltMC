/**
 * BaseModule — Classe base per tutti i moduli di automazione
 * Ogni modulo estende questa classe e implementa i metodi che vuole
 */
class BaseModule {
  constructor(name) {
    this.name = name;
    this.enabled = false;
    this.bot = null;
    this.ipc = null;
    this.config = {};
  }

  // Chiamato quando il modulo viene inizializzato
  init(bot, ipc, config = {}) {
    this.bot = bot;
    this.ipc = ipc;
    this.config = config;
  }

  // Chiamato quando il bot spawna/entra in gioco
  onSpawn() {}

  // Chiamato su ogni messaggio di chat ricevuto
  onChat(raw) {}

  // Chiamato all'apertura di un menu/inventario/chest
  onWindowOpen(title) {}

  // Chiamato su ogni tick (se implementato)
  onTick() {}

  // Abilita il modulo
  enable() {
    this.enabled = true;
    this.log('info', `Modulo ${this.name} abilitato`);
    this.onEnable?.();
  }

  // Disabilita il modulo
  disable() {
    this.enabled = false;
    this.log('info', `Modulo ${this.name} disabilitato`);
    this.onDisable?.();
  }

  toggle() {
    this.enabled ? this.disable() : this.enable();
    return this.enabled;
  }

  // Invia un messaggio di log alla dashboard
  log(level, msg) {
    this.ipc?.send('log', { level, msg: `[${this.name}] ${msg}` });
  }

  // Invia un comando chat al server
  chat(msg) {
    if (!this.bot) return;
    try { this.bot.chat(msg); } catch {}
  }

  // Stato serializzabile per la dashboard
  getStatus() {
    return { name: this.name, enabled: this.enabled };
  }
}

module.exports = BaseModule;