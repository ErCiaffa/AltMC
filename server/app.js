/**
 * Express server setup
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  pingTimeout: 30000,
  pingInterval: 10000
});

// Static files
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../public/dashboard.html')));

// API: get config
app.get('/api/config', (req, res) => {
  const cfg = require('../config/accounts.json');
  res.json(cfg);
});

// API: save config
app.post('/api/config', (req, res) => {
  const fs = require('fs');
  const configPath = path.join(__dirname, '../config/accounts.json');
  try {
    const current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const updated = { ...current, ...req.body };
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { app, httpServer, io };
