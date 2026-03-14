/**
 * BotEngine v4 - Core bot lifecycle manager
 * Fix principale: forceSpawn da pacchetti di gioco raw
 * quando mineflayer non emette 'spawn' a causa dei Parse error
 */

const mineflayer = require('mineflayer');
const { EventEmitter } = require('events');
const RawPacketInventory = require('../modules/RawPacketInventory');

// ── Soppressione globale errori protodef ─────────────────────────────
const PARSE_ERRORS = ['PartialReadError','Parse error','array size is abnormally','SizeOf error','Read error for'];
const isParseError = (msg) => PARSE_ERRORS.some(e => (msg||'').includes(e));

process.on('uncaughtException', (err) => {
  if (isParseError(err?.message)) return;
  console.error('[UNCAUGHT]', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  if (isParseError(reason?.message)) return;
  console.error('[REJECTION]', reason?.message || reason);
});

// ── Item Registry ────────────────────────────────────────────────────
class ItemRegistry {
  constructor() { this.map = new Map(); }
  loadFromMinecraftData(version) {
    for (const v of [version, '1.21.4', '1.21.1', '1.21'].filter(Boolean)) {
      try {
        const mcData = require('minecraft-data')(v);
        if (!mcData?.itemsArray?.length) continue;
        const maxId = Math.max(...mcData.itemsArray.map(i => i.id));
        for (let i = 0; i <= maxId; i++) this.map.set(i, 'air');
        mcData.itemsArray.forEach(item => this.map.set(item.id, item.name));
        return v;
      } catch {}
    }
    return null;
  }
  getName(id) { return this.map.get(id) || `item_${id}`; }
  get size() { return this.map.size; }
}

// ════════════════════════════════════════════════════════════════════
class BotEngine extends EventEmitter {
  constructor() {
    super();
    this.bot = null;
    this.state = 'offline';
    this.session = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.maxReconnects = 10;
    this._spawnDone = false;
    this.stats = { connectedAt: null, messagesReceived: 0, messagesSent: 0, reconnects: 0, kicks: 0 };
    this.itemRegistry = new ItemRegistry();
    this.rawInv = new RawPacketInventory(this.itemRegistry);
    this.useRawInventory = false;
    this.rawInv.on('update', (inv) => this.emit('window', inv));
    this.rawInv.on('windowOpen', (title) => this.emit('log', { level: 'info', msg: `Finestra: ${title}` }));
  }

  // ─── PUBLIC API ────────────────────────────────────────────────

  connect(account, server) {
    if (this.state === 'online' || this.state === 'connecting') {
      this.emit('log', { level: 'warn', msg: 'Bot già connesso.' });
      return;
    }
    this.session = { account, server };
    this.reconnectAttempts = 0;
    this._spawnDone = false;
    this._spawn();
  }

  disconnect() {
    this._clearReconnect();
    if (this.bot) {
      this.bot.removeAllListeners();
      try { this.bot.quit('Disconnesso'); } catch {}
      this.bot = null;
    }
    this.rawInv.detach();
    this.rawInv.clear();
    this._spawnDone = false;
    this._setState('offline');
    this.emit('log', { level: 'info', msg: 'Disconnesso.' });
  }

  sendChat(msg) {
    if (!this._isOnline()) return false;
    try { this.bot.chat(msg); this.stats.messagesSent++; return true; } catch { return false; }
  }

  control(action, value = true, duration = 0) {
    if (!this._isOnline()) return;
    try {
      this.bot.setControlState(action, value);
      if (duration > 0) setTimeout(() => { try { this.bot?.setControlState(action, false); } catch {} }, duration);
    } catch {}
  }

  look(yaw, pitch) {
    if (!this._isOnline()) return;
    try { this.bot.look(yaw, pitch, false); } catch {}
  }

  clickSlot(slot, mouseButton = 0, mode = 0) {
    if (!this._isOnline()) return Promise.reject('offline');
    return this.bot.clickWindow(slot, mouseButton, mode).catch(() => {});
  }

  closeWindow() {
    if (!this._isOnline()) return;
    try {
      if (this.bot.currentWindow) this.bot.closeWindow(this.bot.currentWindow);
      else this.bot._client.write('close_window', { windowId: this.rawInv.windowId || 0 });
    } catch {}
  }

  getPosition() {
    if (!this._isOnline() || !this.bot.entity) return null;
    try {
      return {
        x: +this.bot.entity.position.x.toFixed(2),
        y: +this.bot.entity.position.y.toFixed(2),
        z: +this.bot.entity.position.z.toFixed(2),
        yaw: +this.bot.entity.yaw.toFixed(3),
        pitch: +this.bot.entity.pitch.toFixed(3)
      };
    } catch { return null; }
  }

  getHealth() {
    if (!this._isOnline()) return null;
    try { return { health: this.bot.health, food: this.bot.food, saturation: this.bot.foodSaturation }; }
    catch { return null; }
  }

  getInventory() {
    if (!this._isOnline()) return { title: 'Inventario', slots: [] };
    if (this.useRawInventory) return this.rawInv.getInventory();
    try {
      const win = this.bot.currentWindow || this.bot.inventory;
      if (!win) return { title: 'Inventario', slots: [] };
      return {
        title: this._windowTitle(win),
        slots: win.slots.map((item, i) => item ? {
          slot: i, name: item.name, displayName: item.displayName, count: item.count, nbt: !!item.nbt
        } : null).filter(Boolean)
      };
    } catch { return { title: 'Inventario', slots: [] }; }
  }

  getUptimeSeconds() {
    if (!this.stats.connectedAt) return 0;
    return Math.floor((Date.now() - this.stats.connectedAt) / 1000);
  }

  getStats() {
    return { ...this.stats, uptime: this.getUptimeSeconds(), state: this.state, reconnectAttempts: this.reconnectAttempts };
  }

  // ─── INTERNAL ──────────────────────────────────────────────────

  _spawn() {
    const { account, server } = this.session;
    this._setState('connecting');
    this._spawnDone = false;
    this.useRawInventory = this._isNewProtocol(server.version || '');
    this.emit('log', { level: 'info', msg: `Connessione a ${server.host}:${server.port} come ${account.username}...` });

    if (this.useRawInventory) {
      const v = this.itemRegistry.loadFromMinecraftData(server.version);
      this.emit('log', { level: 'info', msg: `Registry: ${this.itemRegistry.size} item (${v||'fallback'})` });
    }

    try {
      this.bot = mineflayer.createBot({
        host: server.host,
        port: server.port || 25565,
        username: account.username,
        auth: account.auth || 'offline',
        version: server.version || false,
        brand: server.brand || 'vanilla',
        hideErrors: true,
        respawn: true
      });
    } catch (err) {
      this.emit('log', { level: 'error', msg: `Errore createBot: ${err.message}` });
      this._scheduleReconnect();
      return;
    }

    this._patchClient(this.bot._client);
    this._attachListeners();
  }

  _patchClient(client) {
    if (!client) return;
    const orig = client.emit.bind(client);
    client.emit = (event, ...args) => {
      if (event === 'error' && isParseError(args[0]?.message)) return false;
      return orig(event, ...args);
    };
    if (client._client?.emit) {
      const origInner = client._client.emit.bind(client._client);
      client._client.emit = (event, ...args) => {
        if (event === 'error' && isParseError(args[0]?.message)) return false;
        return origInner(event, ...args);
      };
    }
  }

  // Chiamato da più sorgenti — esegue lo spawn solo una volta
  _doSpawn() {
    if (this._spawnDone) return;
    this._spawnDone = true;
    const { account, server } = this.session;
    const b = this.bot;

    console.log('[BOT] _doSpawn eseguito!');
    this._setState('online');
    this.reconnectAttempts = 0;
    this.stats.connectedAt = Date.now();
    this.emit('log', { level: 'success', msg: `In gioco! → ${b?.username || account.username} su ${server.host}` });
    this.emit('spawn');

    // Auto-login
    if (account.loginPassword) {
      setTimeout(() => {
        try { b?.chat(`/login ${account.loginPassword}`); this.emit('log', { level: 'info', msg: 'Auto-login inviato' }); } catch {}
      }, 1200);
    }
    // Auto-register
    if (account.registerPassword) {
      setTimeout(() => {
        try { b?.chat(`/register ${account.registerPassword} ${account.registerPassword}`); this.emit('log', { level: 'info', msg: 'Auto-register inviato' }); } catch {}
      }, 800);
    }

    // Attacca inventario raw
    if (this.useRawInventory) {
      setTimeout(() => { if (b?._client) this.rawInv.attach(b._client); }, 1000);
    }
  }

  _attachListeners() {
    const b = this.bot;
    const { account } = this.session;

    // ── LOG STATO CLIENT ─────────────────────────────────────────
    b._client.on('state', (newState) => {
      console.log(`[BOT] client state → ${newState}`);
      // Quando il client entra in play, siamo in gioco
      if (newState === 'play') {
        console.log('[BOT] stato play rilevato → forceSpawn in 1s');
        setTimeout(() => this._doSpawn(), 1000);
      }
    });

    // ── SPAWN NATIVO mineflayer ───────────────────────────────────
    b.once('spawn', () => {
      console.log('[BOT] spawn nativo mineflayer ricevuto');
      this._doSpawn();
    });

    // ── PACCHETTI IN-GAME come trigger alternativo ────────────────
    // Se lo state 'play' non triggera o spawn non arriva, questi lo fanno
    const rawTriggers = ['position', 'update_health', 'respawn'];
    rawTriggers.forEach(pktName => {
      b._client.once(pktName, () => {
        console.log(`[BOT] pacchetto ${pktName} ricevuto → forceSpawn`);
        setTimeout(() => this._doSpawn(), 500);
      });
    });

    // ── HEALTH / MOVE / CHAT ─────────────────────────────────────
    b.on('health', () => {
      try { this.emit('health', this.getHealth()); } catch {}
    });

    b.on('move', () => {
      try { const pos = this.getPosition(); if (pos) this.emit('move', pos); } catch {}
    });

    // Helper auto-login/register
    const handleAutoAuth = (text) => {
      const lower = (text||'').toLowerCase();
      if (account.registerPassword && (lower.includes('register') || lower.includes('registra'))) {
        setTimeout(() => { try { b.chat(`/register ${account.registerPassword} ${account.registerPassword}`); this.emit('log', { level: 'info', msg: 'Auto-register inviato' }); } catch {} }, 600);
      } else if (account.loginPassword && (lower.includes('login') || lower.includes('password') || lower.includes('accedi') || lower.includes('connecte'))) {
        setTimeout(() => { try { b.chat(`/login ${account.loginPassword}`); this.emit('log', { level: 'info', msg: 'Auto-login inviato' }); } catch {} }, 600);
      }
    };

    // Formato classico mineflayer
    b.on('message', (jsonMsg) => {
      try {
        this.stats.messagesReceived++;
        const raw = jsonMsg.toString();
        const ansi = jsonMsg.toAnsi ? jsonMsg.toAnsi() : raw;
        handleAutoAuth(raw);
        this.emit('chat', { raw, ansi, timestamp: Date.now() });
      } catch {}
    });

    // 1.21.5+: playerChat e systemChat separati
    b.on('playerChat', (username, message) => {
      try {
        this.stats.messagesReceived++;
        const raw = `<${username}> ${message}`;
        this.emit('chat', { raw, ansi: raw, timestamp: Date.now() });
      } catch {}
    });

    b.on('systemChat', (message) => {
      try {
        this.stats.messagesReceived++;
        const raw = typeof message === 'string' ? message : (message?.toString() || '');
        handleAutoAuth(raw);
        this.emit('chat', { raw, ansi: raw, timestamp: Date.now() });
      } catch {}
    });

    // Pacchetti raw 1.21.8
    b._client.on('player_chat', (data) => {
      try {
        const msg = data?.unsignedContent || data?.message || data?.plainMessage || '';
        const sender = data?.displayName || data?.senderName || '';
        if (!msg) return;
        const raw = sender ? `<${sender}> ${msg}` : String(msg);
        this.stats.messagesReceived++;
        this.emit('chat', { raw, ansi: raw, timestamp: Date.now() });
      } catch {}
    });

    b._client.on('system_chat', (data) => {
      try {
        const content = data?.content || data?.message || '';
        if (!content) return;
        let raw;
        try { raw = JSON.parse(content)?.text || content; } catch { raw = String(content); }
        this.stats.messagesReceived++;
        handleAutoAuth(raw);
        this.emit('chat', { raw, ansi: raw, timestamp: Date.now() });
      } catch {}
    });

    // ── INVENTORY (versioni vecchie) ──────────────────────────────
    if (!this.useRawInventory) {
      b.on('windowOpen', () => { try { this.emit('window', this.getInventory()); } catch {} });
      b.on('updateSlot', () => { setTimeout(() => { try { this.emit('window', this.getInventory()); } catch {} }, 100); });
    }

    // ── SECURITY ─────────────────────────────────────────────────
    b._client.on('packet', (data, meta) => {
      try {
        if (meta.name === 'custom_payload') {
          const ch = (data.channel || '').toLowerCase();
          const suspicious = ['anticheat','nocheatplus','aac','spartan','matrix','grim','vulcan'];
          this.emit('packet', {
            channel: data.channel,
            suspicious: suspicious.some(s => ch.includes(s)),
            preview: data.data?.toString('hex')?.substring(0, 32) || ''
          });
        }
      } catch {}
    });

    // ── KICK ─────────────────────────────────────────────────────
    b.on('kicked', (reason) => {
      this.stats.kicks++;
      let msg;
      try { msg = this._extractText(JSON.parse(reason)); } catch { msg = String(reason).substring(0, 200); }
      console.log(`[BOT] KICK: ${msg}`);
      this.emit('log', { level: 'danger', msg: `KICK: ${msg}` });
      this._handleDisconnect();
    });

    // ── ERROR ────────────────────────────────────────────────────
    b.on('error', (err) => {
      if (!err) return;
      const msg = err.message || '';
      if (isParseError(msg)) return;
      console.log(`[BOT] error: ${msg}`);
      if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') {
        this.emit('log', { level: 'warn', msg: `Connessione persa (${err.code})` });
      } else {
        this.emit('log', { level: 'error', msg: `Errore: ${msg}` });
      }
      this._handleDisconnect();
    });

    // ── END ──────────────────────────────────────────────────────
    b.on('end', (reason) => {
      console.log(`[BOT] end: ${reason||'no reason'} | state=${this.state}`);
      if (this.state === 'online' || this.state === 'connecting') {
        this.emit('log', { level: 'warn', msg: `Disconnesso${reason ? ': '+reason : ''}` });
        this._handleDisconnect();
      }
    });
  }

  _handleDisconnect() {
    this._spawnDone = false;
    this.rawInv.detach();
    this.rawInv.clear();
    if (this.bot) { this.bot.removeAllListeners(); this.bot = null; }
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnects) {
      this.emit('log', { level: 'danger', msg: `Max riconnessioni (${this.maxReconnects}) raggiunto` });
      this._setState('offline');
      return;
    }
    this.reconnectAttempts++;
    this.stats.reconnects++;
    const delay = Math.min(5000 * this.reconnectAttempts, 60000);
    this._setState('reconnecting');
    this.emit('log', { level: 'warn', msg: `Riconnessione ${this.reconnectAttempts}/${this.maxReconnects} in ${delay/1000}s...` });
    this.reconnectTimer = setTimeout(() => this._spawn(), delay);
  }

  _clearReconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  _setState(state) {
    console.log(`[BOT] stato: ${this.state} → ${state}`);
    this.state = state;
    this.emit('state', state);
  }

  _isOnline() { return this.state === 'online' && this.bot !== null; }

  _isNewProtocol(version) {
    if (!version || version === false) return true;
    const m = String(version).match(/^1\.(\d+)\.?(\d*)$/);
    if (!m) return false;
    return parseInt(m[1]) > 21 || (parseInt(m[1]) === 21 && parseInt(m[2]||'0') >= 5);
  }

  _windowTitle(win) {
    if (!win?.title) return 'Inventario';
    try { const t = typeof win.title==='string'?JSON.parse(win.title):win.title; return t.text||t.translate||'Inventario'; }
    catch { return String(win.title); }
  }

  _extractText(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    let t = obj.text || '';
    if (obj.extra) t += obj.extra.map(e => this._extractText(e)).join('');
    return t || JSON.stringify(obj).substring(0, 100);
  }
}

module.exports = new BotEngine();