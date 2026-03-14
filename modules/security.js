/**
 * Security Module
 * Monitors suspicious packets, anti-cheat channels, plugin fingerprints
 */

const bot = require('../core/BotEngine');

const SUSPICIOUS_CHANNELS = [
  'nocheatplus', 'aac', 'spartan', 'matrix', 'anticheat',
  'grim', 'kauri', 'vulcan', 'negativity', 'intave', 'themis'
];

const KNOWN_SAFE = [
  'minecraft:brand', 'minecraft:register', 'minecraft:debug', 'fml:handshake'
];

class SecurityMonitor {
  constructor() {
    this.log = [];
    this.maxLog = 200;
    this.alerts = { suspicious: 0, safe: 0, unknown: 0 };
  }

  record(packet) {
    const ch = (packet.channel || '').toLowerCase();
    let level = 'unknown';
    let flagged = false;

    if (KNOWN_SAFE.some(s => ch.includes(s.toLowerCase()))) {
      level = 'safe';
    } else if (SUSPICIOUS_CHANNELS.some(s => ch.includes(s))) {
      level = 'danger';
      flagged = true;
    }

    this.alerts[level === 'safe' ? 'safe' : level === 'danger' ? 'suspicious' : 'unknown']++;

    const entry = {
      ts: Date.now(),
      channel: packet.channel,
      level,
      flagged,
      preview: packet.preview
    };

    this.log.unshift(entry);
    if (this.log.length > this.maxLog) this.log.pop();

    if (flagged) {
      bot.emit('log', {
        level: 'danger',
        msg: `[SICUREZZA] Anti-cheat rilevato: ${packet.channel}`
      });
    }

    return entry;
  }

  getLog(limit = 50) {
    return this.log.slice(0, limit);
  }

  getAlerts() {
    return { ...this.alerts };
  }

  reset() {
    this.log = [];
    this.alerts = { suspicious: 0, safe: 0, unknown: 0 };
  }
}

module.exports = new SecurityMonitor();
