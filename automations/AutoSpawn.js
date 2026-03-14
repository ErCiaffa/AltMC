/**
 * AutoSpawn — Va allo spawn automaticamente o su comando
 */
const BaseModule = require('./BaseModule');

class AutoSpawn extends BaseModule {
  constructor() {
    super('AutoSpawn');
    this.spawnCommand = '/spawn';
    this.autoOnDeath = false;
  }

  onSpawn() {
    if (this.enabled && this.config.runOnSpawn) {
      setTimeout(() => {
        this.chat(this.config.command || this.spawnCommand);
        this.log('info', `Comando spawn inviato: ${this.config.command || this.spawnCommand}`);
      }, 2000);
    }
  }

  goSpawn() {
    this.chat(this.config.command || this.spawnCommand);
    this.log('info', 'Spawn manuale');
  }

  getStatus() {
    return { ...super.getStatus(), command: this.config.command || this.spawnCommand };
  }
}

module.exports = AutoSpawn;
