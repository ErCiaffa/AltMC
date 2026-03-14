/**
 * server_patch.js — Aggiungere questi blocchi al server.js esistente
 *
 * 1) In handleBotMessage switch/case, aggiungere:
 *    case 'world': ...
 *
 * 2) In io.on('connection',...), aggiungere i socket event handlers
 *
 * 3) In state{}, aggiungere worldData: null
 */

// ── PATCH 1: In handleBotMessage(), aggiungere questo case ────────────
/*
    case 'world':
      state.worldData = msg.data;
      io.emit('bot:world', msg.data);
      break;
*/

// ── PATCH 2: In io.on('connection', (socket) => { ... }), aggiungere ─
/*
    // Manda world data all'utente se disponibile
    if (state.worldData) socket.emit('bot:world', state.worldData);

    // World view request
    socket.on('world:request', () => {
      sendToBot('world:request', {});
    });
*/

// ── PATCH 3: In ipcRouter() di bot.js, aggiungere ───────────────────
/*
    case 'world:request':
      if (bot && state === 'online') {
        ModuleManager.action('WorldScanner', 'scanNow');
      }
      break;

    case 'look':
      if (bot && state === 'online') {
        try { bot.look(parseFloat(msg.data.yaw)||0, parseFloat(msg.data.pitch)||0, false); } catch {}
      }
      break;

    case 'control':
      if (bot && state === 'online') {
        try { bot.setControlState(String(msg.data.action), !!msg.data.state); } catch {}
      }
      break;
*/

// ── PATCH 4: In server.js, i socket handlers bot:look e bot:control ──
/*
    socket.on('bot:look', ({ yaw, pitch }) => {
      sendToBot('look', { yaw, pitch });
    });

    socket.on('bot:control', ({ action, state: st }) => {
      sendToBot('control', { action, state: st });
    });
*/

// ════════════════════════════════════════════════════════
// SERVER.JS COMPLETO CON TUTTE LE PATCH APPLICATE
// Questo file SOSTITUISCE completamente server.js
// ════════════════════════════════════════════════════════

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Convert = require('ansi-to-html');
const ansiConvert = new Convert({ escapeXML: true });
const security = require('./modules/security');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' }, pingTimeout: 30000 });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── CONFIG ──────────────────────────────────────────────
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config/accounts.json'), 'utf8')); }
  catch { return { accounts: [], servers: [], dashPassword: null }; }
}
function saveConfig(data) {
  fs.writeFileSync(path.join(__dirname, 'config/accounts.json'), JSON.stringify(data, null, 2));
}

// ── AUTH ────────────────────────────────────────────────
const sessions = new Map();
function hashPwd(pwd) { return crypto.createHash('sha256').update(pwd + 'mcbot-v3-salt').digest('hex'); }
function genToken() { return crypto.randomBytes(32).toString('hex'); }
function getPassword() { const cfg = loadConfig(); return cfg.dashPassword || hashPwd('admin'); }
function isAuthenticated(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/mcbot_session=([a-f0-9]+)/);
  if (!match) return false;
  const exp = sessions.get(match[1]);
  if (!exp || Date.now() > exp) { sessions.delete(match[1]); return false; }
  return true;
}
setInterval(() => { const now=Date.now(); sessions.forEach((exp,tok)=>{ if(now>exp) sessions.delete(tok); }); }, 3600000);

