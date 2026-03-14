/**
 * bot.js v2 — Processo dedicato al bot Minecraft
 * Fix: chat parsing corretto per 1.21.8
 * New: sistema moduli automation
 */

const mineflayer = require('mineflayer');
const net = require('net');
const RawPacketInventory = require('./modules/RawPacketInventory');
const ModuleManager = require('./modules/ModuleManager');

// ── Parse error suppression ──────────────────────────────────────────
const PARSE_ERR = ['PartialReadError','Parse error','array size is abnormally','SizeOf error','Read error for'];
const isParseError = (msg) => PARSE_ERR.some(e => (msg||'').includes(e));
process.on('uncaughtException', (err) => { if (isParseError(err?.message)) return; console.error('[BOT UNCAUGHT]', err.message); });
process.on('unhandledRejection', (r) => { if (isParseError(r?.message)) return; console.error('[BOT REJECTION]', r?.message||r); });

// ── Converte qualsiasi valore in stringa leggibile ───────────────────
function toReadableString(val) {
  if (!val) return '';
  if (typeof val === 'string') {
    if (val.includes('[object Object]')) return '';
    try { 
      const parsed = JSON.parse(val); 
      if (typeof parsed === 'object') return toReadableString(parsed);
    } catch {}
    return val;
  }
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return val.map(v => toReadableString(v)).join('');
  
  if (typeof val === 'object') {
    // Oggetto ChatMessage di mineflayer
    if (typeof val.toString === 'function' && val.toString !== Object.prototype.toString) {
      const s = val.toString();
      if (s && !s.includes('[object Object]') && s !== '{}') return s;
    }
    
    let t = '';
    if (val.text !== undefined) t += val.text;
    if (val.translate) t += val.translate;
    if (val.with) t += Array.isArray(val.with) ? val.with.map(v => toReadableString(v)).join('') : toReadableString(val.with);
    if (val.extra) t += Array.isArray(val.extra) ? val.extra.map(v => toReadableString(v)).join('') : toReadableString(val.extra);
    
    if (t && !t.includes('[object Object]')) return t;
  }
  return '';
}

// ── Item Registry ────────────────────────────────────────────────────
class ItemRegistry {
  constructor() { this.map = new Map(); }
  load(version) {
    for (const v of [version, '1.21.4', '1.21.1'].filter(Boolean)) {
      try {
        const d = require('minecraft-data')(v);
        if (!d?.itemsArray?.length) continue;
        const max = Math.max(...d.itemsArray.map(i => i.id));
        for (let i = 0; i <= max; i++) this.map.set(i, 'air');
        d.itemsArray.forEach(item => this.map.set(item.id, item.name));
        return v;
      } catch {}
    }
    return null;
  }
  getName(id) { return this.map.get(id) || `item_${id}`; }
  get size() { return this.map.size; }
}

// ── IPC Client ───────────────────────────────────────────────────────
class IPC {
  constructor() { this.socket = null; this.connected = false; this.queue = []; }

  connect() {
    this.socket = net.createConnection({ port: 3001, host: '127.0.0.1' });
    this.socket.on('connect', () => {
      this.connected = true;
      console.log('[IPC] Connesso a server.js');
      this.queue.forEach(m => this._write(m));
      this.queue = [];
    });
    this.socket.on('data', (buf) => {
      buf.toString().split('\n').filter(Boolean).forEach(line => {
        try { ipcRouter(JSON.parse(line)); } catch {}
      });
    });
    this.socket.on('close', () => {
      this.connected = false;
      setTimeout(() => this.connect(), 2000);
    });
    this.socket.on('error', () => { this.connected = false; });
  }

  send(type, data) {
    const msg = JSON.stringify({ type, data }) + '\n';
    if (this.connected) this._write(msg);
    else { this.queue.push(msg); if (this.queue.length > 100) this.queue.shift(); }
  }

  _write(msg) { try { this.socket.write(msg); } catch { this.connected = false; } }
}

const ipc = new IPC();

