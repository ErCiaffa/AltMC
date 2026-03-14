const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Convert = require('ansi-to-html');
const convert = new Convert();

const botOptions = {
    host: 'premium.arenacraft.it',
    username: 'Ciaffa',
    auth: 'microsoft',
    version: '1.21.1',
    brand: 'vanilla'
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

let bot;
let antiAfkActive = false;

function createBot() {
    console.log(`\x1b[33m[SISTEMA]\x1b[0m Avvio istanza bot...`);
    bot = mineflayer.createBot(botOptions);

    // --- MONITORAGGIO SICUREZZA (ANTI-TRACKING) ---
    bot._client.on('packet', (data, metadata) => {
        // Intercettiamo pacchetti che spesso i server usano per tracciare bot
        const alertChannels = ['minecraft:brand', 'minecraft:register', 'fml:handshake', 'anticheat'];
        if (metadata.name === 'custom_payload') {
            io.emit('security_log', {
                type: 'WARNING',
                msg: `Canale sospetto rilevato: ${data.channel}`,
                data: data.data.toString().substring(0, 32)
            });
        }
    });

    // --- GESTIONE INVENTARIO ---
    const syncUI = () => {
        const win = bot.currentWindow || bot.inventory;
        if (!win) return;
        io.emit('update_window', {
            title: win.title ? (typeof win.title === 'string' ? win.title : JSON.parse(win.title).text) : 'Inventario',
            slots: win.slots.map((s, i) => s ? { slot: i, name: s.name, count: s.count } : null).filter(x => x)
        });
    };

    bot.on('windowOpen', syncUI);
    bot.on('updateSlot', syncUI);
    bot.on('spawn', () => {
        io.emit('status', { online: true });
        setTimeout(syncUI, 1000);
    });

    // --- MOVIMENTI FLUIDI ---
    bot.on('move', () => {
        if(bot.entity) io.emit('coords', { x: bot.entity.position.x, z: bot.entity.position.z });
    });

    // --- LOGICA CHAT ---
    bot.on('message', (m) => io.emit('chat_msg', { html: convert.toHtml(m.toAnsi()) }));

    // --- GESTIONE ERRORI E RICONNESSIONE ---
    bot.on('kicked', (reason) => {
        io.emit('security_log', { type: 'DANGER', msg: `KICKATO: ${reason}` });
        reconnect();
    });
    bot.on('error', (err) => {
        if (err.code === 'ECONNRESET') return;
        io.emit('security_log', { type: 'ERROR', msg: `Errore tecnico: ${err.message}` });
        reconnect();
    });
    bot.on('end', () => reconnect());
}

function reconnect() {
    io.emit('status', { online: false });
    setTimeout(createBot, 10000);
}

// --- COMANDI DALLA DASHBOARD ---
io.on('connection', (socket) => {
    socket.on('action', (type) => {
        if (!bot) return;
        switch(type) {
            case 'forward': 
                bot.setControlState('forward', true);
                setTimeout(() => bot.setControlState('forward', false), 500);
                break;
            case 'jump':
                bot.setControlState('jump', true);
                setTimeout(() => bot.setControlState('jump', false), 200);
                break;
            case 'close':
                bot.closeWindow(bot.currentWindow || bot.inventory);
                break;
            case 'antiafk':
                antiAfkActive = !antiAfkActive;
                socket.emit('security_log', { type: 'INFO', msg: `Anti-AFK: ${antiAfkActive ? 'ON' : 'OFF'}` });
                break;
        }
    });

    socket.on('click_slot', (data) => {
        bot.clickWindow(data.slot, 0, 0).then(() => setTimeout(() => io.emit('update_window', getActiveWindowItems()), 100));
    });

    socket.on('send_chat', (msg) => bot.chat(msg));
});

// Loop Anti-AFK
setInterval(() => {
    if (antiAfkActive && bot?.entity) {
        bot.look(bot.entity.yaw + 0.2, 0);
    }
}, 3000);

createBot();
server.listen(3000);