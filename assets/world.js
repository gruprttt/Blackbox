/* BLACKBOX worlds — what you find when you step inside a lobe of the brain.
   Each program is a living tree that grows in front of you: a seed sprouts the trunk (the program),
   its topics grow out as branches in the order you learn them, subtopics as twigs, and every single
   lesson / problem / section is a leaf. Leaves you've learned are open and glowing; the rest are
   buds. Sap pulses climb toward what you've learned, fireflies gather as the tree fills out, and a
   leaf blooms the moment you learn it. Drag to pan, scroll or pinch to zoom, click to inspect,
   double-click a branch to fly to it (or a leaf to open it). */
(function () {
  "use strict";
  var BB = window.BB;
  if (!BB) return;

  var PALETTE = ["#22d3ee", "#a78bfa", "#fbbf24", "#34d399", "#f472b6", "#5b8cff", "#fb923c", "#a3e635", "#38bdf8", "#ff6b81", "#2dd4bf", "#c084fc"];
  var DEG = Math.PI / 180;

  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgba(hex, a) { var c = rgb(hex); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function qpt(x0, y0, cx, cy, x1, y1, t) { var u = 1 - t; return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1]; }

  // ── model + layout: a tree, trunk pointing up from (0,0) ─────────
  function build(tree, baseColor) {
    var nodes = [], byId = {}, r = rng(11);
    function make(src, parent, depth, color) {
      var leaf = Array.isArray(src);
      var n = { id: leaf ? src[0] : src.id, name: (leaf ? src[1] : src.n).replace(/^\d+ · /, ""), href: leaf ? src[2] : src.h, tag: leaf ? src[3] : "",
                leaf: leaf, parent: parent, depth: depth, kids: [], color: color, total: 0, done: 0, ph: r() * 6.28,
                num: leaf ? "" : ((src.n || "").match(/^(\d+) · /) || [])[1] || "" };
      nodes.push(n); byId[n.id] = n;
      if (!leaf) (src.k || []).forEach(function (k, i) { n.kids.push(make(k, n, depth + 1, depth === 0 ? (k.c || PALETTE[i % PALETTE.length]) : color)); });
      return n;
    }
    var root = make(tree, null, 0, baseColor);
    (function count(n) { n.total = n.leaf ? 1 : n.kids.reduce(function (s, k) { return s + count(k); }, 0) || 1; return n.total; })(root);

    // A branch: base (x0,y0) → tip (x1,y1), bowed through (cx,cy). Children sprout along it.
    function branch(n, x0, y0, ang, len, width, t0) {
      var bend = (r() - 0.5) * 0.35 * len;
      n.x0 = x0; n.y0 = y0; n.ang = ang; n.len = len; n.w = width;
      n.x1 = x0 + Math.sin(ang) * len; n.y1 = y0 - Math.cos(ang) * len;
      n.cx = (x0 + n.x1) / 2 + Math.cos(ang) * bend; n.cy = (y0 + n.y1) / 2 + Math.sin(ang) * bend;
      n.gs = t0; n.gd = 0.45 + Math.min(0.9, len / 260);                 // growth: start time + duration (s)
      n.x = n.x1; n.y = n.y1;
      var inner = n.kids.filter(function (k) { return !k.leaf; }), leaves = n.kids.filter(function (k) { return k.leaf; });
      inner.forEach(function (k, i) {
        var m = inner.length, f = m > 1 ? i / (m - 1) : 1;
        var at = n.depth === 0 ? 0.3 + 0.7 * f : 0.35 + 0.65 * f;          // where along this branch it sprouts
        var side = i % 2 ? 1 : -1;
        var spread = n.depth === 0 ? (74 - 58 * f) : (38 - 10 * f);
        if (n.depth === 0 && i === m - 1 && m > 2) side = 0;               // the last topic tops the tree
        var a = ang + side * (spread + (r() - 0.5) * 10) * DEG;
        var p = qpt(x0, y0, n.cx, n.cy, n.x1, n.y1, at);
        var size = Math.sqrt(k.total / Math.max(1, n.total));
        var kl = n.depth === 0 ? len * (0.62 - 0.26 * f) * (0.55 + 0.6 * Math.sqrt(k.total / maxTopic)) : len * (0.55 + 0.35 * size);
        kl = Math.max(kl, leafRoom(k));
        branch(k, p[0], p[1], a, kl, Math.max(1.4, width * (0.34 + 0.4 * size)), t0 + n.gd * at);
      });
      leaves.forEach(function (k, i) {                                     // leaves alternate along the twig
        var m = leaves.length, at = m > 1 ? 0.22 + 0.78 * (i / (m - 1)) : 0.9, side = i % 2 ? 1 : -1;
        var p = qpt(x0, y0, n.cx, n.cy, n.x1, n.y1, at);
        k.bx = p[0]; k.by = p[1]; k.ang = ang + side * (52 + (r() - 0.5) * 20) * DEG; k.size = 7 + r() * 2.5;
        k.x = p[0] + Math.sin(k.ang) * k.size; k.y = p[1] - Math.cos(k.ang) * k.size;
        k.gs = t0 + n.gd * at; k.gd = 0.45;
      });
    }
    function leafRoom(k) { var m = k.kids.filter(function (x) { return x.leaf; }).length; return m ? 16 + m * 5.2 : 0; }
    var maxTopic = root.kids.reduce(function (m, k) { return Math.max(m, k.total); }, 1);
    var H = 150 + root.kids.length * 20;
    branch(root, 0, 0, 0, H, 12 + Math.sqrt(root.total) * 0.45, 0);
    root.x = 0; root.y = -H * 0.5;

    // subtree bounds, for fitting the camera to any branch
    (function bounds(n) {
      var b = n.leaf ? [n.x - 10, n.y - 10, n.x + 10, n.y + 10] : [Math.min(n.x0, n.x1), Math.min(n.y0, n.y1), Math.max(n.x0, n.x1), Math.max(n.y0, n.y1)];
      n.kids.forEach(function (k) { var c = bounds(k); b = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[2]), Math.max(b[3], c[3])]; });
      n.b = b; return b;
    })(root);
    var growEnd = nodes.reduce(function (m, n) { return Math.max(m, n.gs + n.gd); }, 1);
    var sky = [], rs = rng(5);
    for (var i = 0; i < 260; i++) sky.push({ x: rs(), y: rs() * 0.8, s: rs() * 1.2 + 0.3, ph: rs() * 6.28 });
    return { root: root, nodes: nodes, byId: byId, growEnd: growEnd, sky: sky };
  }

  // ── renderer ───────────────────────────────────────────────────
  function World(canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext("2d"), W = 1, H = 1, DPR = 1;
    var M = null, cam = { x: 0, y: 0, k: 1 }, fly = null, hover = null, selected = null, focus = null;
    var clock = 0, running = false, raf = 0, lastT = 0, sap = [], flies = [], sparks = [];
    var dragging = false, moved = 0, lx = 0, ly = 0, pointers = {}, pinch = null;
    var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    var isDone = opts.isDone || function () { return false; };

    function resize() {
      DPR = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, Math.round(canvas.clientWidth * DPR)); H = Math.max(1, Math.round(canvas.clientHeight * DPR));
      canvas.width = W; canvas.height = H;
    }
    function refresh() {
      if (!M) return;
      (function tally(n) {
        if (n.leaf) {
          var was = n.done; n.done = isDone(n.id) ? 1 : 0;
          if (n.done && !was && clock > M.growEnd) { n.bloom = 1; burst(n); }   // learned just now: bloom
          return n.done;
        }
        n.done = n.kids.reduce(function (s, k) { return s + tally(k); }, 0);
        return n.done;
      })(M.root);
    }
    function burst(n) { for (var i = 0; i < 14; i++) { var a = Math.random() * 6.28, v = 20 + Math.random() * 40; sparks.push({ x: n.x, y: n.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, life: 1, c: n.color }); } }
    function fitCam(n) {
      var b = n.b, pad = n === M.root ? 40 : 30, w = b[2] - b[0] + pad * 2, h = b[3] - b[1] + pad * 2;
      return { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 - h * 0.04, k: Math.min(W / DPR / w, H / DPR / h, 6) };
    }
    function flyTo(n, instant) {
      focus = n;
      var c = fitCam(n);
      if (instant || reduced) { cam = c; fly = null; } else fly = { from: { x: cam.x, y: cam.y, k: cam.k }, to: c, t: 0 };
      if (opts.onFocus) opts.onFocus(n);
      start();
    }
    function toScreen(x, y) { return [W / 2 + (x - cam.x) * cam.k * DPR, H / 2 + (y - cam.y) * cam.k * DPR]; }
    function toWorld(sx, sy) { return [cam.x + (sx * DPR - W / 2) / (cam.k * DPR), cam.y + (sy * DPR - H / 2) / (cam.k * DPR)]; }
    function frac(n) { return n.total ? n.done / n.total : 0; }
    function grown(n) { return reduced ? 1 : Math.max(0, Math.min(1, (clock - n.gs) / n.gd)); }
    function inPath(n, of) { for (var p = of; p; p = p.parent) if (p === n) return true; return false; }
    function sway(n, t) { return reduced ? 0 : Math.sin(t * 0.9 + n.ph) * (n.depth * 0.7) * Math.min(1, n.len / 120 || 0.4); }

    function frame(now) {
      raf = 0;
      if (!running || !M) return;
      var dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0.016), t = now / 1000;
      lastT = now; clock += dt;
      if (fly) {
        fly.t = Math.min(1, fly.t + dt / 0.9);
        var e = fly.t < .5 ? 4 * fly.t * fly.t * fly.t : 1 - Math.pow(-2 * fly.t + 2, 3) / 2;
        cam.x = fly.from.x + (fly.to.x - fly.from.x) * e; cam.y = fly.from.y + (fly.to.y - fly.from.y) * e;
        cam.k = Math.exp(Math.log(fly.from.k) + (Math.log(fly.to.k) - Math.log(fly.from.k)) * e);
        if (fly.t >= 1) fly = null;
      }
      var root = M.root, base = root.color, rf = frac(root), active = hover || selected;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // night sky + a glow behind the canopy that brightens as the tree fills out
      var sk = ctx.createLinearGradient(0, 0, 0, H);
      sk.addColorStop(0, "#050712"); sk.addColorStop(0.7, "#0a0f22"); sk.addColorStop(1, "#0b1320");
      ctx.fillStyle = sk; ctx.fillRect(0, 0, W, H);
      M.sky.forEach(function (s) {
        ctx.globalAlpha = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.7 + s.ph));
        ctx.fillStyle = "#cdd6ff"; ctx.fillRect(s.x * W, s.y * H, s.s * DPR, s.s * DPR);
      });
      ctx.globalAlpha = 1;
      var k = cam.k * DPR;
      ctx.setTransform(k, 0, 0, k, W / 2 - cam.x * k, H / 2 - cam.y * k);
      var cb = root.b, crownY = (cb[1] + root.y1 * 0.4) / 1.4, cr = Math.max(cb[2] - cb[0], cb[3] - cb[1]) * 0.6;
      var halo = ctx.createRadialGradient(0, crownY, 0, 0, crownY, cr);
      halo.addColorStop(0, rgba(base, 0.1 + 0.25 * rf)); halo.addColorStop(1, rgba(base, 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, crownY, cr, 0, 6.2832); ctx.fill();
      // ground and roots
      var gr = ctx.createRadialGradient(0, 0, 0, 0, 0, root.len * 0.9);
      gr.addColorStop(0, rgba(base, 0.28)); gr.addColorStop(1, rgba(base, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(0, 4, root.len * 0.9, root.len * 0.12, 0, 0, 6.2832); ctx.fill();
      var rootsG = Math.min(1, clock / 0.6);
      ctx.strokeStyle = "rgba(120,100,90,.55)"; ctx.lineCap = "round";
      [-1, -0.45, 0.4, 1].forEach(function (s, i) {
        ctx.lineWidth = root.w * (0.5 - i * 0.06);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(s * root.w * 2, 6, s * root.w * 5 * rootsG, 12 + i * 2); ctx.stroke();
      });

      // branches: bark first, then the glowing sap of what you've learned
      M.nodes.forEach(function (n) {
        if (n.leaf) return;
        var g = grown(n);
        if (g <= 0) return;
        var sw0 = n.parent ? sway(n.parent, t) : 0, sw1 = sway(n, t);
        var x0 = n.x0 + sw0, x1 = n.x1 + sw1, cx = n.cx + (sw0 + sw1) / 2;
        var p = qpt(x0, n.y0, cx, n.cy, x1, n.y1, g), c1 = [x0 + (cx - x0) * g, n.y0 + (n.cy - n.y0) * g];
        var dim = active && !inPath(n, active) && !inPath(active, n) ? 0.2 : 1;
        ctx.globalAlpha = dim;
        ctx.strokeStyle = n.depth === 0 ? "#3b2f2a" : "#3a302c";
        ctx.lineWidth = n.w * (0.55 + 0.45 * g);
        ctx.beginPath(); ctx.moveTo(x0, n.y0); ctx.quadraticCurveTo(c1[0], c1[1], p[0], p[1]); ctx.stroke();
        ctx.strokeStyle = rgba(n.color, 0.22);                                   // bark highlight tinted by the branch colour
        ctx.lineWidth = n.w * 0.35;
        ctx.beginPath(); ctx.moveTo(x0 - n.w * 0.15, n.y0); ctx.quadraticCurveTo(c1[0] - n.w * 0.15, c1[1], p[0], p[1]); ctx.stroke();
        var f = frac(n);
        if (f > 0) {
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = rgba(n.color, (0.25 + 0.6 * f) * dim);
          ctx.lineWidth = Math.max(1, n.w * 0.38);
          ctx.beginPath(); ctx.moveTo(x0, n.y0); ctx.quadraticCurveTo(c1[0], c1[1], p[0], p[1]); ctx.stroke();
          ctx.globalCompositeOperation = "source-over";
        }
        n.sx = p[0]; n.sy = p[1];
      });
      ctx.globalAlpha = 1;

      // leaves: learned ones open and glow, the rest wait as buds
      M.nodes.forEach(function (n) {
        if (!n.leaf) return;
        var g = grown(n);
        if (g <= 0) return;
        var sw = sway(n.parent, t), bx = n.bx + sw, by = n.by;
        var dim = active && !inPath(n.parent, active) && active !== n && !inPath(active, n.parent) ? 0.16 : 1;
        ctx.globalAlpha = dim;
        var flutter = reduced ? 0 : Math.sin(t * 2 + n.ph) * 0.08;
        var ang = n.ang + flutter, s = n.size * g;
        if (n.bloom) n.bloom = Math.max(0, n.bloom - dt * 0.7);
        var open = n.done ? 1 : 0.38, sz = s * (open + (n.bloom || 0) * 0.8);
        ctx.save(); ctx.translate(bx, by); ctx.rotate(ang);
        ctx.strokeStyle = "rgba(90,80,70,.8)"; ctx.lineWidth = 0.8;                // stem
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -sz * 0.5); ctx.stroke();
        if (n.done) {
          ctx.globalCompositeOperation = "lighter";
          var gl = ctx.createRadialGradient(0, -sz, 0, 0, -sz, sz * 2.2);
          gl.addColorStop(0, rgba(n.color, 0.45)); gl.addColorStop(1, rgba(n.color, 0));
          ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, -sz, sz * 2.2, 0, 6.2832); ctx.fill();
          ctx.globalCompositeOperation = "source-over";
        }
        ctx.beginPath();                                                           // leaf blade
        ctx.moveTo(0, -sz * 0.4);
        ctx.quadraticCurveTo(sz * 0.62, -sz * 1.05, 0, -sz * 1.9);
        ctx.quadraticCurveTo(-sz * 0.62, -sz * 1.05, 0, -sz * 0.4);
        if (n.done) {
          var lf = ctx.createLinearGradient(0, -sz * 0.4, 0, -sz * 1.9);
          lf.addColorStop(0, rgba(n.color, 0.95)); lf.addColorStop(1, "rgba(255,255,255,.95)");
          ctx.fillStyle = lf; ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(0, -sz * 0.45); ctx.lineTo(0, -sz * 1.7); ctx.stroke();
        } else {
          ctx.fillStyle = "rgba(24,30,40,.95)"; ctx.fill();
          ctx.strokeStyle = rgba(n.color, 0.75); ctx.lineWidth = 0.9 / Math.max(0.6, cam.k); ctx.stroke();
        }
        if (n === hover || n === selected) {
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.4 / cam.k;
          ctx.beginPath(); ctx.arc(0, -sz * 1.1, sz * 1.3 + 2 / cam.k, 0, 6.2832); ctx.stroke();
        }
        ctx.restore();
        n.sx = bx + Math.sin(ang) * sz * 1.1; n.sy = by - Math.cos(ang) * sz * 1.1;
      });
      ctx.globalAlpha = 1;

      // branch tips: a small knot showing how much of that branch you've learned
      M.nodes.forEach(function (n) {
        if (n.leaf || n.depth === 0 || grown(n) < 1) return;
        ctx.globalAlpha = active && !inPath(n, active) && !inPath(active, n) ? 0.2 : 1;
        var f = frac(n), rr = Math.max(2.5, n.w * 0.75);
        ctx.fillStyle = f >= 1 ? rgba(n.color, 1) : "#2a2320";
        ctx.beginPath(); ctx.arc(n.sx, n.sy, rr, 0, 6.2832); ctx.fill();
        ctx.lineWidth = Math.max(1, rr * 0.45); ctx.strokeStyle = rgba(n.color, 0.35);
        ctx.beginPath(); ctx.arc(n.sx, n.sy, rr + ctx.lineWidth, 0, 6.2832); ctx.stroke();
        if (f > 0) { ctx.strokeStyle = rgba(n.color, 1); ctx.beginPath(); ctx.arc(n.sx, n.sy, rr + ctx.lineWidth, -Math.PI / 2, -Math.PI / 2 + f * 6.2832); ctx.stroke(); }
        if (n === hover || n === selected) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5 / cam.k; ctx.beginPath(); ctx.arc(n.sx, n.sy, rr + 6 / cam.k, 0, 6.2832); ctx.stroke(); }
      });
      ctx.globalAlpha = 1;

      // sap: pulses climb from the roots, branch by branch, to a leaf you've learned
      if (!reduced && clock > M.growEnd * 0.6) {
        if (sap.length < 26 && Math.random() < 0.35) {
          var learned = M.nodes.filter(function (n) { return n.leaf && n.done; });
          if (learned.length) {
            var target = learned[(Math.random() * learned.length) | 0], chain = [];
            for (var p2 = target.parent; p2; p2 = p2.parent) chain.unshift(p2);
            sap.push({ chain: chain, i: 0, u: 0, leaf: target, v: 1.3 + Math.random() });
          }
        }
        ctx.globalCompositeOperation = "lighter";
        sap = sap.filter(function (s) {
          var n = s.chain[s.i], next = s.chain[s.i + 1] || s.leaf, stop = 1;
          if (next !== s.leaf) stop = attachAt(n, next); else stop = attachAt(n, s.leaf);
          s.u += dt * s.v * (60 / Math.max(30, n.len));
          if (s.u >= stop) { s.i++; s.u = next.leaf ? 0 : 0; if (s.i >= s.chain.length) return false; }
          var cur = s.chain[s.i];
          var sw0 = cur.parent ? sway(cur.parent, t) : 0, sw1 = sway(cur, t);
          var pp = qpt(cur.x0 + sw0, cur.y0, cur.cx + (sw0 + sw1) / 2, cur.cy, cur.x1 + sw1, cur.y1, Math.min(1, s.u));
          var rr = Math.max(1.6, cur.w * 0.35);
          var g2 = ctx.createRadialGradient(pp[0], pp[1], 0, pp[0], pp[1], rr * 2.4);
          g2.addColorStop(0, "rgba(255,255,255,.95)"); g2.addColorStop(1, rgba(s.leaf.color, 0));
          ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(pp[0], pp[1], rr * 2.4, 0, 6.2832); ctx.fill();
          return true;
        });
        ctx.globalCompositeOperation = "source-over";
      }
      function attachAt(n, child) { return child.leaf ? leafAt(n, child) : Math.max(0.05, (child.gs - n.gs) / n.gd); }
      function leafAt(n, leaf) { return Math.max(0.05, Math.min(1, (leaf.gs - n.gs) / n.gd)); }

      // fireflies: more of them the more you've learned
      if (!reduced) {
        var want = 8 + Math.round(60 * rf);
        while (flies.length < want) flies.push({ x: cb[0] + Math.random() * (cb[2] - cb[0]), y: cb[1] + Math.random() * (cb[3] - cb[1]), ph: Math.random() * 6.28, v: 4 + Math.random() * 8 });
        if (flies.length > want) flies.length = want;
        ctx.globalCompositeOperation = "lighter";
        flies.forEach(function (f) {
          f.y -= f.v * dt; f.x += Math.sin(t + f.ph) * 6 * dt;
          if (f.y < cb[1] - 40) f.y = cb[3];
          var a = 0.35 + 0.35 * Math.sin(t * 2 + f.ph), rr = 3;
          var g3 = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rr * 3);
          g3.addColorStop(0, rgba("#fff7c2", a)); g3.addColorStop(1, rgba(base, 0));
          ctx.fillStyle = g3; ctx.beginPath(); ctx.arc(f.x, f.y, rr * 3, 0, 6.2832); ctx.fill();
        });
        sparks = sparks.filter(function (sp) {
          sp.life -= dt * 1.2; sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.vy += 30 * dt;
          if (sp.life <= 0) return false;
          ctx.fillStyle = rgba(sp.c, sp.life); ctx.beginPath(); ctx.arc(sp.x, sp.y, 1.8, 0, 6.2832); ctx.fill();
          return true;
        });
        ctx.globalCompositeOperation = "source-over";
      }

      // labels, screen space: most important first, never overlapping
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.textAlign = "center";
      var placed = (opts.reserve ? opts.reserve() : []).map(function (q) { return [q[0] * DPR, q[1] * DPR, q[2] * DPR, q[3] * DPR]; });
      var cands = M.nodes.filter(function (n) {
        if (n.sx == null || grown(n) < 1) return false;
        if (n === hover || n === selected || n.depth === 1) return true;
        return n.leaf ? cam.k > 2.2 : cam.k * n.len > 70;
      }).map(function (n) { return [n === hover || n === selected ? 0 : n.depth === 1 ? 1 : n.leaf ? 3 : 2, -n.total, n]; });
      cands.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
      cands.forEach(function (c) {
        var n = c[2], p = toScreen(n.sx, n.sy), big = c[0] <= 1;
        var fs = (big ? 12.5 : 11) * DPR;
        ctx.font = (big ? "600 " : "500 ") + fs + "px ui-sans-serif, system-ui, -apple-system, sans-serif";
        var label = (n.num ? n.num + " · " : "") + n.name;
        if (label.length > 36) label = label.slice(0, 34) + "…";
        var y = p[1] - 10 * DPR, w = ctx.measureText(label).width + 8 * DPR, h = fs * (n.leaf ? 1.3 : 2.4);
        var box = [p[0] - w / 2, y - fs, w, h];
        if (c[0] !== 0 && placed.some(function (q) { return box[0] < q[0] + q[2] && box[0] + box[2] > q[0] && box[1] < q[1] + q[3] && box[1] + box[3] > q[1]; })) return;
        if (box[0] + box[2] < 0 || box[0] > W || box[1] > H || box[1] + box[3] < 0) return;
        placed.push(box);
        var off = active && c[0] !== 0 && !inPath(n, active) && !inPath(active, n) && !(n.leaf && inPath(n.parent, active));
        if (off && active.depth > 0) return;                                      // focused on a branch: only its own labels
        ctx.globalAlpha = off ? 0.4 : 1;
        ctx.lineWidth = 4 * DPR; ctx.strokeStyle = "rgba(5,7,14,.88)"; ctx.strokeText(label, p[0], y);
        ctx.fillStyle = n.leaf ? (n.done ? "#f1fff8" : "#b7c0d6") : "#ffffff"; ctx.fillText(label, p[0], y);
        if (!n.leaf) {
          ctx.font = "500 " + (10 * DPR) + "px ui-monospace, monospace"; ctx.fillStyle = rgba(n.color, 0.95);
          ctx.fillText(n.done + "/" + n.total, p[0], y + 13 * DPR);
        }
      });
      ctx.globalAlpha = 1;
      schedule();
    }
    function schedule() { if (running && !raf && !document.hidden) raf = requestAnimationFrame(frame); }
    function start() { running = true; lastT = 0; schedule(); }

    // ── interaction ──
    function pick(cx, cy) {
      if (!M) return null;
      var rect = canvas.getBoundingClientRect(), w = toWorld(cx - rect.left, cy - rect.top), best = null, bd = Infinity;
      M.nodes.forEach(function (n) {
        if (n.sx == null) return;
        var reach = n.leaf ? Math.max(n.size * 1.4, 7 / cam.k) : Math.max(n.w * 1.2 + 4, 10 / cam.k), d = Math.hypot(n.sx - w[0], n.sy - w[1]);
        if (!n.leaf && n.depth > 0) {                                           // anywhere along a branch counts
          for (var s = 0.2; s < 1; s += 0.2) { var q = qpt(n.x0, n.y0, n.cx, n.cy, n.x1, n.y1, s); d = Math.min(d, Math.hypot(q[0] - w[0], q[1] - w[1]) + 3 / cam.k); }
        }
        if (d < reach && d / reach < bd) { bd = d / reach; best = n; }
      });
      return best;
    }
    canvas.addEventListener("pointerdown", function (e) {
      pointers[e.pointerId] = [e.clientX, e.clientY];
      var ids = Object.keys(pointers);
      if (ids.length === 2) { var a = pointers[ids[0]], b = pointers[ids[1]]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: cam.k }; }
      dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; fly = null;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    });
    canvas.addEventListener("pointermove", function (e) {
      if (pointers[e.pointerId]) pointers[e.pointerId] = [e.clientX, e.clientY];
      var ids = Object.keys(pointers);
      if (pinch && ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        cam.k = Math.max(0.08, Math.min(14, pinch.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d)); moved = 99; return;
      }
      if (dragging) {
        var dx = e.clientX - lx, dy = e.clientY - ly;
        moved += Math.abs(dx) + Math.abs(dy);
        cam.x -= dx / cam.k; cam.y -= dy / cam.k; lx = e.clientX; ly = e.clientY;
        return;
      }
      var n = pick(e.clientX, e.clientY);
      if (n !== hover) { hover = n; canvas.style.cursor = n ? "pointer" : "grab"; if (opts.onHover) opts.onHover(n); }
    });
    function up(e) {
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) pinch = null;
      if (!dragging) return;
      dragging = false;
      if (moved < 6) { var n = pick(e.clientX, e.clientY); selected = n; if (opts.onSelect) opts.onSelect(n); }
    }
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", function () { if (hover) { hover = null; if (opts.onHover) opts.onHover(null); } });
    canvas.addEventListener("dblclick", function (e) { var n = pick(e.clientX, e.clientY); if (n && opts.onEnter) opts.onEnter(n); });
    canvas.addEventListener("wheel", function (e) {
      e.preventDefault(); fly = null;
      var rect = canvas.getBoundingClientRect(), before = toWorld(e.clientX - rect.left, e.clientY - rect.top);
      cam.k = Math.max(0.08, Math.min(14, cam.k * Math.exp(-e.deltaY * 0.0015)));
      var after = toWorld(e.clientX - rect.left, e.clientY - rect.top);
      cam.x += before[0] - after[0]; cam.y += before[1] - after[1];
    }, { passive: false });
    if ("ResizeObserver" in window) new ResizeObserver(function () { resize(); }).observe(canvas); else window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", schedule);
    resize();

    return {
      // grow=true replays the growth from a seed (entering from the brain); deep links skip straight to grown
      open: function (tree, color, focusId, grow) {
        M = build(tree, color); selected = null; hover = null; sap = []; flies = []; sparks = [];
        clock = grow === false ? 1e6 : 0;
        refresh(); resize();
        flyTo(M.root, true);
        if (focusId && M.byId[focusId]) { selected = M.byId[focusId]; flyTo(selected, true); }
        start();
        return M;
      },
      close: function () { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
      refresh: refresh,
      focus: function (id, instant) { var n = M && (M.byId[id] || M.root); if (n) { selected = n; flyTo(n, instant); } },
      select: function (id) { selected = M && M.byId[id] || null; },
      root: function () { return M && M.root; },
      node: function (id) { return M && M.byId[id]; },
      focused: function () { return focus; },
      selected: function () { return selected; },
      zoom: function (f) { fly = { from: { x: cam.x, y: cam.y, k: cam.k }, to: { x: cam.x, y: cam.y, k: Math.max(0.08, Math.min(14, cam.k * f)) }, t: 0 }; }
    };
  }

  BB.World = World;
})();
