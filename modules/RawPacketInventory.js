/**
 * RawPacketInventory
 * Intercetta i pacchetti inventario dallo stream TCP socket direttamente,
 * bypassando completamente protodef che si rompe su 1.21.5+
 */

const { EventEmitter } = require('events');

// ── VarInt ───────────────────────────────────────────────────────────
function readVarInt(buf, offset) {
  let val = 0, shift = 0, pos = offset, b;
  do {
    if (pos >= buf.length) return { value: 0, size: 0, error: true };
    b = buf[pos++];
    val |= (b & 0x7F) << shift;
    shift += 7;
  } while (b & 0x80);
  return { value: val >>> 0, size: pos - offset };
}

function readUShort(buf, offset) {
  if (offset + 2 > buf.length) return { value: 0, size: 0, error: true };
  return { value: buf.readUInt16BE(offset), size: 2 };
}

function readByte(buf, offset) {
  if (offset >= buf.length) return { value: 0, size: 0, error: true };
  return { value: buf[offset], size: 1 };
}

function readString(buf, offset) {
  const len = readVarInt(buf, offset);
  if (len.error || offset + len.size + len.value > buf.length) return { value: '', size: 0, error: true };
  return { value: buf.toString('utf8', offset + len.size, offset + len.size + len.value), size: len.size + len.value };
}

// ── Slot 1.21.5+ ─────────────────────────────────────────────────────
function readSlot(buf, offset) {
  const start = offset;
  const count = readVarInt(buf, offset);
  if (count.error) return null;
  offset += count.size;
  if (count.value === 0) return { itemId: 0, itemCount: 0, bytes: offset - start };

  const itemId = readVarInt(buf, offset);
  if (itemId.error) return null;
  offset += itemId.size;

  const addCount = readVarInt(buf, offset);
  if (addCount.error) return null;
  offset += addCount.size;

  const remCount = readVarInt(buf, offset);
  if (remCount.error) return null;
  offset += remCount.size;

  for (let i = 0; i < addCount.value; i++) {
    const skip = skipComponent(buf, offset);
    if (skip < 0) return null;
    offset += skip;
  }
  for (let i = 0; i < remCount.value; i++) {
    const t = readVarInt(buf, offset);
    if (t.error) return null;
    offset += t.size;
  }
  return { itemId: itemId.value, itemCount: count.value, bytes: offset - start };
}

function skipComponent(buf, offset) {
  const start = offset;
  const typeId = readVarInt(buf, offset);
  if (typeId.error) return -1;
  offset += typeId.size;
  const p = skipComponentPayload(buf, offset, typeId.value);
  if (p < 0) return -1;
  return offset + p - start;
}

function skipComponentPayload(buf, offset, typeId) {
  try {
    switch (typeId) {
      case 1: case 2: case 3: case 10: case 17: case 18: case 21: case 36: {
        const v = readVarInt(buf, offset); return v.error ? -1 : v.size;
      }
      case 4: return offset + 1 > buf.length ? -1 : 1;
      case 5: case 6: case 7: {
        const s = readString(buf, offset); return s.error ? -1 : s.size;
      }
      case 9: {
        let sz = 0;
        const n = readVarInt(buf, offset); if (n.error) return -1; sz += n.size;
        for (let i = 0; i < n.value; i++) { const s = readString(buf, offset + sz); if (s.error) return -1; sz += s.size; }
        return sz;
      }
      case 11: case 13: {
        let sz = 0;
        const n = readVarInt(buf, offset); if (n.error) return -1; sz += n.size;
        for (let i = 0; i < n.value; i++) {
          const k = readVarInt(buf, offset + sz); if (k.error) return -1; sz += k.size;
          const v = readVarInt(buf, offset + sz); if (v.error) return -1; sz += v.size;
        }
        if (offset + sz >= buf.length) return -1;
        return sz + 1;
      }
      case 12: {
        let sz = 0;
        const n = readVarInt(buf, offset); if (n.error) return -1; sz += n.size;
        for (let i = 0; i < n.value; i++) {
          const t = readVarInt(buf, offset + sz); if (t.error) return -1; sz += t.size;
          const id = readString(buf, offset + sz); if (id.error) return -1; sz += id.size;
          if (offset + sz + 8 > buf.length) return -1; sz += 8;
          const op = readVarInt(buf, offset + sz); if (op.error) return -1; sz += op.size;
          const sl = readVarInt(buf, offset + sz); if (sl.error) return -1; sz += sl.size;
        }
        return offset + sz >= buf.length ? -1 : sz + 1;
      }
      case 16: {
        let sz = 0;
        const n = readVarInt(buf, offset); if (n.error) return -1; sz += n.size;
        for (let i = 0; i < n.value; i++) { const v = readVarInt(buf, offset + sz); if (v.error) return -1; sz += v.size; }
        return sz;
      }
      case 19: return offset + 5 > buf.length ? -1 : 5;
      case 20: return offset + 4 > buf.length ? -1 : 4;
      default: return -1;
    }
  } catch { return -1; }
}

