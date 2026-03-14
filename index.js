/**
 * index.js — Entry point
 * Avvia bot.js e server.js come processi separati
 */

const { spawn } = require('child_process');
const path = require('path');

function start(file, label) {
  const proc = spawn('node', [path.join(__dirname, file)], {
    stdio: 'inherit',
    env: process.env
  });

  proc.on('exit', (code, signal) => {
    console.log(`[${label}] Processo terminato (code=${code} signal=${signal}), riavvio in 3s...`);
    setTimeout(() => start(file, label), 3000);
  });

  proc.on('error', (err) => {
    console.error(`[${label}] Errore processo: ${err.message}`);
  });

  console.log(`[LAUNCHER] Avviato ${label} (pid=${proc.pid})`);
  return proc;
}

// Avvia server prima, poi bot (server deve essere pronto per IPC)
const serverProc = start('server.js', 'SERVER');
setTimeout(() => {
  const botProc = start('bot.js', 'BOT');
}, 1000);

// Gestione chiusura pulita
process.on('SIGINT', () => {
  console.log('\n[LAUNCHER] Chiusura...');
  process.exit(0);
});