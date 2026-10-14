/* Connection to the WaFox bridge (WebSocket for events, HTTP for media).
 *
 * Messages from bridge:
 *   {type:'status', connected:bool}
 *   {type:'chats', chats:[{id,name,unread,last,ts}]}
 *   {type:'history', chat, messages:[msg]}
 *   {type:'message', msg}
 * msg = {id, chat, from, fromMe, ts, kind:'text|image|video|voice|audio|sticker',
 *        text, media:'/media/<id>', mime, duration}
 *
 * Messages to bridge:
 *   {type:'chats'}  {type:'history', chat}  {type:'send', chat, text}
 * Uploads: POST /upload?token=..&chat=..&kind=image|video|sticker (raw body)
 */
var Net = {
  cfg: { url: '', token: '' },
  ws: null,
  handlers: {},
  retry: 0,
  timer: null,
  demo: false,

  httpBase: function () {
    return this.cfg.url.replace(/^ws/, 'http').replace(/\/+$/, '');
  },

  mediaUrl: function (path) {
    if (!path) return '';
    if (/^(data|blob|http)/.test(path)) return path;
    return this.httpBase() + path + '?token=' + encodeURIComponent(this.cfg.token);
  },

  connect: function (cfg, handlers) {
    this.cfg = cfg;
    this.handlers = handlers;
    this.close();
    if (!cfg.url) { handlers.status(false); return; }
    if (cfg.url === 'demo') { this.demo = true; this._demo(); return; }
    this.demo = false;
    this._open();
  },

  close: function () {
    clearTimeout(this.timer);
    if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch (e) {} this.ws = null; }
  },

  _open: function () {
    var self = this;
    try {
      this.ws = new WebSocket(this.cfg.url.replace(/\/+$/, '') + '/?token=' + encodeURIComponent(this.cfg.token));
    } catch (e) { this.handlers.status(false); return; }

    this.ws.onopen = function () {
      self.retry = 0;
      self.handlers.status(true);
      self.send({ type: 'chats' });
    };
    this.ws.onmessage = function (ev) {
      var data;
      try { data = JSON.parse(ev.data); } catch (e) { return; }
      var h = self.handlers[data.type];
      if (h) h(data);
    };
    this.ws.onclose = function () {
      self.handlers.status(false);
      self.retry = Math.min(self.retry + 1, 6);
      self.timer = setTimeout(function () { self._open(); }, 1000 * Math.pow(2, self.retry));
    };
    this.ws.onerror = function () {};
  },

  send: function (obj) {
    if (this.demo) { this._demoSend(obj); return; }
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  },

  upload: function (blob, params, cb) {
    if (this.demo) { setTimeout(function () { cb(null); }, 300); return; }
    var q = 'token=' + encodeURIComponent(this.cfg.token);
    for (var k in params) q += '&' + k + '=' + encodeURIComponent(params[k]);
    var xhr = new XMLHttpRequest({ mozSystem: true, mozAnon: true });
    xhr.open('POST', this.httpBase() + '/upload?' + q, true);
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    xhr.onload = function () { cb(xhr.status === 200 ? null : 'HTTP ' + xhr.status); };
    xhr.onerror = function () { cb('network error'); };
    xhr.send(blob);
  },

  /* ---------- demo mode (no bridge needed) ---------- */
  _demo: function () {
    var self = this, now = Math.floor(Date.now() / 1000);
    this._demoMsgs = {
      'anna@demo': [
        { id: 'd1', chat: 'anna@demo', from: 'Anna', fromMe: false, ts: now - 600, kind: 'text', text: 'Hi! Is the app working?' },
        { id: 'd2', chat: 'anna@demo', from: 'me', fromMe: true, ts: now - 500, kind: 'text', text: 'Yes, demo mode 🙂' }
      ],
      'team@demo': [
        { id: 'd3', chat: 'team@demo', from: 'Marco', fromMe: false, ts: now - 100, kind: 'text', text: 'Meeting at 5' }
      ]
    };
    setTimeout(function () {
      self.handlers.status(true);
      self.handlers.chats({ chats: [
        { id: 'anna@demo', name: 'Anna', unread: 0, last: 'Yes, demo mode 🙂', ts: now - 500 },
        { id: 'team@demo', name: 'Team', unread: 1, last: 'Meeting at 5', ts: now - 100 }
      ]});
    }, 200);
    // simulated incoming message to test mozNotification
    setTimeout(function () {
      var m = { id: 'd9', chat: 'anna@demo', from: 'Anna', fromMe: false, ts: Math.floor(Date.now() / 1000), kind: 'text', text: 'Test notification 🔔' };
      self._demoMsgs['anna@demo'].push(m);
      self.handlers.message({ msg: m });
    }, 8000);
  },

  _demoSend: function (obj) {
    var self = this;
    if (obj.type === 'history') {
      this.handlers.history({ chat: obj.chat, messages: this._demoMsgs[obj.chat] || [] });
    } else if (obj.type === 'send') {
      var m = { id: 'x' + Date.now(), chat: obj.chat, from: 'me', fromMe: true, ts: Math.floor(Date.now() / 1000), kind: 'text', text: obj.text };
      (this._demoMsgs[obj.chat] = this._demoMsgs[obj.chat] || []).push(m);
      setTimeout(function () { self.handlers.message({ msg: m }); }, 50);
    }
  }
};
