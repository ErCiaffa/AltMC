/**
 * AutoLogin — Modulo auto-login/register per server cracked
 */
const BaseModule = require('./BaseModule');

class AutoLogin extends BaseModule {
  constructor() {
    super('AutoLogin');
    this.enabled = true; // attivo di default
    this.loginSent = false;
    this.registerSent = false;
  }

  onSpawn() {
    this.loginSent = false;
    this.registerSent = false;
    // Invia login dopo spawn (nel caso il server non mandi il messaggio)
    if (this.config.loginPassword && this.enabled) {
      setTimeout(() => {
        if (!this.loginSent) {
          this.chat(`/login ${this.config.loginPassword}`);
          this.loginSent = true;
          this.log('info', 'Login inviato allo spawn');
        }
      }, 1500);
    }
  }

  onChat(raw) {
    if (!this.enabled) return;
    const lower = raw.toLowerCase();

    // Rileva richiesta di registrazione
    if (!this.registerSent && this.config.registerPassword &&
        (lower.includes('register') || lower.includes('registra') || lower.includes('/register'))) {
      setTimeout(() => {
        this.chat(`/register ${this.config.registerPassword} ${this.config.registerPassword}`);
        this.registerSent = true;
        this.log('info', 'Register inviato');
      }, 600);
      return;
    }

    // Rileva richiesta di login
    if (!this.loginSent && this.config.loginPassword &&
        (lower.includes('login') || lower.includes('password') ||
         lower.includes('accedi') || lower.includes('connecte') ||
         lower.includes('autenti'))) {
      setTimeout(() => {
        this.chat(`/login ${this.config.loginPassword}`);
        this.loginSent = true;
        this.log('info', 'Login inviato');
      }, 600);
    }
  }

  getStatus() {
    return {
      ...super.getStatus(),
      loginSent: this.loginSent,
      registerSent: this.registerSent,
      hasPassword: !!this.config.loginPassword
    };
  }
}

module.exports = AutoLogin;