// ── State ────────────────────────────────────────────────────────────
const registry = new ItemRegistry();
const rawInv = new RawPacketInventory(registry);
let bot = null;
let state = 'offline';
let session = null;
let spawnDone = false;
let reconnTimer = null;
let reconnAttempts = 0;
let useRawInv = false;
let stats = { connectedAt: null, messagesReceived: 0, messagesSent: 0, reconnects: 0, kicks: 0 };

let rawInvTimer = null;
rawInv.on('update', (inv) => {
  if (rawInvTimer) clearTimeout(rawInvTimer);
  rawInvTimer = setTimeout(() => ipc.send('window', inv), 250); // Debounce per evitare lag/freeze
});
rawInv.on('windowOpen', (t) => { ipc.send('log', { level: 'info', msg: `Finestra: ${t}` }); ModuleManager.onWindowOpen(t); });

// IPC per i moduli
const moduleIpc = { send: (type, data) => ipc.send(type, data) };

function setState(s) {
  console.log(`[BOT] ${state} → ${s}`);
  state = s;
  ipc.send('state', { state: s });
  ipc.send('stats', getStats());
}

function getStats() {
  return { ...stats, state, uptime: stats.connectedAt ? Math.floor((Date.now()-stats.connectedAt)/1000) : 0, reconnectAttempts: reconnAttempts };
}

function isNewProtocol(v) {
  if (!v) return true;
  const m = String(v).match(/^1\.(\d+)\.?(\d*)$/);
  if (!m) return false;
  return parseInt(m[1]) > 21 || (parseInt(m[1]) === 21 && parseInt(m[2]||'0') >= 5);
}

// ── Spawn ────────────────────────────────────────────────────────────
function doSpawn() {
  if (spawnDone) return;
  spawnDone = true;
  const { account, server } = session;
  console.log('[BOT] doSpawn!');
  setState('online');
  reconnAttempts = 0;
  stats.connectedAt = Date.now();
  ipc.send('log', { level: 'success', msg: `In gioco! → ${bot?.username||account.username} su ${server.host}` });
  ipc.send('spawn', {});

  // Notifica moduli
  ModuleManager.updateBot(bot);
  ModuleManager.onSpawn();
  ipc.send('modules', ModuleManager.getAllStatus());

  // Inventario raw
  if (useRawInv && bot?._client) {
    setTimeout(() => { rawInv.attach(bot._client); }, 1000);
  }
}

