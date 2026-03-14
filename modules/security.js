/**
 * Security Module — Classificazione intelligente dei pacchetti
 */

const SUSPICIOUS_CHANNELS = [
  'nocheatplus','aac','spartan','matrix','anticheat','grim',
  'kauri','vulcan','negativity','intave','themis','verus',
  'warden','horizon','abc','draco','sentinel','polar'
];

const KNOWN_SAFE = [
  'minecraft:brand','minecraft:register','minecraft:debug',
  'fml:handshake','fml:loginwrapper','fml2:loginwrapper',
  'fml:overridemeta','forge:tier_sorting','bungeecord:main',
  'velocity:player_info','worldedit:cui','voxelmap:atlasinfo',
  'minimap:share','journeymap:world','fabric-screen-handler-api:v1'
];

const KNOWN_PLUGIN_CHANNELS = [
  'essentials:','luckperms:','vault:','citizens:','mythicmobs:',
  'skinsrestorer:','headdatabase:','placeholderapi:','tokenenchant:',
  'coreprotect:','dynmap:','worldguard:'
];

class SecurityMonitor {
  constructor() {
    this.log = [];
    this.maxLog = 300;
    this.alerts = { suspicious: 0, safe: 0, unknown: 0 };
    this.channelStats = new Map(); // channel → count
  }

  record(packet) {
    const ch = (packet.channel || '').toLowerCase();
    let level = 'unknown';
    let flagged = false;
    let category = 'other';

    if (!ch) return null;

    // Sicuri noti
    if (KNOWN_SAFE.some(s => ch.includes(s))) {
      level = 'safe'; category = 'vanilla';
    }
    // Sospetti (anti-cheat)
    else if (SUSPICIOUS_CHANNELS.some(s => ch.includes(s))) {
      level = 'danger'; flagged = true; category = 'anticheat';
    }
    // Plugin comuni (safe)
    else if (KNOWN_PLUGIN_CHANNELS.some(s => ch.includes(s))) {
      level = 'safe'; category = 'plugin';
    }
    // Canali minecraft standard non classificati
    else if (ch.startsWith('minecraft:')) {
      level = 'safe'; category = 'minecraft';
    }
    // Canali BungeeCord / proxy
    else if (ch.includes('bungeecord') || ch.includes('velocity') || ch.includes('waterfall')) {
      level = 'safe'; category = 'proxy';
    }
    // Resto → unknown con analisi euristica
    else {
      // Parole chiave sospette nel canale
      const suspKeywords = ['check','cheat','hack','detect','flag','monitor','spy','watch'];
      if (suspKeywords.some(k => ch.includes(k))) {
        level = 'warn'; flagged = true; category = 'suspect';
      }
    }

    this.alerts[level === 'safe' ? 'safe' : level === 'danger' || level === 'warn' ? 'suspicious' : 'unknown']++;

    // Traccia statistiche per canale
    this.channelStats.set(packet.channel, (this.channelStats.get(packet.channel) || 0) + 1);

    const entry = {
      ts: Date.now(),
      channel: packet.channel,
      level,
      flagged,
      category,
      preview: packet.preview || '',
      count: this.channelStats.get(packet.channel)
    };

    this.log.unshift(entry);
    if (this.log.length > this.maxLog) this.log.pop();

    return entry;
  }

  getLog(limit = 100) { return this.log.slice(0, limit); }
  getAlerts() { return { ...this.alerts }; }
  getChannelStats() {
    const arr = [];
    this.channelStats.forEach((count, channel) => arr.push({ channel, count }));
    return arr.sort((a, b) => b.count - a.count).slice(0, 20);
  }

  reset() {
    this.log = [];
    this.alerts = { suspicious: 0, safe: 0, unknown: 0 };
    this.channelStats.clear();
  }
}

module.exports = new SecurityMonitor();