// ════════════════════════════════════════════════════════════════════
class RawPacketInventory extends EventEmitter {
  constructor(itemRegistry) {
    super();
    this.registry = itemRegistry;
    this.slots = [];
    this.windowTitle = 'Inventario';
    this.windowId = 0;
    this._client = null;
    this._hooked = false;
    this._socketBuffer = Buffer.alloc(0);
    this._inGame = false;
    // Packet IDs per 1.21.8 (play state, server→client)
    // Questi vengono rilevati dinamicamente dal primo window_items ricevuto
    this._pktIdWindowItems = null;
    this._pktIdSetSlot = null;
    this._pktIdOpenWindow = null;
    this._knownPktIds = new Set();
  }

  attach(client) {
    if (this._hooked) this.detach();
    this._client = client;
    this._hooked = true;
    this._socketBuffer = Buffer.alloc(0);
    this._inGame = false;

    // ── Patch emit per sopprimere parse errors ──────────────────────
    const origEmit = client.emit.bind(client);
    this._origEmit = origEmit;
    client.emit = (event, ...args) => {
      if (event === 'error') {
        const msg = args[0]?.message || '';
        if (msg.includes('Parse error') || msg.includes('PartialReadError') ||
            msg.includes('array size is abnormally') || msg.includes('SizeOf error')) {
          return false;
        }
      }
      return origEmit(event, ...args);
    };

    // ── Strategia 1: 'raw' event (alcune versioni di nmp) ───────────
    client.on('raw', (buffer, meta) => {
      if (meta?.state !== 'play') return;
      const name = meta?.name || '';
      if (['window_items', 'set_slot', 'open_window', 'close_window'].includes(name)) {
        console.log(`[INV-DEBUG] raw event: ${name} buflen=${buffer.length}`);
        this._handleNamedPacket(name, buffer);
      }
    });

    // ── Strategia 2: eventi parsati (parzialmente) da mineflayer ────
    // Anche se il payload è rotto, l'evento viene emesso con i dati parziali
    client.on('window_items', (data) => {
      console.log(`[INV-DEBUG] window_items event keys=${Object.keys(data||{}).join(',')}`);
      console.log(`[INV-DEBUG] window_items raw data=${JSON.stringify(data)?.substring(0, 200)}`);
      this._onWindowItemsParsed(data);
    });

    client.on('set_slot', (data) => {
      console.log(`[INV-DEBUG] set_slot event slot=${data?.slot} item=${JSON.stringify(data?.item||data?.slotData)?.substring(0,100)}`);
      this._onSetSlotParsed(data);
    });

    client.on('open_window', (data) => {
      console.log(`[INV-DEBUG] open_window id=${data?.windowId} title=${JSON.stringify(data?.windowTitle||data?.title)}`);
      this._onOpenWindowParsed(data);
    });

    client.on('close_window', () => this._onCloseWindow());

    // ── Strategia 3: intercetta socket TCP raw ───────────────────────
    this._attachSocketInterceptor(client);

    // ── Segna quando siamo in game ───────────────────────────────────
    client.once('login', () => {
      this._inGame = true;
    });
  }

  // Intercetta direttamente i dati raw dallo stream TCP
  _attachSocketInterceptor(client) {
    // Aspetta che il socket sia disponibile
    const tryAttach = () => {
      const socket = client.socket || client._socket;
      if (!socket) {
        setTimeout(tryAttach, 500);
        return;
      }

      // Intercetta i dati in arrivo PRIMA che vengano processati
      socket.on('data', (chunk) => {
        if (!this._inGame) return;
        try {
          this._socketBuffer = Buffer.concat([this._socketBuffer, chunk]);
          this._processSocketBuffer();
        } catch {}
      });
    };

    tryAttach();
  }

