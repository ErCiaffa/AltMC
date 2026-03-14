/**
 * set-password.js — Imposta la password della dashboard
 * Esegui una volta: node set-password.js
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PASSWORD = '#Nve42002';
const SALT = 'mcbot-v3-salt';
const hash = crypto.createHash('sha256').update(PASSWORD + SALT).digest('hex');

const cfgPath = path.join(__dirname, 'config/accounts.json');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch(e) { console.log('Config non trovata, la creo...'); }
cfg.dashPassword = hash;
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log('✅ Password impostata: ' + PASSWORD);
console.log('   Hash SHA-256: ' + hash.substring(0, 16) + '...');