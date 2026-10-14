/* WaFox main UI (ES5 for old Gecko) */
(function () {
  function $(id) { return document.getElementById(id); }

  var state = { chats: {}, order: [], cur: null, msgs: {}, connected: false, audio: null, audioBtn: null };

  /* ---------- helpers ---------- */
  function hhmm(ts) {
    var d = new Date(ts * 1000), h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  function fmtDur(s) {
    if (!s || isNaN(s)) return '0:00';
    s = Math.round(s);
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function preview(m) {
    switch (m.kind) {
      case 'image': return '📷 ' + (m.text || 'Photo');
      case 'video': return '🎥 ' + (m.text || 'Video');
      case 'voice': return '🎤 Voice message';
      case 'audio': return '🎵 Audio';
      case 'sticker': return 'Sticker';
      default: return m.text || '';
    }
  }

  function showView(id) {
    var v = document.querySelectorAll('.view');
    for (var i = 0; i < v.length; i++) v[i].classList.remove('active');
    $(id).classList.add('active');
  }

  /* ---------- chat list ---------- */
  function renderChats() {
    var ul = $('chat-list');
    ul.innerHTML = '';
    state.order.sort(function (a, b) { return (state.chats[b].ts || 0) - (state.chats[a].ts || 0); });
    state.order.forEach(function (id) {
      var c = state.chats[id];
      var li = el('li');
      li.appendChild(el('div', 'avatar', (c.name || '?').charAt(0).toUpperCase()));
      var meta = el('div', 'cmeta');
      meta.appendChild(el('div', 'cname', c.name || id));
      meta.appendChild(el('div', 'cprev', c.last || ''));
      li.appendChild(meta);
      if (c.unread) li.appendChild(el('div', 'badge', String(c.unread)));
      li.onclick = function () { openChat(id); };
      ul.appendChild(li);
    });
  }

  function upsertChat(c) {
    if (!state.chats[c.id]) { state.chats[c.id] = c; state.order.push(c.id); }
    else for (var k in c) state.chats[c.id][k] = c[k];
  }

  /* ---------- conversation ---------- */
  function openChat(id) {
    state.cur = id;
    var c = state.chats[id] || { id: id, name: id };
    c.unread = 0;
    $('conv-title').textContent = c.name || id;
    $('messages').innerHTML = '';
    $('sticker-tray').classList.add('hidden');
    state.msgs[id] = [];
    showView('v-conv');
    Net.send({ type: 'history', chat: id });
    renderChats();
  }

  function stopAudio() {
    if (state.audio) { state.audio.pause(); state.audio = null; }
    if (state.audioBtn) { state.audioBtn.textContent = '▶'; state.audioBtn = null; }
  }

  function voiceNode(m) {
    var wrap = el('div', 'voice');
    var btn = el('button', null, '▶');
    var bar = el('div', 'bar'), fill = document.createElement('i');
    bar.appendChild(fill);
    var dur = el('span', 'dur', fmtDur(m.duration));
    wrap.appendChild(btn); wrap.appendChild(bar); wrap.appendChild(dur);

    var audio = null;
    btn.onclick = function () {
      if (audio && state.audio === audio) {            // toggle pause/play
        if (audio.paused) { audio.play(); btn.textContent = '❚❚'; }
        else { audio.pause(); btn.textContent = '▶'; }
        return;
      }
      stopAudio();
      audio = new Audio();
      audio.src = Net.mediaUrl(m.media);
      state.audio = audio; state.audioBtn = btn;
      audio.onloadedmetadata = function () { if (isFinite(audio.duration)) dur.textContent = fmtDur(audio.duration); };
      audio.ontimeupdate = function () {
        if (audio.duration) fill.style.width = (audio.currentTime / audio.duration * 100) + '%';
        dur.textContent = fmtDur(audio.currentTime);
      };
      audio.onended = function () { btn.textContent = '▶'; fill.style.width = '0'; dur.textContent = fmtDur(audio.duration); state.audio = null; state.audioBtn = null; };
      audio.onerror = function () { btn.textContent = '✕'; };
      audio.play();
      btn.textContent = '❚❚';
    };
    bar.onclick = function (ev) {                      // seek
      if (!audio || !audio.duration) return;
      var r = bar.getBoundingClientRect();
      audio.currentTime = (ev.clientX - r.left) / r.width * audio.duration;
    };
    return wrap;
  }

  function renderMsg(m) {
    var d = el('div', 'msg' + (m.fromMe ? ' me' : '') + (m.kind === 'sticker' ? ' sticker' : ''));
    var chat = state.chats[m.chat];
    if (!m.fromMe && chat && /@g\.us|group/i.test(chat.id + (chat.group ? 'group' : '')) && m.from)
      d.appendChild(el('div', 'who', m.from));

    if (m.kind === 'image' || m.kind === 'sticker') {
      var im = el('img', m.kind === 'image' ? 'media' : '');
      im.src = Net.mediaUrl(m.media);
      if (m.kind === 'image') im.onclick = function () { openViewer('image', m); };
      d.appendChild(im);
    } else if (m.kind === 'video') {
      var v = el('video', 'media');
      v.src = Net.mediaUrl(m.media);
      v.preload = 'metadata';
      v.onclick = function () { openViewer('video', m); };
      d.appendChild(v);
    } else if (m.kind === 'voice' || m.kind === 'audio') {
      d.appendChild(voiceNode(m));
    }
    if (m.text && m.kind !== 'sticker') d.appendChild(el('div', null, m.text));
    if (m.kind !== 'sticker') d.appendChild(el('div', 'ts', hhmm(m.ts)));
    return d;
  }

  function appendMsg(m) {
    var box = $('messages');
    var atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.appendChild(renderMsg(m));
    if (atBottom || m.fromMe) box.scrollTop = box.scrollHeight;
  }

  /* ---------- media viewer ---------- */
  function openViewer(kind, m) {
    var body = $('viewer-body');
    body.innerHTML = '';
    var e;
    if (kind === 'video') { e = document.createElement('video'); e.controls = true; e.autoplay = true; }
    else e = document.createElement('img');
    e.src = Net.mediaUrl(m.media);
    body.appendChild(e);
    $('viewer').classList.remove('hidden');
  }
  function closeViewer() {
    var v = $('viewer-body').querySelector('video');
    if (v) v.pause();
    $('viewer-body').innerHTML = '';
    $('viewer').classList.add('hidden');
  }

  /* ---------- incoming events ---------- */
  var handlers = {
    status: function (ok) {
      state.connected = ok;
      $('conn').className = 'dot ' + (ok ? 'on' : 'off');
    },
    chats: function (d) {
      state.chats = {}; state.order = [];
      d.chats.forEach(upsertChat);
      renderChats();
    },
    history: function (d) {
      if (d.chat !== state.cur) return;
      state.msgs[d.chat] = d.messages;
      $('messages').innerHTML = '';
      d.messages.forEach(function (m) { $('messages').appendChild(renderMsg(m)); });
      $('messages').scrollTop = $('messages').scrollHeight;
    },
    message: function (d) {
      var m = d.msg;
      var c = state.chats[m.chat];
      if (!c) { c = { id: m.chat, name: m.from || m.chat, unread: 0 }; upsertChat(c); }
      c.last = preview(m); c.ts = m.ts;

      var viewing = state.cur === m.chat && $('v-conv').classList.contains('active') && !document.hidden;
      if (state.cur === m.chat) {
        (state.msgs[m.chat] = state.msgs[m.chat] || []).push(m);
        appendMsg(m);
      }
      if (!m.fromMe && !viewing) {
        c.unread = (c.unread || 0) + 1;
        Notify.show(c.name || m.from, (m.from && m.from !== c.name ? m.from + ': ' : '') + preview(m), '60.png',
          function () { openChat(m.chat); });
      }
      renderChats();
    }
  };

  /* ---------- sending ---------- */
  function sendText() {
    var t = $('txt').value.replace(/^\s+|\s+$/g, '');
    if (!t || !state.cur) return;
    Net.send({ type: 'send', chat: state.cur, text: t });
    $('txt').value = '';
  }

  function uploadBlob(blob, kind, name, cb) {
    Net.upload(blob, { chat: state.cur, kind: kind, name: name || '' }, function (err) {
      if (err) alert('Send failed: ' + err);
      if (cb) cb(err);
    });
  }

  function renderTray() {
    var tray = $('sticker-tray');
    tray.innerHTML = '';
    var l = Sticker.list();
    if (!l.length) tray.appendChild(el('span', 'empty', 'No stickers yet – make one from the chat list (Stickers).'));
    l.forEach(function (u) {
      var im = el('img');
      im.src = u;
      im.onclick = function () {
        uploadBlob(Sticker.dataUrlToBlob(u), 'sticker', 'sticker');
        tray.classList.add('hidden');
      };
      tray.appendChild(im);
    });
  }

  /* ---------- settings ---------- */
  function loadCfg() {
    try { return JSON.parse(localStorage.getItem('wafox.cfg') || '{}'); } catch (e) { return {}; }
  }
  function connect() {
    var cfg = loadCfg();
    Net.connect({ url: cfg.url || '', token: cfg.token || '' }, handlers);
  }

  /* ---------- wire up ---------- */
  function init() {
    Notify.init();
    Sticker.init();

    $('btn-settings').onclick = function () {
      var c = loadCfg();
      $('cfg-url').value = c.url || ''; $('cfg-token').value = c.token || '';
      showView('v-settings');
    };
    $('btn-settings-back').onclick = function () { showView('v-chats'); };
    $('btn-cfg-save').onclick = function () {
      localStorage.setItem('wafox.cfg', JSON.stringify({
        url: $('cfg-url').value.replace(/\s+/g, ''), token: $('cfg-token').value.replace(/\s+/g, '')
      }));
      showView('v-chats');
      connect();
    };

    $('btn-back').onclick = function () { stopAudio(); state.cur = null; showView('v-chats'); renderChats(); };
    $('btn-send').onclick = sendText;
    $('txt').onkeydown = function (e) { if (e.keyCode === 13) sendText(); };

    $('btn-attach').onclick = function () { $('file-attach').click(); };
    $('file-attach').onchange = function () {
      var files = this.files, input = this;
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        uploadBlob(f, f.type.indexOf('video') === 0 ? 'video' : 'image', f.name);
      }
      input.value = '';
    };

    $('btn-tray').onclick = function () {
      var t = $('sticker-tray');
      if (t.classList.contains('hidden')) { renderTray(); t.classList.remove('hidden'); }
      else t.classList.add('hidden');
    };

    $('viewer-close').onclick = closeViewer;

    // sticker maker
    $('btn-sticker-maker').onclick = function () { showView('v-sticker'); };
    $('btn-sticker-back').onclick = function () { showView(state.cur ? 'v-conv' : 'v-chats'); };
    $('btn-pick').onclick = function () { $('file-sticker').click(); };
    $('file-sticker').onchange = function () { if (this.files[0]) Sticker.load(this.files[0]); this.value = ''; };
    $('btn-st-save').onclick = function () {
      if (!Sticker.img) { $('st-hint').textContent = 'Choose a picture first.'; return; }
      var u = Sticker.canvas.toDataURL('image/png');
      $('st-hint').textContent = Sticker.save(u) ? 'Saved to your stickers.' : 'Storage full – could not save.';
    };
    $('btn-st-send').onclick = function () {
      if (!Sticker.img) { $('st-hint').textContent = 'Choose a picture first.'; return; }
      if (!state.cur) { $('st-hint').textContent = 'Open a chat first, then come back here.'; return; }
      Sticker.toBlob(function (blob) {
        uploadBlob(blob, 'sticker', 'sticker', function (err) {
          if (!err) { showView('v-conv'); }
        });
      });
    };

    document.addEventListener('visibilitychange', function () { if (document.hidden) stopAudio(); });

    var cfg = loadCfg();
    if (!cfg.url) showView('v-settings'); else connect();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
