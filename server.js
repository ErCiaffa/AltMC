/**
 * server.js — Processo dedicato al web server + Socket.io
 * Comunica con bot.js via socket IPC su porta 3001
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const net = require('net');
const fs = require('fs');
const path = require('path');
const Convert = require('ansi-to-html');
const ansiConvert = new Convert({ escapeXML: true });

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' }, pingTimeout: 30000 });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config/accounts.json'), 'utf8')); }
  catch { return { accounts: [], servers: [] }; }
}

// ── STATO CONDIVISO ───────────────────────────────────────────────────
const state = {
  bot: 'offline',
  modules: {},
  stats: { connectedAt: null, messagesReceived: 0, messagesSent: 0, reconnects: 0, kicks: 0, state: 'offline', uptime: 0 },
  health: null,
  pos: null,
  inventory: { title: 'Inventario', slots: [] },
  securityAlerts: { suspicious: 0, unknown: 0, safe: 0 },
  securityLog: [],
  chatHistory: [],
  sysLog: []
};

function addChat(entry) {
  state.chatHistory.unshift(entry);
  if (state.chatHistory.length > 500) state.chatHistory.pop();
}

function addSysLog(entry) {
  state.sysLog.unshift(entry);
  if (state.sysLog.length > 300) state.sysLog.pop();
}

function addSecurity(entry) {
  state.securityLog.unshift(entry);
  if (state.securityLog.length > 200) state.securityLog.pop();
  if (entry.suspicious) state.securityAlerts.suspicious++;
  else state.securityAlerts.unknown++;
}

// ── IPC SERVER (ascolta bot.js) ───────────────────────────────────────
let botSocket = null;

const ipcServer = net.createServer((socket) => {
  console.log('[IPC] bot.js connesso');
  botSocket = socket;

  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    lines.filter(Boolean).forEach(line => {
      try { handleBotMessage(JSON.parse(line)); } catch {}
    });
  });

  socket.on('close', () => {
    console.log('[IPC] bot.js disconnesso');
    botSocket = null;
    // Se era online, segnala offline
    if (state.bot !== 'offline') {
      state.bot = 'offline';
      io.emit('bot:state', { state: 'offline' });
    }
  });

  socket.on('error', () => { botSocket = null; });
});

ipcServer.listen(3001, '127.0.0.1', () => console.log('[IPC] Server IPC in ascolto su :3001'));

function sendToBot(type, data) {
  if (!botSocket) return false;
  try { botSocket.write(JSON.stringify({ type, data }) + '\n'); return true; }
  catch { return false; }
}

// ── HANDLER messaggi da bot.js ────────────────────────────────────────
function handleBotMessage(msg) {
  switch (msg.type) {
    case 'state':
      state.bot = msg.data.state;
      io.emit('bot:state', msg.data);
      io.emit('status', { online: msg.data.state === 'online' }); // Legacy UI
      if (msg.data.state === 'online') {
        setTimeout(() => sendToBot('getstats', {}), 500);
      }
      if (msg.data.state === 'offline' || msg.data.state === 'reconnecting') {
        state.health = null; state.pos = null;
      }
      break;

    case 'spawn':
      state.bot = 'online';
      io.emit('bot:state', { state: 'online' });
      io.emit('bot:spawn', {});
      io.emit('status', { online: true }); // Legacy UI
      break;

    case 'stats':
      state.stats = msg.data;
      io.emit('bot:stats', msg.data);
      break;

    case 'health':
      state.health = msg.data;
      io.emit('bot:health', msg.data);
      break;

    case 'pos':
      state.pos = msg.data;
      io.emit('bot:pos', msg.data);
      io.emit('coords', { x: msg.data.x, z: msg.data.z }); // Legacy UI
      break;

    case 'window':
      state.inventory = msg.data;
      io.emit('bot:window', msg.data);
      io.emit('update_window', msg.data); // Legacy UI
      break;

    case 'chat': {
      const ts = msg.data.timestamp || Date.now();
      let html = msg.data.raw || '';
      try { if (msg.data.ansi) html = ansiConvert.toHtml(msg.data.ansi); } catch {}
      const entry = { raw: msg.data.raw, html, ts };
      addChat(entry);
      io.emit('chat:msg', entry);
      io.emit('chat_msg', { html }); // Legacy UI
      break;
    }

    case 'log': {
      const entry = { ...msg.data, ts: Date.now() };
      addSysLog(entry);
      io.emit('system:log', entry);
      const typeMap = { info: 'INFO', warn: 'WARNING', error: 'ERROR', danger: 'DANGER', success: 'SUCCESS' };
      io.emit('security_log', { type: typeMap[msg.data.level] || 'INFO', msg: msg.data.msg }); // Legacy UI
      break;
    }

    case 'modules':
      state.modules = msg.data;
      io.emit('modules:update', msg.data);
      break;

    case 'packet':
      addSecurity(msg.data);
      io.emit('security:packet', msg.data);
      io.emit('security:alerts', state.securityAlerts);
      io.emit('security_log', { 
        type: msg.data.suspicious ? 'WARNING' : 'INFO', 
        msg: `Canale ${msg.data.suspicious ? 'sospetto' : 'rilevato'}: ${msg.data.channel}`, 
        data: msg.data.preview 
      }); // Legacy UI
      break;
  }
}

// ── SOCKET.IO ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[WS] connesso: ${socket.id} | bot: ${state.bot}`);
  const cfg = loadConfig();

  // Manda stato completo al nuovo client
  socket.emit('bot:state', { state: state.bot });
  socket.emit('bot:stats', state.stats);
  socket.emit('security:alerts', state.securityAlerts);
  socket.emit('config:data', { accounts: cfg.accounts, servers: cfg.servers });
  if (state.health) socket.emit('bot:health', state.health);
  if (state.pos) socket.emit('bot:pos', state.pos);
  socket.emit('bot:window', state.inventory);

  // Chat history
  [...state.chatHistory].reverse().slice(0, 80).forEach(m => socket.emit('chat:msg', m));

  socket.emit('modules:update', state.modules);

  // Se online, chiedi refresh stats
  if (state.bot === 'online') {
    setTimeout(() => {
      sendToBot('getstats', {});
      socket.emit('bot:spawn', {});
    }, 200);
  }

  // ── BOT CONTROL ──
  socket.on('bot:connect', ({ accountId, serverId }) => {
    console.log(`[WS] connect: acc=${accountId} srv=${serverId}`);
    const cfg = loadConfig();
    const account = cfg.accounts.find(a => a.id === accountId);
    const server = cfg.servers.find(s => s.id === serverId);
    if (!account || !server) {
      socket.emit('system:log', { level: 'error', msg: 'Account o server non trovato', ts: Date.now() });
      return;
    }
    sendToBot('connect', { account, server });
  });

  socket.on('bot:disconnect', () => {
    sendToBot('disconnect', {});
  });

  socket.on('bot:action', ({ action, duration }) => {
    sendToBot('action', { action, duration: duration || 500 });
  });

  socket.on('bot:getstats', () => {
    socket.emit('bot:stats', state.stats);
    if (state.health) socket.emit('bot:health', state.health);
    if (state.pos) socket.emit('bot:pos', state.pos);
    sendToBot('getstats', {});
  });

  // ── LEGACY UI ACTIONS ──
  socket.on('send_chat', (msg) => {
    if (!msg || typeof msg !== 'string') return;
    const trimmed = msg.trim().substring(0, 256);
    sendToBot('chat', trimmed);
    io.emit('chat_msg', { html: `<span style="color:#00ff88">[Tu] ${trimmed}</span>` });
  });

  socket.on('action', (type) => {
    if (type === 'close') sendToBot('action', { action: 'close_window' });
    else sendToBot('action', { action: type, duration: 500 });
  });

  // ── CHAT ──
  socket.on('chat:send', (msg) => {
    if (!msg || typeof msg !== 'string') return;
    const trimmed = msg.trim().substring(0, 256);
    if (sendToBot('chat', trimmed)) {
      state.stats.messagesSent = (state.stats.messagesSent||0) + 1;
      const entry = { raw: `[Tu] ${trimmed}`, html: `<span style="color:#00ff88">[Tu] ${trimmed}</span>`, ts: Date.now() };
      addChat(entry);
      io.emit('chat:msg', entry);
    } else {
      socket.emit('system:log', { level: 'warn', msg: 'Bot non connesso', ts: Date.now() });
    }
  });

  // ── INVENTORY ──
  socket.on('inventory:refresh', () => {
    sendToBot('getinventory', {});
  });

  socket.on('inventory:close', () => {
    sendToBot('action', { action: 'close_window' });
  });
  
  socket.on('inventory:click', (data) => {
    const slot = data?.slot !== undefined ? data.slot : data;
    sendToBot('inventory:click', { slot });
  });

  // Compatibilità retroattiva col vecchio main.js
  socket.on('click_slot', (data) => {
    const slot = data?.slot !== undefined ? data.slot : data;
    sendToBot('inventory:click', { slot });
  });

  // ── ANTI-AFK ──
  socket.on('antiafk:toggle', ({ strategy }) => {
    sendToBot('antiafk', { strategy });
  });

  // ── SECURITY ──
  // ── MODULI ──
  socket.on('modules:getall', () => {
    socket.emit('modules:update', state.modules);
  });

  socket.on('modules:toggle', (data) => {
    sendToBot('module:toggle', data);
  });

  socket.on('modules:action', (data) => {
    sendToBot('module:action', data);
  });

  socket.on('modules:command', (data) => {
    sendToBot('module:command', data);
  });

  socket.on('security:getlog', () => {
    socket.emit('security:log', state.securityLog.slice(0, 100));
    socket.emit('security:alerts', state.securityAlerts);
  });

  socket.on('security:clear', () => {
    state.securityLog = [];
    state.securityAlerts = { suspicious: 0, unknown: 0, safe: 0 };
    socket.emit('security:alerts', state.securityAlerts);
  });

  // ── CONFIG ──
  socket.on('config:save', (data) => {
    try {
      const cfgPath = path.join(__dirname, 'config/accounts.json');
      const cur = loadConfig();
      fs.writeFileSync(cfgPath, JSON.stringify({ ...cur, ...data }, null, 2));
      const updated = loadConfig();
      io.emit('config:data', { accounts: updated.accounts, servers: updated.servers });
      socket.emit('system:log', { level: 'success', msg: 'Config salvata', ts: Date.now() });
    } catch (e) {
      socket.emit('system:log', { level: 'error', msg: `Errore: ${e.message}`, ts: Date.now() });
    }
  });

  socket.on('disconnect', () => console.log(`[WS] disconnesso: ${socket.id}`));
});

// Stats broadcast ogni 5s
setInterval(() => {
  if (state.bot === 'online') sendToBot('getstats', {});
}, 5000);

// ── API REST ──────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => res.json(loadConfig()));
app.post('/api/config', (req, res) => {
  try {
    const cur = loadConfig();
    const updated = { ...cur, ...req.body };
    fs.writeFileSync(path.join(__dirname, 'config/accounts.json'), JSON.stringify(updated, null, 2));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/status', (req, res) => res.json({ state: state.bot, stats: state.stats }));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public/dashboard.html')));

// ── AVVIO ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║  MCBot Dashboard  v3.0             ║`);
  console.log(`  ║  ► http://localhost:${PORT}            ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});