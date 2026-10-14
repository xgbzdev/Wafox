/* WaFox bridge: connects to WhatsApp (via the open-source Baileys library,
 * which is UNOFFICIAL) and exposes a tiny WebSocket + HTTP API to the app.
 * Run:  npm install && TOKEN=choose-a-secret node server.js   then scan the QR.
 * Untested against the latest Baileys release - adjust imports if needed. */
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const qrcode = require('qrcode-terminal');
const sharp = require('sharp');
const pino = require('pino');
const baileys = require('@whiskeysockets/baileys');
const makeWASocket = baileys.default;
const { useMultiFileAuthState, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion } = baileys;

const PORT = process.env.PORT || 8787;
const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error('Set TOKEN=<secret> first'); process.exit(1); }

const MEDIA_DIR = path.join(__dirname, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const logger = pino({ level: 'silent' });
const chats = new Map();      // jid -> {id,name,unread,last,ts}
const history = new Map();    // jid -> [msg]
const raw = new Map();        // msg id -> raw baileys message (for lazy media download)
let sock = null;
let connected = false;

/* ---------- HTTP + WS ---------- */
const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (u.query.token !== TOKEN) { res.writeHead(401); return res.end('unauthorized'); }

  try {
    if (req.method === 'GET' && u.pathname.startsWith('/media/')) {
      const id = path.basename(u.pathname);
      const file = await getMediaFile(id);
      if (!file) { res.writeHead(404); return res.end(); }
      return serveFile(req, res, file.path, file.mime);
    }
    if (req.method === 'POST' && u.pathname === '/upload') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        try {
          await sendUpload(u.query, Buffer.concat(chunks), req.headers['content-type']);
          res.writeHead(200); res.end('ok');
        } catch (e) { console.error(e); res.writeHead(500); res.end(String(e.message)); }
      });
      return;
    }
    res.writeHead(404); res.end();
  } catch (e) { console.error(e); res.writeHead(500); res.end(); }
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const u = url.parse(req.url, true);
  if (u.query.token !== TOKEN) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});

function broadcast(obj) {
  const s = JSON.stringify(obj);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(s); });
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'status', connected }));
  ws.on('message', async data => {
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (m.type === 'chats') {
      ws.send(JSON.stringify({ type: 'chats', chats: [...chats.values()] }));
    } else if (m.type === 'history') {
      const l = (history.get(m.chat) || []).slice(-100);
      ws.send(JSON.stringify({ type: 'history', chat: m.chat, messages: l }));
      const c = chats.get(m.chat); if (c) c.unread = 0;
    } else if (m.type === 'send' && sock) {
      try { await sock.sendMessage(m.chat, { text: m.text }); } catch (e) { console.error(e); }
    }
  });
});

/* ---------- media ---------- */
function extFor(mime) {
  if (!mime) return 'bin';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('mpeg')) return 'mp3';
  return mime.split('/')[1] || 'bin';
}

async function getMediaFile(id) {
  const r = raw.get(id);
  if (!r) return null;
  const m = r.message;
  const node = m.imageMessage || m.videoMessage || m.audioMessage || m.stickerMessage;
  const mime = (node && node.mimetype) || 'application/octet-stream';
  const file = path.join(MEDIA_DIR, id.replace(/[^\w-]/g, '_') + '.' + extFor(mime));
  if (!fs.existsSync(file)) {
    const buf = await downloadMediaMessage(r, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
    fs.writeFileSync(file, buf);
  }
  return { path: file, mime };
}

function serveFile(req, res, file, mime) {
  const stat = fs.statSync(file);
  const range = req.headers.range;       // needed for <audio>/<video> seeking
  if (range) {
    const [s, e] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(s, 10), end = e ? parseInt(e, 10) : stat.size - 1;
    res.writeHead(206, { 'Content-Type': mime, 'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Content-Length': stat.size });
    fs.createReadStream(file).pipe(res);
  }
}

async function sendUpload(q, buf, mime) {
  if (!sock) throw new Error('WhatsApp not connected');
  const jid = q.chat;
  if (q.kind === 'sticker') {
    // 512x512 WebP, as WhatsApp expects
    const webp = await sharp(buf).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 80 }).toBuffer();
    await sock.sendMessage(jid, { sticker: webp });
  } else if (q.kind === 'video') {
    await sock.sendMessage(jid, { video: buf, mimetype: mime || 'video/mp4' });
  } else {
    await sock.sendMessage(jid, { image: buf });
  }
}