// ── Crea bot ─────────────────────────────────────────────────────────
function spawnBot() {
  if (!session) return;
  const { account, server } = session;
  setState('connecting');
  spawnDone = false;
  useRawInv = isNewProtocol(server.version);

  if (useRawInv) {
    const v = registry.load(server.version);
    ipc.send('log', { level: 'info', msg: `Registry: ${registry.size} item (${v||'fallback'})` });
  }

  ipc.send('log', { level: 'info', msg: `Connessione a ${server.host}:${server.port} come ${account.username}...` });

  try {
    bot = mineflayer.createBot({
      host: server.host, port: server.port || 25565,
      username: account.username, auth: account.auth || 'offline',
      version: server.version || false, brand: server.brand || 'vanilla',
      hideErrors: true, respawn: true
    });
  } catch (err) {
    ipc.send('log', { level: 'error', msg: `createBot errore: ${err.message}` });
    scheduleReconnect();
    return;
  }

  // Carica moduli
  ModuleManager.reset();
  ModuleManager.loadAll(bot, moduleIpc, account);
  ipc.send('modules', ModuleManager.getAllStatus());

  // Patch parse errors
  const patch = (c) => {
    if (!c) return;
    const o = c.emit.bind(c);
    c.emit = (ev, ...a) => { if (ev==='error' && isParseError(a[0]?.message)) return false; return o(ev,...a); };
  };
  patch(bot._client);
  if (bot._client?._client) patch(bot._client._client);

  // State
  bot._client.on('state', (s) => {
    console.log(`[BOT] client state → ${s}`);
    if (s === 'play') setTimeout(() => doSpawn(), 1000);
  });

  bot.once('spawn', () => { console.log('[BOT] spawn nativo'); doSpawn(); });
  ['position','update_health','respawn'].forEach(p => {
    bot._client.once(p, () => { console.log(`[BOT] trigger ${p}`); setTimeout(() => doSpawn(), 500); });
  });

  // Health
  bot.on('health', () => {
    try { ipc.send('health', { health: bot.health, food: bot.food, saturation: bot.foodSaturation }); } catch {}
  });

  // Move (throttled: max 1 al secondo)
  let lastMove = 0;
  bot.on('move', () => {
    const now = Date.now();
    if (now - lastMove < 1000) return;
    lastMove = now;
    try {
      if (!bot.entity) return;
      ipc.send('pos', {
        x: +bot.entity.position.x.toFixed(2), y: +bot.entity.position.y.toFixed(2), z: +bot.entity.position.z.toFixed(2),
        yaw: +bot.entity.yaw.toFixed(3), pitch: +bot.entity.pitch.toFixed(3)
      });
    } catch {}
  });

  // ── CHAT — fix completo per 1.21.8 ───────────────────────────────
  const seenMsgs = new Set(); // deduplicazione

  const emitChat = (raw, ansiStr) => {
    if (!raw || typeof raw !== 'string' || raw.includes('[object Object]') || raw === '{}') return;
    
    // Deduplicazione migliorata (ignora colori per il check)
    const cleanStr = raw.replace(/§[0-9a-fk-or]/ig, '').trim().substring(0, 80);
    if (!cleanStr) return;
    if (seenMsgs.has(cleanStr)) return;
    seenMsgs.add(cleanStr);
    setTimeout(() => seenMsgs.delete(cleanStr), 500); // 500ms debounce

    stats.messagesReceived++;
    ipc.send('chat', { raw, ansi: ansiStr || raw, timestamp: Date.now() });
    ModuleManager.onChat(raw);
  };

  // Formato classico mineflayer — funziona su quasi tutte le versioni
  bot.on('message', (jsonMsg) => {
    try {
      let raw = '';
      let ansi = '';
      // jsonMsg è un oggetto ChatMessage di mineflayer
      if (jsonMsg && typeof jsonMsg.toString === 'function') {
        raw = jsonMsg.toString();
      }
      if (jsonMsg && typeof jsonMsg.toAnsi === 'function') {
        ansi = jsonMsg.toAnsi();
      }
      if (!raw || raw === '[object Object]') {
        // Fallback: toMotd o JSON
        raw = jsonMsg?.toMotd?.() || toReadableString(jsonMsg);
      }
      if (raw && !raw.includes('[object Object]')) emitChat(raw, ansi || raw);
    } catch {}
  });

  // 1.21.5+: playerChat
  bot.on('playerChat', (username, message, translate, jsonMsg) => {
    try {
      const msgStr = typeof message === 'string' ? message : toReadableString(message);
      const raw = `<${username}> ${msgStr}`;
      emitChat(raw, raw);
    } catch {}
  });

  // 1.21.5+: systemChat
  bot.on('systemChat', (message, overlay) => {
    try {
      const raw = toReadableString(message);
      if (raw && raw !== '[object Object]') emitChat(raw, raw);
    } catch {}
  });

  // Pacchetti raw player_chat e system_chat (1.21.8 direct)
  bot._client.on('player_chat', (d) => {
    try {
      // In 1.21.8 il messaggio è dentro unsignedContent o body.plainMessage
      let msg = '';
      if (d.unsignedContent) {
        msg = toReadableString(d.unsignedContent);
      } else if (d.message) {
        msg = toReadableString(d.message);
      } else if (d.body?.plainMessage) {
        msg = toReadableString(d.body.plainMessage);
      }
      if (!msg || msg === '[object Object]') return;

      let sender = '';
      if (d.displayName) sender = toReadableString(d.displayName);
      else if (d.networkName) sender = toReadableString(d.networkName);

      const raw = sender ? `<${sender}> ${msg}` : msg;
      emitChat(raw, raw);
    } catch {}
  });

  bot._client.on('system_chat', (d) => {
    try {
      let raw = '';
      if (d.content) {
        // content è spesso JSON string
        if (typeof d.content === 'string') {
          try {
            const parsed = JSON.parse(d.content);
            raw = toReadableString(parsed);
          } catch {
            raw = d.content;
          }
        } else {
          raw = toReadableString(d.content);
        }
      } else if (d.message) {
        raw = toReadableString(d.message);
      }
      if (raw && raw !== '[object Object]') emitChat(raw, raw);
    } catch {}
  });

  // Security
  bot._client.on('packet', (data, meta) => {
    try {
      if (meta.name === 'custom_payload') {
        const ch = (data.channel||'').toLowerCase();
        const sus = ['anticheat','nocheatplus','aac','spartan','matrix','grim','vulcan','fml:handshake'];
        ipc.send('packet', { channel: data.channel, suspicious: sus.some(s=>ch.includes(s)), preview: data.data?.toString('hex')?.substring(0,32)||'' });
      }
    } catch {}
  });

  // Inventory (vecchie versioni)
  if (!useRawInv) {
    let invUpdateTimer = null;
    bot.on('windowOpen', (win) => { 
      try { 
        let title = win.title;
        try { if (typeof title === 'string') title = JSON.parse(win.title).text || title; } catch {}
        ipc.send('window', getBotInventory()); 
        ModuleManager.onWindowOpen(String(title || 'Inventario'));
      } catch {} 
    });
    bot.on('updateSlot', () => { 
      if (invUpdateTimer) clearTimeout(invUpdateTimer);
      invUpdateTimer = setTimeout(() => { try { ipc.send('window', getBotInventory()); } catch {} }, 250); 
    });
  }

  // Kick
  bot.on('kicked', (reason) => {
    stats.kicks++;
    let msg; try { msg = toReadableString(JSON.parse(reason)); } catch { msg = String(reason).substring(0,200); }
    console.log(`[BOT] KICK: ${msg}`);
    ipc.send('log', { level: 'danger', msg: `KICK: ${msg}` });
    handleDisconnect();
  });

  // Error
  bot.on('error', (err) => {
    if (!err || isParseError(err.message)) return;
    console.log(`[BOT] error: ${err.message}`);
    if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') {
      ipc.send('log', { level: 'warn', msg: `Connessione persa (${err.code})` });
    } else {
      ipc.send('log', { level: 'error', msg: `Errore: ${err.message}` });
    }
    handleDisconnect();
  });

  // End
  bot.on('end', (reason) => {
    console.log(`[BOT] end: ${reason||'-'}`);
    if (state === 'online' || state === 'connecting') {
      ipc.send('log', { level: 'warn', msg: `Disconnesso${reason?': '+reason:''}` });
      handleDisconnect();
    }
  });
}