app.use((req, res, next) => {
  const pub = ['/login', '/api/auth', '/socket.io'];
  if (pub.some(p => req.path.startsWith(p))) return next();
  if (isAuthenticated(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  return res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (isAuthenticated(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public/login.html'));
});

app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });
  if (hashPwd(password) !== getPassword()) return res.status(401).json({ error: 'Wrong password' });
  const token = genToken();
  sessions.set(token, Date.now() + 86400000 * 7);
  res.setHeader('Set-Cookie', `mcbot_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${86400*7}`);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const match = (req.headers.cookie||'').match(/mcbot_session=([a-f0-9]+)/);
  if (match) sessions.delete(match[1]);
  res.setHeader('Set-Cookie', 'mcbot_session=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// ── STATO ───────────────────────────────────────────────
const state = {
  bot: 'offline', modules: {}, worldData: null,
  stats: { connectedAt:null, messagesReceived:0, messagesSent:0, reconnects:0, kicks:0, state:'offline', uptime:0 },
  health: null, pos: null,
  inventory: { title:'Inventario', slots:[] },
  chatHistory: [], sysLog: []
};
function addChat(e)   { state.chatHistory.unshift(e); if(state.chatHistory.length>500) state.chatHistory.pop(); }
function addSysLog(e) { state.sysLog.unshift(e);      if(state.sysLog.length>300)      state.sysLog.pop(); }

// ── IPC ─────────────────────────────────────────────────
let botSocket = null;
const ipcServer = net.createServer((socket) => {
  console.log('[IPC] bot.js connesso');
  botSocket = socket;
  let buffer = '';
  socket.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split('\n'); buffer = lines.pop();
    lines.filter(Boolean).forEach(line => { try { handleBotMsg(JSON.parse(line)); } catch {} });
  });
  socket.on('close', () => {
    console.log('[IPC] bot.js disconnesso'); botSocket = null;
    if (state.bot !== 'offline') { state.bot='offline'; io.emit('bot:state',{state:'offline'}); }
  });
  socket.on('error', () => { botSocket=null; });
});
ipcServer.listen(3001, '127.0.0.1', () => console.log('[IPC] in ascolto su :3001'));

function sendToBot(type, data) {
  if (!botSocket) return false;
  try { botSocket.write(JSON.stringify({type,data})+'\n'); return true; }
  catch { return false; }
}

// ── BOT MSG HANDLER ─────────────────────────────────────
function handleBotMsg(msg) {
  switch (msg.type) {
    case 'state':
      state.bot = msg.data.state;
      io.emit('bot:state', msg.data);
      if (msg.data.state==='online') setTimeout(()=>sendToBot('getstats',{}), 500);
      if (msg.data.state!=='online') { state.health=null; state.pos=null; }
      break;
    case 'spawn':
      state.bot = 'online';
      io.emit('bot:state',{state:'online'});
      io.emit('bot:spawn',{});
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
      break;
    case 'window':
      if (JSON.stringify(state.inventory) !== JSON.stringify(msg.data)) {
        state.inventory = msg.data;
        io.emit('bot:window', msg.data);
      }
      break;
    case 'chat': {
      const ts = msg.data.timestamp || Date.now();
      let html = msg.data.raw || '';
      try { if (msg.data.ansi) html = ansiConvert.toHtml(msg.data.ansi); } catch {}
      const entry = { raw:msg.data.raw, html, ts };
      addChat(entry);
      io.emit('chat:msg', entry);
      break;
    }
    case 'log': {
      const entry = { ...msg.data, ts:Date.now() };
      addSysLog(entry);
      io.emit('system:log', entry);
      break;
    }
    case 'modules':
      state.modules = msg.data;
      io.emit('modules:update', msg.data);
      break;
    case 'packet': {
      const classified = security.record(msg.data);
      if (classified) { io.emit('security:packet', classified); io.emit('security:alerts', security.getAlerts()); }
      break;
    }
    // ── NUOVO: dati mondo 3D ──
    case 'world':
      state.worldData = msg.data;
      io.emit('bot:world', msg.data);
      break;
  }
}

// ── SOCKET.IO ────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[WS] ${socket.id} | bot:${state.bot}`);
  const cfg = loadConfig();

  socket.emit('bot:state',     { state:state.bot });
  socket.emit('bot:stats',     state.stats);
  socket.emit('security:alerts', security.getAlerts());
  socket.emit('config:data',   { accounts:cfg.accounts, servers:cfg.servers });
  socket.emit('modules:update', state.modules);
  if (state.health) socket.emit('bot:health', state.health);
  if (state.pos)    socket.emit('bot:pos',    state.pos);
  socket.emit('bot:window', state.inventory);
  if (state.worldData) socket.emit('bot:world', state.worldData);

  [...state.chatHistory].reverse().slice(0,80).forEach(m => socket.emit('chat:msg', m));

  if (state.bot === 'online') {
    setTimeout(() => { sendToBot('getstats',{}); socket.emit('bot:spawn',{}); }, 200);
  }

  // Bot control
  socket.on('bot:connect', ({ accountId, serverId }) => {
    const cfg = loadConfig();
    const account = cfg.accounts.find(a=>a.id===accountId);
    const server  = cfg.servers.find(s=>s.id===serverId);
    if (!account||!server) { socket.emit('system:log',{level:'error',msg:'Account o server non trovato',ts:Date.now()}); return; }
    sendToBot('connect', { account, server });
  });

  socket.on('bot:disconnect', () => sendToBot('disconnect', {}));

  socket.on('bot:action', ({ action, duration }) => {
    sendToBot('action', { action, duration:duration||500 });
  });

  // Hold-state controls (tasto premi/rilascia)
  socket.on('bot:control', ({ action, state: st }) => {
    sendToBot('control', { action, state: st });
  });

  // Sguardo (yaw/pitch in radianti Minecraft)
  socket.on('bot:look', ({ yaw, pitch }) => {
    sendToBot('look', { yaw, pitch });
  });

  socket.on('bot:getstats', () => {
    socket.emit('bot:stats', state.stats);
    if (state.health) socket.emit('bot:health', state.health);
    if (state.pos)    socket.emit('bot:pos',    state.pos);
    sendToBot('getstats', {});
  });

  // Chat
  socket.on('chat:send', (msg) => {
    if (!msg||typeof msg!=='string') return;
    const trimmed = msg.trim().substring(0,256);
    if (sendToBot('chat', trimmed)) {
      state.stats.messagesSent = (state.stats.messagesSent||0)+1;
      const entry = { raw:`[Tu] ${trimmed}`, html:`<span style="color:#00ff88">[Tu] ${trimmed}</span>`, ts:Date.now() };
      addChat(entry); io.emit('chat:msg', entry);
    } else {
      socket.emit('system:log',{level:'warn',msg:'Bot non connesso',ts:Date.now()});
    }
  });

  // Inventory
  socket.on('inventory:refresh', () => { sendToBot('getinventory',{}); socket.emit('bot:window',state.inventory); });
  socket.on('inventory:close',   () => sendToBot('action',{action:'close_window'}));
  socket.on('inventory:click',   (data) => { sendToBot('inventory:click',{slot:data?.slot??data}); });

  // World view
  socket.on('world:request', () => { sendToBot('world:request', {}); });

  // Modules
  socket.on('modules:getall', () => socket.emit('modules:update', state.modules));
  socket.on('modules:toggle', (data) => sendToBot('module:toggle', data));
  socket.on('modules:action', (data) => sendToBot('module:action', data));

  // Security
  socket.on('security:getlog', () => {
    socket.emit('security:log', security.getLog(150));
    socket.emit('security:alerts', security.getAlerts());
  });
  socket.on('security:clear', () => {
    security.reset();
    socket.emit('security:alerts', security.getAlerts());
  });

  // Config
  socket.on('config:save', (data) => {
    try {
      const cur = loadConfig();
      const updated = { ...cur, ...data, dashPassword:cur.dashPassword };
      saveConfig(updated);
      io.emit('config:data',{accounts:updated.accounts,servers:updated.servers});
      socket.emit('system:log',{level:'success',msg:'Config salvata',ts:Date.now()});
    } catch(e) { socket.emit('system:log',{level:'error',msg:`Errore: ${e.message}`,ts:Date.now()}); }
  });

  socket.on('disconnect', () => console.log(`[WS] disconnesso: ${socket.id}`));
});

setInterval(() => { if (state.bot==='online') sendToBot('getstats',{}); }, 5000);

// API REST
app.get('/api/config', (req, res) => {
  const { dashPassword, ...safe } = loadConfig(); res.json(safe);
});
app.post('/api/config', (req, res) => {
  try {
    const cur = loadConfig();
    const updated = { ...cur, ...req.body, dashPassword:cur.dashPassword };
    saveConfig(updated);
    io.emit('config:data',{accounts:updated.accounts,servers:updated.servers});
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});
app.get('/api/status', (req, res) => res.json({ state:state.bot, stats:state.stats }));
app.get('/',          (req, res) => res.sendFile(path.join(__dirname,'public/index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname,'public/dashboard.html')));

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║  MCBot Dashboard  v4.1             ║`);
  console.log(`  ║  ► http://localhost:${PORT}            ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});