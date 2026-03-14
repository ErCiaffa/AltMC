/**
 * Socket Handler
 * Bridges BotEngine events ↔ dashboard clients
 */

const engine = require('../core/BotEngine');
const antiafk = require('../modules/antiafk');
const security = require('../modules/security');
const chatLogger = require('../modules/chat');
const fs = require('fs');
const path = require('path');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../config/accounts.json'), 'utf8'));
  } catch { return { accounts: [], servers: [] }; }
}

module.exports = function setupSockets(io) {

  // ─── ENGINE → TUTTI I CLIENT ────────────────────────────────────

  engine.on('state', (state) => {
    io.emit('bot:state', { state });
    if (state === 'online') {
      // Manda stato completo a tutti quando il bot va online
      setTimeout(() => {
        io.emit('bot:stats', engine.getStats());
        const health = engine.getHealth();
        const pos = engine.getPosition();
        const inv = engine.getInventory();
        if (health) io.emit('bot:health', health);
        if (pos) io.emit('bot:pos', pos);
        if (inv) io.emit('bot:window', inv);
      }, 500);
    }
  });

  engine.on('spawn', () => {
    io.emit('bot:state', { state: 'online' });
    io.emit('bot:stats', engine.getStats());
    setTimeout(() => {
      const health = engine.getHealth();
      const pos = engine.getPosition();
      const inv = engine.getInventory();
      if (health) io.emit('bot:health', health);
      if (pos) io.emit('bot:pos', pos);
      if (inv) io.emit('bot:window', inv);
    }, 800);
  });

  engine.on('health', (data) => { if (data) io.emit('bot:health', data); });
  engine.on('move', (pos) => { if (pos) io.emit('bot:pos', pos); });
  engine.on('window', (inv) => { if (inv) io.emit('bot:window', inv); });
  engine.on('packet', (pkt) => { io.emit('security:packet', security.record(pkt)); });
  engine.on('log', (entry) => { io.emit('system:log', { ...entry, ts: Date.now() }); });
  engine.on('chat', (msg) => {
    const entry = chatLogger.record(msg);
    io.emit('chat:msg', entry);
  });

  // Stats ogni 5 secondi
  setInterval(() => {
    if (engine.state === 'online') {
      io.emit('bot:stats', engine.getStats());
    }
  }, 5000);

  // ─── CONNESSIONE CLIENT ─────────────────────────────────────────

  io.on('connection', (socket) => {
    console.log(`[WS] Client connesso: ${socket.id} | stato bot: ${engine.state}`);

    const cfg = loadConfig();

    // Manda subito tutto lo stato corrente
    socket.emit('bot:state', { state: engine.state });
    socket.emit('bot:stats', engine.getStats());
    socket.emit('antiafk:status', antiafk.getStatus());
    socket.emit('security:alerts', security.getAlerts());
    socket.emit('config:data', { accounts: cfg.accounts, servers: cfg.servers });

    // Se il bot è già online, manda subito tutti i dati
    if (engine.state === 'online') {
      setTimeout(() => {
        const health = engine.getHealth();
        const pos = engine.getPosition();
        const inv = engine.getInventory();
        if (health) socket.emit('bot:health', health);
        if (pos) socket.emit('bot:pos', pos);
        if (inv) socket.emit('bot:window', inv);
        socket.emit('bot:online'); // segnale extra per la dashboard
      }, 300);
    }

    // Storico chat (ultimi 80 messaggi in ordine cronologico)
    chatLogger.getHistory(80).reverse().forEach(m => socket.emit('chat:msg', m));

    // ── CONTROLLO BOT ──
    socket.on('bot:connect', ({ accountId, serverId }) => {
      console.log(`[WS] bot:connect accountId=${accountId} serverId=${serverId}`);
      const cfg = loadConfig();
      const account = cfg.accounts.find(a => a.id === accountId);
      const server = cfg.servers.find(s => s.id === serverId);
      if (!account || !server) {
        socket.emit('system:log', { level: 'error', msg: 'Account o server non trovato', ts: Date.now() });
        return;
      }
      engine.connect(account, server);
    });

    socket.on('bot:disconnect', () => {
      engine.disconnect();
      antiafk.stop();
    });

    socket.on('bot:action', ({ action, duration }) => {
      engine.control(action, true, duration || 500);
    });

    socket.on('bot:look', ({ yaw, pitch }) => {
      engine.look(yaw, pitch);
    });

    socket.on('bot:getstats', () => {
      socket.emit('bot:stats', engine.getStats());
      if (engine.state === 'online') {
        const health = engine.getHealth();
        const pos = engine.getPosition();
        if (health) socket.emit('bot:health', health);
        if (pos) socket.emit('bot:pos', pos);
      }
    });

    // ── CHAT ──
    socket.on('chat:send', (msg) => {
      if (!msg || typeof msg !== 'string') return;
      const trimmed = msg.trim().substring(0, 256);
      if (engine.sendChat(trimmed)) {
        chatLogger.recordCommand(trimmed);
        socket.emit('chat:sent', { msg: trimmed, ts: Date.now() });
      } else {
        socket.emit('system:log', { level: 'warn', msg: 'Bot non connesso', ts: Date.now() });
      }
    });

    socket.on('chat:history', () => {
      socket.emit('chat:commands', chatLogger.getCommandHistory());
    });

    // ── INVENTARIO ──
    socket.on('inventory:click', ({ slot, button, mode }) => {
      engine.clickSlot(slot, button || 0, mode || 0)
        .then(() => setTimeout(() => socket.emit('bot:window', engine.getInventory()), 200))
        .catch(() => {});
    });

    socket.on('inventory:close', () => engine.closeWindow());

    socket.on('inventory:refresh', () => {
      socket.emit('bot:window', engine.getInventory());
    });

    // ── ANTI-AFK ──
    socket.on('antiafk:toggle', ({ strategy }) => {
      antiafk.toggle(strategy || 'combined');
      io.emit('antiafk:status', antiafk.getStatus());
    });

    // ── SICUREZZA ──
    socket.on('security:getlog', () => {
      socket.emit('security:log', security.getLog(100));
      socket.emit('security:alerts', security.getAlerts());
    });

    socket.on('security:clear', () => {
      security.reset();
      socket.emit('security:alerts', security.getAlerts());
    });

    // ── CONFIG ──
    socket.on('config:save', (data) => {
      try {
        const cfgPath = path.join(__dirname, '../config/accounts.json');
        const current = loadConfig();
        const updated = { ...current, ...data };
        fs.writeFileSync(cfgPath, JSON.stringify(updated, null, 2));
        socket.emit('system:log', { level: 'success', msg: 'Config salvata', ts: Date.now() });
        io.emit('config:data', { accounts: updated.accounts, servers: updated.servers });
      } catch (e) {
        socket.emit('system:log', { level: 'error', msg: `Errore salvataggio: ${e.message}`, ts: Date.now() });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[WS] Client disconnesso: ${socket.id}`);
    });
  });
};