/**
 * AntiAFK — Modulo anti-afk con strategie multiple
 */
const BaseModule = require('./BaseModule');

class AntiAFK extends BaseModule {
  constructor() {
    super('AntiAFK');
    this.strategy = 'combined';
    this.interval = null;
    this.tick = 0;
  }

  onEnable() {
    this.tick = 0;
    this.interval = setInterval(() => this._execute(), 4000);
  }

  onDisable() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  setStrategy(s) {
    this.strategy = s;
    if (this.enabled) {
      this.onDisable();
      this.onEnable();
    }
    this.log('info', `Strategia cambiata: ${s}`);
  }

  _execute() {
    if (!this.bot?.entity) return;
    this.tick++;
    switch (this.strategy) {
      case 'look':
        this._look(); break;
      case 'walk':
        this._walk(); break;
      case 'jump':
        this._jump(); break;
      case 'combined':
        this._look();
        if (this.tick % 3 === 0) this._jump();
        if (this.tick % 5 === 0) this._walk();
        break;
    }
  }

  _look() {
    try {
      const yaw = (this.bot.entity.yaw + 0.15 + Math.PI * 2) % (Math.PI * 2);
      this.bot.look(yaw, 0, false);
    } catch {}
  }

  _walk() {
    try {
      this.bot.setControlState('forward', true);
      setTimeout(() => { try { this.bot?.setControlState('forward', false); this.bot?.setControlState('back', true); } catch {} }, 600);
      setTimeout(() => { try { this.bot?.setControlState('back', false); } catch {} }, 1300);
    } catch {}
  }

  _jump() {
    try {
      this.bot.setControlState('jump', true);
      setTimeout(() => { try { this.bot?.setControlState('jump', false); } catch {} }, 200);
    } catch {}
  }

  getStatus() {
    return { ...super.getStatus(), strategy: this.strategy };
  }
}

module.exports = AntiAFK;