function getBotInventory() {
  if (!bot) return { title: 'Inventario', slots: [] };
  try {
    const win = bot.currentWindow || bot.inventory;
    if (!win) return { title: 'Inventario', slots: [] };
    return {
      title: toReadableString(win.title) || 'Inventario',
      slots: win.slots.map((item, i) => item ? {
        slot: i, name: item.name, displayName: item.displayName || item.name, count: item.count
      } : null).filter(Boolean)
    };
  } catch { return { title: 'Inventario', slots: [] }; }
}

function handleDisconnect() {
  spawnDone = false;
  rawInv.detach(); rawInv.clear();
  ModuleManager.reset();
  if (bot) { bot.removeAllListeners(); bot = null; }
  scheduleReconnect();
}

function scheduleReconnect() {
  if (reconnAttempts >= 10) { ipc.send('log', { level: 'danger', msg: 'Max riconnessioni raggiunto' }); setState('offline'); return; }
  reconnAttempts++;
  stats.reconnects++;
  const delay = Math.min(5000 * reconnAttempts, 60000);
  setState('reconnecting');
  ipc.send('log', { level: 'warn', msg: `Riconnessione ${reconnAttempts}/10 in ${delay/1000}s...` });
  reconnTimer = setTimeout(() => spawnBot(), delay);
}

