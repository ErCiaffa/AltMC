/**
 * AntiAFK Module
 * Keeps the bot active to avoid AFK kicks using various strategies
 */

const bot = require('../core/BotEngine');

class AntiAFK {
  constructor() {
    this.active = false;
    this.strategy = null; // look | walk | jump | combined
    this.interval = null;
    this.tick = 0;
  }

  start(strategy = 'combined') {
    if (this.active) return;
    this.strategy = strategy;
    this.active = true;
    this.tick = 0;

    this.interval = setInterval(() => this._execute(), 4000);
    bot.emit('log', { level: 'info', msg: `Anti-AFK avviato (strategia: ${strategy})` });
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    bot.emit('log', { level: 'info', msg: 'Anti-AFK disattivato' });
  }

  toggle(strategy) {
    this.active ? this.stop() : this.start(strategy);
    return this.active;
  }

  getStatus() {
    return { active: this.active, strategy: this.strategy };
  }

  _execute() {
    if (bot.state !== 'online') return;

    this.tick++;
    switch (this.strategy) {
      case 'look':
        this._look();
        break;
      case 'walk':
        this._walk();
        break;
      case 'jump':
        bot.control('jump', true, 200);
        break;
      case 'combined':
        this._look();
        if (this.tick % 3 === 0) bot.control('jump', true, 200);
        if (this.tick % 5 === 0) this._walk();
        break;
    }
  }

  _look() {
    const pos = bot.getPosition();
    if (!pos) return;
    const yaw = (pos.yaw + 0.15 + Math.PI * 2) % (Math.PI * 2);
    bot.look(yaw, 0);
  }

  _walk() {
    bot.control('forward', true, 600);
    setTimeout(() => bot.control('back', true, 600), 700);
  }
}

module.exports = new AntiAFK();
