/**
 * MCBot Dashboard - Entry Point
 * Starts the web server and loads all modules
 */

const { httpServer, io } = require('./server/app');
const setupSockets = require('./server/sockets');

const PORT = process.env.PORT || 3000;

setupSockets(io);

httpServer.listen(PORT, () => {
  console.log('');
  console.log('  \x1b[36m╔══════════════════════════════════════╗\x1b[0m');
  console.log('  \x1b[36m║\x1b[0m  \x1b[1mMCBot Dashboard\x1b[0m  v2.0             \x1b[36m║\x1b[0m');
  console.log('  \x1b[36m║\x1b[0m  \x1b[32m►\x1b[0m http://localhost:' + PORT + '            \x1b[36m║\x1b[0m');
  console.log('  \x1b[36m╚══════════════════════════════════════╝\x1b[0m');
  console.log('');
});