/* ---------- message conversion ---------- */
function convert(m) {
  const jid = m.key.remoteJid;
  const msg = m.message;
  if (!msg || jid === 'status@broadcast') return null;
  const out = {
    id: m.key.id, chat: jid, fromMe: !!m.key.fromMe,
    from: m.key.fromMe ? 'me' : (m.pushName || (m.key.participant || jid).split('@')[0]),
    ts: Number(m.messageTimestamp) || Math.floor(Date.now() / 1000),
    kind: 'text', text: ''
  };
  if (msg.conversation) out.text = msg.conversation;
  else if (msg.extendedTextMessage) out.text = msg.extendedTextMessage.text;
  else if (msg.imageMessage) { out.kind = 'image'; out.text = msg.imageMessage.caption || ''; out.mime = msg.imageMessage.mimetype; }
  else if (msg.videoMessage) { out.kind = 'video'; out.text = msg.videoMessage.caption || ''; out.mime = msg.videoMessage.mimetype; }
  else if (msg.audioMessage) { out.kind = msg.audioMessage.ptt ? 'voice' : 'audio'; out.duration = msg.audioMessage.seconds; out.mime = msg.audioMessage.mimetype; }
  else if (msg.stickerMessage) { out.kind = 'sticker'; out.mime = msg.stickerMessage.mimetype; }
  else return null;
  if (out.kind !== 'text') { out.media = '/media/' + out.id; raw.set(out.id, m); }
  return out;
}

function record(m) {
  const o = convert(m);
  if (!o) return null;
  if (!history.has(o.chat)) history.set(o.chat, []);
  const l = history.get(o.chat);
  if (l.some(x => x.id === o.id)) return null;
  l.push(o);
  const prev = o.kind === 'text' ? o.text : '[' + o.kind + ']';
  const c = chats.get(o.chat) || { id: o.chat, name: o.chat.split('@')[0], unread: 0 };
  if (!o.fromMe && m.pushName && !o.chat.endsWith('@g.us')) c.name = m.pushName;
  c.last = prev; c.ts = o.ts;
  if (!o.fromMe) c.unread = (c.unread || 0) + 1;
  chats.set(o.chat, c);
  return o;
}

/* ---------- WhatsApp connection ---------- */
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth'));
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, auth: state, logger });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) { console.log('Scan this QR in WhatsApp > Linked devices:'); qrcode.generate(qr, { small: true }); }
    if (connection === 'open') { connected = true; broadcast({ type: 'status', connected: true }); console.log('WhatsApp connected'); }
    if (connection === 'close') {
      connected = false; broadcast({ type: 'status', connected: false });
      const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode;
      if (code !== DisconnectReason.loggedOut) setTimeout(start, 2000);
      else console.log('Logged out: delete the auth folder and restart.');
    }
  });
  sock.ev.on('contacts.upsert', cs => cs.forEach(c => {
    const ch = chats.get(c.id); if (ch && (c.name || c.notify)) ch.name = c.name || c.notify;
  }));
  sock.ev.on('messaging-history.set', ({ messages }) => (messages || []).forEach(record));
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    messages.forEach(m => {
      const o = record(m);
      if (o && type === 'notify') broadcast({ type: 'message', msg: o });
      else if (o) broadcast({ type: 'message', msg: o });
    });
  });
}

server.listen(PORT, () => console.log('WaFox bridge on port ' + PORT));
start();
