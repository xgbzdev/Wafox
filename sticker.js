/* Sticker maker: picture -> 512x512 canvas (zoom/pan/shape/caption) -> blob.
 * WhatsApp stickers are 512x512 WebP. Old Gecko cannot encode WebP, so we try
 * image/webp and fall back to PNG; the bridge converts to WebP with sharp. */
var Sticker = {
  SIZE: 512,
  img: null,
  canvas: null,
  ctx: null,

  init: function () {
    this.canvas = document.getElementById('sticker-canvas');
    this.ctx = this.canvas.getContext('2d');
    var self = this;
    ['st-zoom', 'st-x', 'st-y', 'st-shape', 'st-text'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', function () { self.draw(); });
      document.getElementById(id).addEventListener('change', function () { self.draw(); });
    });
    this.draw();
  },

  load: function (file) {
    var self = this, url = URL.createObjectURL(file), im = new Image();
    im.onload = function () {
      self.img = im;
      document.getElementById('st-zoom').value = 100;
      document.getElementById('st-x').value = 0;
      document.getElementById('st-y').value = 0;
      self.draw();
      URL.revokeObjectURL(url);
    };
    im.onerror = function () { alert('Cannot read this picture'); };
    im.src = url;
  },

  _clip: function (ctx, shape, S) {
    ctx.beginPath();
    if (shape === 'circle') {
      ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    } else if (shape === 'rounded') {
      var r = S * 0.16;
      ctx.moveTo(r, 0); ctx.lineTo(S - r, 0); ctx.quadraticCurveTo(S, 0, S, r);
      ctx.lineTo(S, S - r); ctx.quadraticCurveTo(S, S, S - r, S);
      ctx.lineTo(r, S); ctx.quadraticCurveTo(0, S, 0, S - r);
      ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
    } else {
      ctx.rect(0, 0, S, S);
    }
    ctx.closePath();
    ctx.clip();
  },

  draw: function () {
    var ctx = this.ctx, S = this.SIZE;
    ctx.clearRect(0, 0, S, S);
    if (!this.img) return;

    var zoom = document.getElementById('st-zoom').value / 100;
    var ox = document.getElementById('st-x').value / 100 * S / 2;
    var oy = document.getElementById('st-y').value / 100 * S / 2;
    var shape = document.getElementById('st-shape').value;
    var text = document.getElementById('st-text').value;

    var iw = this.img.width, ih = this.img.height;
    var scale = Math.max(S / iw, S / ih) * zoom;   // "cover" fit
    var w = iw * scale, h = ih * scale;

    ctx.save();
    this._clip(ctx, shape, S);
    ctx.drawImage(this.img, (S - w) / 2 + ox, (S - h) / 2 + oy, w, h);
    ctx.restore();

    if (text) {
      ctx.save();
      ctx.font = 'bold 56px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 10;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#000';
      ctx.fillStyle = '#fff';
      ctx.strokeText(text, S / 2, S - 18, S - 30);
      ctx.fillText(text, S / 2, S - 18, S - 30);
      ctx.restore();
    }
  },

  /* cb(blob, mime) */
  toBlob: function (cb) {
    var c = this.canvas;
    function png() { c.toBlob(function (b) { cb(b, 'image/png'); }, 'image/png'); }
    if (!c.toBlob) { // very old Gecko: build blob from data URL
      var d = c.toDataURL('image/png').split(',')[1], bin = atob(d), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return cb(new Blob([arr], { type: 'image/png' }), 'image/png');
    }
    c.toBlob(function (b) {
      if (b && b.type === 'image/webp') cb(b, 'image/webp'); else png();
    }, 'image/webp', 0.9);
  },

  /* ---------- "My stickers" (kept as data URLs in localStorage) ---------- */
  KEY: 'wafox.stickers',
  list: function () {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch (e) { return []; }
  },
  save: function (dataUrl) {
    var l = this.list();
    l.unshift(dataUrl);
    l = l.slice(0, 12);
    try { localStorage.setItem(this.KEY, JSON.stringify(l)); return true; }
    catch (e) { return false; }
  },
  dataUrlToBlob: function (u) {
    var p = u.split(','), mime = p[0].match(/:(.*?);/)[1], bin = atob(p[1]), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
};