// ── IPC Router ───────────────────────────────────────────────────────
function ipcRouter(msg) {
  switch (msg.type) {
    case 'connect':
      session = { account: msg.data.account, server: msg.data.server };
      reconnAttempts = 0;
      if (reconnTimer) { clearTimeout(reconnTimer); reconnTimer = null; }
      spawnBot();
      break;
 
    case 'disconnect':
      if (reconnTimer) { clearTimeout(reconnTimer); reconnTimer = null; }
      rawInv.detach(); rawInv.clear(); spawnDone = false;
      ModuleManager.reset();
      if (bot) { bot.removeAllListeners(); try { bot.quit(); } catch {}; bot = null; }
      setState('offline');
      ipc.send('log', { level: 'info', msg: 'Disconnesso.' });
      break;

    case 'look':
      if (bot && state==='online') { try { bot.look(+msg.data.yaw||0, +msg.data.pitch||0, false); } catch {} }
      break;
    case 'control':
      if (bot && state==='online') { try { bot.setControlState(msg.data.action, !!msg.data.state); } catch {} }
      break;
    case 'world:request':
      if (bot && state==='online') ModuleManager.action('WorldScanner','scanNow');
      break;
 
    case 'chat':
      if (bot && state === 'online') {
        try { bot.chat(String(msg.data)); stats.messagesSent++; } catch {}
      }
      break;
 
    case 'action':
      if (bot && state === 'online') {
        try {
          const { action, duration } = msg.data;
          if (action === 'close_window') {
            try {
              if (bot.currentWindow) bot.closeWindow(bot.currentWindow);
              else bot._client.write('close_window', { windowId: 0 });
            } catch {}
          } else {
            bot.setControlState(action, true);
            if (duration) setTimeout(() => { try { bot?.setControlState(action, false); } catch {} }, duration);
          }
        } catch {}
      }
      break;
 
    // NUOVO: tasto premi/rilascia
    case 'control':
      if (bot && state === 'online') {
        try {
          const { action, state: ctrlState } = msg.data;
          bot.setControlState(String(action), !!ctrlState);
        } catch {}
      }
      break;
 
    // NUOVO: sguardo bot (yaw/pitch in radianti)
    case 'look':
      if (bot && state === 'online') {
        try {
          bot.look(parseFloat(msg.data.yaw) || 0, parseFloat(msg.data.pitch) || 0, false);
        } catch {}
      }
      break;
 
    case 'module:toggle':
      const status = ModuleManager.toggle(msg.data.name, msg.data.value);
      if (status) ipc.send('modules', ModuleManager.getAllStatus());
      break;
 
    case 'module:action':
      ModuleManager.action(msg.data.name, msg.data.action, msg.data.params);
      ipc.send('modules', ModuleManager.getAllStatus());
      break;
 
    case 'module:command':
      if (bot && state === 'online' && msg.data.command) {
        try { bot.chat(msg.data.command); } catch {}
      }
      break;
 
    case 'inventory:click':
      if (bot && state === 'online') {
        try { bot.clickWindow(msg.data.slot, 0, 0).catch(() => {}); } catch {}
      }
      break;
 
    case 'getstats':
      ipc.send('stats', getStats());
      ipc.send('modules', ModuleManager.getAllStatus());
      if (state === 'online' && bot) {
        try { ipc.send('health', { health: bot.health, food: bot.food, saturation: bot.foodSaturation }); } catch {}
        try {
          if (bot.entity) ipc.send('pos', {
            x: +bot.entity.position.x.toFixed(2), y: +bot.entity.position.y.toFixed(2), z: +bot.entity.position.z.toFixed(2),
            yaw: +bot.entity.yaw.toFixed(3), pitch: +bot.entity.pitch.toFixed(3)
          });
        } catch {}
      }
      break;
 
    case 'getinventory':
      if (state === 'online' && bot) {
        // Forza refresh inventario
        try {
          const inv = useRawInv ? rawInv.getInventory() : getBotInventory();
          // Pulisci slot "air" e duplicati
          if (inv.slots) {
            inv.slots = inv.slots.filter(s => s && s.name && s.name !== 'air');
          }
          ipc.send('window', inv);
        } catch {
          ipc.send('window', { title: 'Inventario', slots: [] });
        }
      }
      break;
  }
}
 
module.exports = { ipcRouter };

ipc.connect();
console.log('[BOT PROCESS] Avviato');