  // Processa il buffer TCP cercando pacchetti inventario
  _processSocketBuffer() {
    let offset = 0;

    while (offset < this._socketBuffer.length) {
      // Leggi lunghezza pacchetto (VarInt)
      const lenResult = readVarInt(this._socketBuffer, offset);
      if (lenResult.error) break;

      const totalSize = lenResult.size + lenResult.value;
      if (offset + totalSize > this._socketBuffer.length) break; // pacchetto incompleto

      // Estrai il pacchetto completo
      const pktBuf = this._socketBuffer.slice(offset + lenResult.size, offset + totalSize);
      offset += totalSize;

      // Leggi packet ID
      const pktId = readVarInt(pktBuf, 0);
      if (pktId.error) continue;

      // Cerca pacchetti inventario in base all'ID
      // Li identifichiamo dal contesto (dimensione, struttura)
      this._tryParseInventoryPacket(pktBuf, pktId.value);
    }

    // Mantieni solo i dati non ancora processati
    if (offset > 0) {
      this._socketBuffer = this._socketBuffer.slice(offset);
    }

    // Limita buffer a 1MB per sicurezza
    if (this._socketBuffer.length > 1024 * 1024) {
      this._socketBuffer = Buffer.alloc(0);
    }
  }

  // Prova a parsare un pacchetto come window_items o set_slot
  _tryParseInventoryPacket(buf, pktId) {
    // Se abbiamo già identificato gli ID, usiamo quelli
    if (this._pktIdWindowItems !== null && pktId === this._pktIdWindowItems) {
      this._parseWindowItems(buf);
      return;
    }
    if (this._pktIdSetSlot !== null && pktId === this._pktIdSetSlot) {
      this._parseSetSlot(buf);
      return;
    }

    // Altrimenti, prova a riconoscere il pacchetto dalla struttura
    this._detectAndParse(buf, pktId);
  }

  // Riconosce automaticamente i pacchetti inventario per struttura
  _detectAndParse(buf, pktId) {
    if (this._knownPktIds.has(pktId)) return;
    if (buf.length < 4) return;

    let offset = readVarInt(buf, 0).size; // salta pktId

    // Prova window_items: windowId(u8) + stateId(VarInt) + count(VarInt)
    // count deve essere ragionevole (1-500 slot)
    try {
      const wId = readByte(buf, offset);
      if (!wId.error) {
        const sId = readVarInt(buf, offset + 1);
        if (!sId.error) {
          const cnt = readVarInt(buf, offset + 1 + sId.size);
          if (!cnt.error && cnt.value > 0 && cnt.value <= 500) {
            // Struttura plausibile per window_items — prova a parsare
            const result = this._parseWindowItemsAtOffset(buf, offset);
            if (result && result.length >= 0) {
              this._pktIdWindowItems = pktId;
              if (result.length > 0) {
                this.slots = result;
                this.emit('update', this.getInventory());
              }
              return;
            }
          }
        }
      }
    } catch {}

    // Prova set_slot: windowId(i8) + stateId(VarInt) + slotIndex(u16) + Slot
    try {
      const wId = readByte(buf, offset);
      if (!wId.error) {
        const sId = readVarInt(buf, offset + 1);
        if (!sId.error) {
          const slotIdx = readUShort(buf, offset + 1 + sId.size);
          if (!slotIdx.error && slotIdx.value < 500) {
            const slot = readSlot(buf, offset + 1 + sId.size + 2);
            if (slot) {
              this._pktIdSetSlot = pktId;
              this._applySetSlot(slotIdx.value, slot);
              return;
            }
          }
        }
      }
    } catch {}
  }

  _parseWindowItemsAtOffset(buf, offset) {
    const wId = readByte(buf, offset); if (wId.error) return null; offset += 1;
    const sId = readVarInt(buf, offset); if (sId.error) return null; offset += sId.size;
    const count = readVarInt(buf, offset); if (count.error) return null; offset += count.size;

    const slots = [];
    for (let i = 0; i < count.value; i++) {
      if (offset >= buf.length) break;
      const slot = readSlot(buf, offset);
      if (!slot) return null; // parsing fallito
      offset += slot.bytes;
      if (slot.itemCount > 0 && slot.itemId > 0) {
        const name = this.registry.getName(slot.itemId);
        slots.push({ slot: i, itemId: slot.itemId, count: slot.itemCount, name, displayName: this._fmt(name) });
      }
    }
    return slots;
  }

  _parseWindowItems(buf) {
    let offset = readVarInt(buf, 0).size;
    const result = this._parseWindowItemsAtOffset(buf, offset);
    if (result) {
      this.slots = result;
      this.emit('update', this.getInventory());
    }
  }

  _parseSetSlot(buf) {
    let offset = readVarInt(buf, 0).size;
    const wId = readByte(buf, offset); if (wId.error) return; offset += 1;
    const sId = readVarInt(buf, offset); if (sId.error) return; offset += sId.size;
    const slotIdx = readUShort(buf, offset); if (slotIdx.error) return; offset += 2;
    const slot = readSlot(buf, offset);
    if (slot) this._applySetSlot(slotIdx.value, slot);
  }

