/**
 * Chat Module
 * Stores chat history, filters, command shortcuts
 */

const Convert = require('ansi-to-html');
const convert = new Convert({ escapeXML: true });

class ChatLogger {
  constructor() {
    this.history = [];
    this.maxHistory = 500;
    this.commandHistory = [];
    this.maxCommands = 50;
  }

  record(rawChat) {
    const entry = {
      id: Date.now() + Math.random(),
      ts: Date.now(),
      raw: rawChat.raw,
      html: this._toHtml(rawChat.ansi),
      text: rawChat.raw
    };

    this.history.unshift(entry);
    if (this.history.length > this.maxHistory) this.history.pop();

    return entry;
  }

  recordCommand(cmd) {
    this.commandHistory.unshift({ cmd, ts: Date.now() });
    if (this.commandHistory.length > this.maxCommands) this.commandHistory.pop();
  }

  getHistory(limit = 100) {
    return this.history.slice(0, limit);
  }

  getCommandHistory() {
    return [...this.commandHistory];
  }

  search(query) {
    const q = query.toLowerCase();
    return this.history.filter(m => m.text.toLowerCase().includes(q));
  }

  clear() {
    this.history = [];
  }

  _toHtml(ansi) {
    try {
      return convert.toHtml(ansi || '');
    } catch {
      return ansi || '';
    }
  }
}

module.exports = new ChatLogger();
