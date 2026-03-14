/**
 * WorldScanner — Scansiona i blocchi vicini e li invia per la visuale 3D
 */
const BaseModule = require('./BaseModule');

// Scan range (relativo alla posizione del bot)
const RX = 16, RY_UP = 8, RY_DN = 4, RZ = 16;

// Cache nome→stringa per non chiamare getName ogni volta
class WorldScanner extends BaseModule {
  constructor() {
    super('WorldScanner');
    this.enabled = true;
    this._scanInterval = null;
    this._lastScanPos = null;
    this._lastBlockCount = 0;
    this._scanning = false;
  }

  onEnable() {
    // Scan periodico ogni 2.5 secondi se in gioco
    this._scanInterval = setInterval(() => this._maybeScan(), 2500);
  }

  onDisable() {
    if (this._scanInterval) { clearInterval(this._scanInterval); this._scanInterval = null; }
  }

  onSpawn() {
    if (this.enabled) {
      setTimeout(() => this._doScan(), 2000);
    }
  }

  // Chiamato dall'esterno via ModuleManager.action('WorldScanner','scanNow')
  scanNow() {
    this._doScan();
  }

  _maybeScan() {
    if (!this.bot?.entity || this._scanning) return;
    const pos = this.bot.entity.position;
    if (!this._lastScanPos) { this._doScan(); return; }
    const dx = pos.x - this._lastScanPos.x;
    const dz = pos.z - this._lastScanPos.z;
    const dy = pos.y - this._lastScanPos.y;
    // Ri-scansiona se il bot si è mosso >3 blocchi
    if (Math.sqrt(dx*dx + dz*dz + dy*dy) > 3) {
      this._doScan();
    }
  }

  _doScan() {
    if (!this.bot?.entity || this._scanning) return;
    this._scanning = true;
    const pos = this.bot.entity.position;
    const cx = Math.floor(pos.x), cy = Math.floor(pos.y), cz = Math.floor(pos.z);
    const yaw = this.bot.entity.yaw || 0;
    const pitch = this.bot.entity.pitch || 0;

    this._lastScanPos = { x: pos.x, y: pos.y, z: pos.z };

    const blocks = [];
    let scanned = 0;

    try {
      for (let dx = -RX; dx <= RX; dx++) {
        for (let dz = -RZ; dz <= RZ; dz++) {
          for (let dy = -RY_DN; dy <= RY_UP; dy++) {
            const bx = cx + dx, by = cy + dy, bz = cz + dz;
            try {
              const block = this.bot.blockAt(
                this.bot.entity.position.offset(dx, dy, dz)
              );
              scanned++;
              if (!block || !block.name || block.name === 'air') continue;

              // Solo blocchi visibili (almeno un lato esposto all'aria)
              // Per performance, inviamo tutti i non-aria e il frontend gestisce
              blocks.push({ x: bx, y: by, z: bz, n: block.name });

              // Limite massimo blocchi per non saturare IPC
              if (blocks.length >= 4000) break;
            } catch {}
          }
          if (blocks.length >= 4000) break;
        }
        if (blocks.length >= 4000) break;
      }
    } catch (e) {
      this.log('warn', `Scan errore: ${e.message}`);
    }

    this._lastBlockCount = blocks.length;
    this._scanning = false;

    // Invia via IPC
    this.ipc?.send('world', {
      pos: { x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2), yaw, pitch },
      blocks
    });
  }

  getStatus() {
    return {
      ...super.getStatus(),
      lastBlockCount: this._lastBlockCount,
      lastPos: this._lastScanPos ? `${Math.floor(this._lastScanPos.x)},${Math.floor(this._lastScanPos.y)},${Math.floor(this._lastScanPos.z)}` : '—'
    };
  }
}

module.exports = WorldScanner;