/**
 * SkyblockAFK — Modulo di automazione
 * Effettua /skyblock, poi /warps, e all'apertura della gui clicca riga 2 colonna 8
 * avanzando di 2 secondi in totale autonomia.
 */
const BaseModule = require('./BaseModule');

class SkyblockAFK extends BaseModule {
  constructor() {
    super('SkyblockAFK');
    this.step = 0;
    this.enabled = true; // ABILITATO DI DEFAULT
  }

  onSpawn() {
    if (!this.enabled) return;
    this.step = 1;
    this.log('info', 'Avvio sequenza SkyblockAFK (attesa di 5s per login)...');
    
    // Attende 5 secondi per permettere ad altri moduli come AutoLogin di agire prima.
    setTimeout(() => {
      if (!this.enabled || !this.bot) return;
      this.chat('/skyblock');
      this.log('info', 'Eseguito comando /skyblock');
      
      // Dopo altri 3 secondi esegue /warps
      setTimeout(() => {
        if (!this.enabled || !this.bot) return;
        this.chat('/home afk');
        this.log('info', 'Eseguito comando /home afk');
        this.step = 2; // Pronto per intercettare la GUI
      }, 3000);
      
    }, 5000);
  }

  onWindowOpen(title) {
    if (!this.enabled || this.step !== 2) return;
    this.log('info', `GUI intercettata: "${title}", preparo il click...`);
    
    // Attende che gli slot si carichino (1 secondo)
    setTimeout(() => {
      if (!this.enabled || !this.bot) return;
      
      // Calcolo slot: Riga 2, colonna 8 in una chest a 9 colonne (0-indexed)
      // Riga 1: index 0-8
      // Riga 2: index 9-17 -> Colonna 8 corrisponde all'indice 16 (9 + 7 = 16)
      const targetSlot = 16; 
      
      try {
        this.bot.clickWindow(targetSlot, 0, 0).catch(e => this.log('warn', `Errore click interno: ${e.message}`));
        this.log('info', `Cliccato slot ${targetSlot} (Riga 2, Colonna 8)`);
        this.step = 3;
        
        // Attende caricamento dopo il teletrasporto
        setTimeout(() => {
          if (!this.enabled || !this.bot) return;
          this.log('info', 'Warp eseguito, mi muovo in avanti per 2 secondi...');
          
          this.bot.setControlState('forward', true);
          
          setTimeout(() => {
            if (this.bot) this.bot.setControlState('forward', false);
            this.log('success', 'Sequenza SkyblockAFK completata con successo.');
            this.step = 0; // Reset, pronto per la prossima volta
          }, 2000);
          
        }, 2000); // Ritardo prima di correre
      } catch (err) {
        this.log('error', `Fallito click sulla GUI: ${err.message}`);
      }
    }, 1000);
  }
}

module.exports = SkyblockAFK;