  _applySetSlot(slotIndex, slot) {
    this.slots = this.slots.filter(s => s.slot !== slotIndex);
    if (slot.itemCount > 0 && slot.itemId > 0) {
      const name = this.registry.getName(slot.itemId);
      this.slots.push({ slot: slotIndex, itemId: slot.itemId, count: slot.itemCount, name, displayName: this._fmt(name) });
      this.slots.sort((a, b) => a.slot - b.slot);
    }
    this.emit('update', this.getInventory());
  }

  // ── Gestione eventi nominati (raw event) ─────────────────────────
  _handleNamedPacket(name, buffer) {
    switch (name) {
      case 'window_items': {
        let offset = 0;
        const pktId = readVarInt(buffer, offset);
        if (!pktId.error) offset += pktId.size;
        const result = this._parseWindowItemsAtOffset(buffer, offset);
        if (result) {
          this.slots = result;
          this.emit('update', this.getInventory());
        }
        break;
      }
      case 'set_slot': this._parseSetSlot(buffer); break;
      case 'open_window': this._parseOpenWindow(buffer); break;
      case 'close_window': this._onCloseWindow(); break;
    }
  }

  _parseOpenWindow(buf) {
    let offset = readVarInt(buf, 0).size;
    const windowId = readVarInt(buf, offset); if (windowId.error) return; offset += windowId.size;
    const windowType = readVarInt(buf, offset); if (windowType.error) return; offset += windowType.size;
    const title = readString(buf, offset);
    this.windowId = windowId.value;
    this.windowTitle = title.value || 'Inventario';
    this.slots = [];
    this.emit('windowOpen', this.windowTitle);
  }

  // ── Fallback: dati parsati (parziali) da mineflayer ─────────────
  _onWindowItemsParsed(data) {
    if (!data) return;
    // Solo se socket interceptor non ha trovato niente
    if (this.slots.length > 0) return;

    const items = data.items || data.slots || [];
    const slots = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      const itemId = item.itemId ?? item.type ?? null;
      const count = item.itemCount ?? item.count ?? 1;
      if (itemId !== null) {
        const name = item.name || this.registry.getName(itemId);
        slots.push({ slot: i, itemId, count, name, displayName: this._fmt(name) });
      }
    }
    if (slots.length > 0) {
      this.slots = slots;
      this.windowId = data.windowId ?? 0;
      this.emit('update', this.getInventory());
    }
  }

  _onSetSlotParsed(data) {
    if (!data) return;
    const slotIndex = data.slot ?? -1;
    if (slotIndex < 0) return;
    const item = data.item || data.slotData;
    const itemId = item?.itemId ?? item?.type ?? null;
    const count = item?.itemCount ?? item?.count ?? 1;
    this.slots = this.slots.filter(s => s.slot !== slotIndex);
    if (itemId !== null) {
      const name = item?.name || this.registry.getName(itemId);
      this.slots.push({ slot: slotIndex, itemId, count, name, displayName: this._fmt(name) });
      this.slots.sort((a, b) => a.slot - b.slot);
    }
    this.emit('update', this.getInventory());
  }

  _onOpenWindowParsed(data) {
    if (!data) return;
    this.windowId = data.windowId ?? 0;
    this.windowTitle = this._extractTitle(data);
    this.slots = [];
    this.emit('windowOpen', this.windowTitle);
  }

  _onCloseWindow() {
    this.windowId = 0;
    this.windowTitle = 'Inventario';
    this.emit('windowClose');
  }

  // ── PUBLIC ───────────────────────────────────────────────────────
  getInventory() { return { title: this.windowTitle, slots: [...this.slots] }; }

  clear() {
    this.slots = [];
    this.windowTitle = 'Inventario';
    this.windowId = 0;
    this._socketBuffer = Buffer.alloc(0);
    this._pktIdWindowItems = null;
    this._pktIdSetSlot = null;
    this._knownPktIds = new Set();
    this._inGame = false;
  }

  detach() {
    if (this._origEmit && this._client) this._client.emit = this._origEmit;
    this._hooked = false;
    this._client = null;
  }

  _fmt(name) {
    return (name || 'unknown').replace('minecraft:', '').split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  _extractTitle(data) {
    try {
      const t = data.windowTitle || data.title || data.name || 'Inventario';
      if (typeof t === 'string') { try { return JSON.parse(t)?.text || t; } catch { return t; } }
      return t?.text || t?.translate || 'Inventario';
    } catch { return 'Inventario'; }
  }
}

module.exports = RawPacketInventory;