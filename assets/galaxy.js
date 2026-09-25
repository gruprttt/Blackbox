/* BLACKBOX galaxy — what you see when you zoom into a lobe of the brain.
   One big star per topic (or chapter), laid out on a slowly turning spiral in the order you learn
   them. A star is as large as the topic and as bright as how much of it you've learned; a ring
   round it shows the exact share. Drag to pan, scroll or pinch to zoom, click a star to see it in
   the side panel, whose Open topic button opens it. */
(function () {
  "use strict";
  var BB = window.BB;
  if (!BB) return;

  var PALETTE = ["#22d3ee", "#a78bfa", "#fbbf24", "#34d399", "#f472b6", "#5b8cff", "#fb923c", "#a3e635", "#38bdf8", "#ff6b81", "#2dd4bf", "#c084fc"];
  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgba(hex, a) { var c = rgb(hex); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function Galaxy(canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext("2d"), W = 1, H = 1, DPR = 1;
    var stars = [], dust = [], color = "#5b8cff", cam = { x: 0, y: 0, k: 1 }, fit = 1, spin = 0, clock = 0, extent = 340;
    var hover = null, selected = null, running = false, raf = 0, lastT = 0;
    var dragging = false, moved = 0, lx = 0, ly = 0, pointers = {}, pinch = null;
    var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    var progress = opts.progress || function () { return { done: 0, total: 1 }; };

    function resize() {
      DPR = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, Math.round(canvas.clientWidth * DPR)); H = Math.max(1, Math.round(canvas.clientHeight * DPR));
      canvas.width = W; canvas.height = H;
      fit = Math.min(W / DPR / 2 / extent, H / DPR / 2 / (extent * 0.82)) * 0.94;
    }
    function layout(topics, base) {
      color = base;
      var n = topics.length, r = rng(n * 7 + 3);
      stars = topics.map(function (t, i) {
        var p = progress(t);
        return { node: t, i: i, a: 0, R: 0, x: 0, y: 0, color: t.c || PALETTE[i % PALETTE.length], ph: r() * 6.28, born: 0.15 + (n > 1 ? i / (n - 1) : 0) * 1.1,
                 r: 9 + 3.2 * Math.sqrt(p.total) };
      });
      // Walk out along an Archimedean spiral (R = R0 + B·θ), placing each star only once it has room
      // beside the previous one; B keeps neighbouring turns of the arm apart.
      var big = stars.reduce(function (m, s) { return Math.max(m, s.r); }, 10), R0 = 60 + big, B = (big * 2 + 70) / (2 * Math.PI), th = 0;
      stars.forEach(function (s, i) {
        if (i > 0) {
          var prev = stars[i - 1], need = prev.r + s.r + 56;
          for (var g = 0; g < 2000; g++) {
            var R = R0 + B * th;
            if (Math.hypot(Math.cos(th) * R - Math.cos(prev.a) * prev.R, (Math.sin(th) * R - Math.sin(prev.a) * prev.R) * 0.78) >= need) break;
            th += 0.02;
          }
        }
        s.a = th; s.R = R0 + B * th;
      });
      extent = stars.reduce(function (m, s) { return Math.max(m, s.R + s.r * 2); }, 200);
      dust = [];
      for (var i = 0; i < 160; i++) {                                         // a faint haze along the arm
        var a2 = r() * (th + 0.4) + (r() - 0.5) * 0.4, R2 = R0 + B * a2 + (r() - 0.5) * 70;
        dust.push({ a: a2, R: R2, s: 18 + r() * 40, o: 0.03 + r() * 0.05 });
      }
      refresh();
    }
    function refresh() {
      stars.forEach(function (s) { var p = progress(s.node); s.done = p.done; s.total = p.total; s.f = p.total ? p.done / p.total : 0; s.r = 9 + 3.2 * Math.sqrt(p.total); });
    }
    function pos(s) { var a = s.a + spin; return [Math.cos(a) * s.R, Math.sin(a) * s.R * 0.78]; }
    function toScreen(x, y) { var k = cam.k * fit * DPR; return [W / 2 + (x - cam.x) * k, H / 2 + (y - cam.y) * k]; }
    function toWorld(sx, sy) { var k = cam.k * fit; return [cam.x + (sx - W / 2 / DPR) / k, cam.y + (sy - H / 2 / DPR) / k]; }

    function frame(now) {
      raf = 0;
      if (!running) return;
      var dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0.016), t = now / 1000;
      lastT = now; clock += dt;
      if (!reduced && !dragging) spin += dt * 0.012;
      var intro = reduced ? 1 : Math.min(1, clock / 1.6), ease = 1 - Math.pow(1 - intro, 3);
      var k = cam.k * fit * DPR * (0.55 + 0.45 * ease);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      var bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
      bg.addColorStop(0, "#0d1226"); bg.addColorStop(1, "#04050b");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      ctx.setTransform(k, 0, 0, k, W / 2 - cam.x * k, H / 2 - cam.y * k);

      // galactic core + haze, brighter as the program fills in
      var total = stars.reduce(function (a, s) { return a + s.total; }, 0) || 1, done = stars.reduce(function (a, s) { return a + s.done; }, 0), gf = done / total;
      ctx.globalCompositeOperation = "lighter";
      var core = ctx.createRadialGradient(0, 0, 0, 0, 0, 120);
      core.addColorStop(0, rgba(color, 0.35 + 0.35 * gf)); core.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 0, 120, 0, 6.2832); ctx.fill();
      dust.forEach(function (d) {
        var a = d.a + spin, x = Math.cos(a) * d.R, y = Math.sin(a) * d.R * 0.78;
        var g = ctx.createRadialGradient(x, y, 0, x, y, d.s);
        g.addColorStop(0, rgba(color, d.o * (0.6 + gf) * ease)); g.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, d.s, 0, 6.2832); ctx.fill();
      });
      ctx.globalCompositeOperation = "source-over";

      // the learning path: a soft arm through the stars in order
      ctx.lineCap = "round";
      for (var i = 1; i < stars.length; i++) {
        var a = stars[i - 1], b = stars[i], pa = pos(a), pb = pos(b), vis = Math.min(1, Math.max(0, (clock - b.born) * 2));
        if (vis <= 0) continue;
        ctx.strokeStyle = a.f >= 1 ? rgba(a.color, 0.55) : "rgba(160,175,230,.16)";
        ctx.lineWidth = (a.f >= 1 ? 2.4 : 1.2) / (cam.k * fit);
        ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pa[0] + (pb[0] - pa[0]) * vis, pa[1] + (pb[1] - pa[1]) * vis); ctx.stroke();
      }

      // stars
      stars.forEach(function (s) {
        var appear = reduced ? 1 : Math.min(1, Math.max(0, (clock - s.born) * 2.2));
        if (appear <= 0) return;
        var p = pos(s); s.x = p[0]; s.y = p[1];
        var pulse = reduced ? 1 : 1 + 0.04 * Math.sin(t * 1.4 + s.ph);
        var r = s.r * appear * pulse * (s === selected ? 1.12 : 1), bright = 0.25 + 0.75 * s.f;
        var dim = selected && s !== selected && s !== hover ? 0.45 : 1;
        ctx.globalAlpha = dim;
        ctx.globalCompositeOperation = "lighter";
        var halo = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * (2.6 + 2.4 * s.f));
        halo.addColorStop(0, rgba(s.color, 0.45 * bright + 0.1)); halo.addColorStop(1, rgba(s.color, 0));
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(s.x, s.y, r * (2.6 + 2.4 * s.f), 0, 6.2832); ctx.fill();
        if (s.f > 0 && !reduced) {                                             // diffraction spikes on learned stars
          ctx.strokeStyle = rgba("#ffffff", 0.35 * s.f); ctx.lineWidth = 1 / (cam.k * fit);
          var L = r * (2 + 2.5 * s.f);
          ctx.beginPath(); ctx.moveTo(s.x - L, s.y); ctx.lineTo(s.x + L, s.y); ctx.moveTo(s.x, s.y - L); ctx.lineTo(s.x, s.y + L); ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
        var body = ctx.createRadialGradient(s.x - r * 0.3, s.y - r * 0.3, r * 0.1, s.x, s.y, r);
        body.addColorStop(0, rgba("#ffffff", 0.5 + 0.5 * s.f)); body.addColorStop(0.4, rgba(s.color, 0.55 + 0.45 * s.f)); body.addColorStop(1, rgba(s.color, 0.25 + 0.35 * s.f));
        ctx.fillStyle = body; ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 6.2832); ctx.fill();
        var lw = Math.max(2, r * 0.14);
        ctx.lineWidth = lw; ctx.strokeStyle = "rgba(255,255,255,.12)";
        ctx.beginPath(); ctx.arc(s.x, s.y, r + lw * 1.6, 0, 6.2832); ctx.stroke();
        if (s.f > 0) { ctx.strokeStyle = rgba(s.color, 1); ctx.beginPath(); ctx.arc(s.x, s.y, r + lw * 1.6, -Math.PI / 2, -Math.PI / 2 + s.f * 6.2832); ctx.stroke(); }
        if (s === hover || s === selected) { ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 1.6 / (cam.k * fit); ctx.beginPath(); ctx.arc(s.x, s.y, r + lw * 3.4, 0, 6.2832); ctx.stroke(); }
      });
      ctx.globalAlpha = 1;

      // labels in screen space, largest first, never overlapping
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.textAlign = "center";
      var placed = (opts.reserve ? opts.reserve() : []).map(function (q) { return [q[0] * DPR, q[1] * DPR, q[2] * DPR, q[3] * DPR]; });
      stars.slice().sort(function (a, b) { return (b === hover || b === selected) - (a === hover || a === selected) || b.total - a.total; }).forEach(function (s) {
        if ((reduced ? 1 : Math.min(1, (clock - s.born) * 2.2)) < 1) return;
        var p = toScreen(s.x, s.y), sr = s.r * cam.k * fit * DPR, fs = 12.5 * DPR, key = s === hover || s === selected;
        var label = (s.node.n || "").replace(/^\d+ · /, ""), num = ("0" + (s.i + 1)).slice(-2);
        label = num + " · " + (label.length > 30 ? label.slice(0, 28) + "…" : label);
        ctx.font = "600 " + fs + "px ui-sans-serif, system-ui, -apple-system, sans-serif";
        var w = ctx.measureText(label).width + 10 * DPR, y = p[1] + sr + 18 * DPR, box = [p[0] - w / 2, y - fs, w, fs * 2.5];
        if (!key && placed.some(function (q) { return box[0] < q[0] + q[2] && box[0] + box[2] > q[0] && box[1] < q[1] + q[3] && box[1] + box[3] > q[1]; })) return;
        placed.push(box);
        ctx.globalAlpha = selected && !key ? 0.5 : 1;
        ctx.lineWidth = 4 * DPR; ctx.strokeStyle = "rgba(4,6,12,.9)"; ctx.strokeText(label, p[0], y);
        ctx.fillStyle = "#fff"; ctx.fillText(label, p[0], y);
        ctx.font = "500 " + (10.5 * DPR) + "px ui-monospace, monospace"; ctx.fillStyle = rgba(s.color, 0.95);
        ctx.fillText(Math.round(s.f * 100) + "% · " + s.done + "/" + s.total, p[0], y + 14 * DPR);
      });
      ctx.globalAlpha = 1;
      schedule();
    }
    function schedule() { if (running && !raf && !document.hidden) raf = requestAnimationFrame(frame); }

    function pick(cx, cy) {
      var rect = canvas.getBoundingClientRect(), w = toWorld(cx - rect.left, cy - rect.top), best = null, bd = Infinity;
      stars.forEach(function (s) {
        var d = Math.hypot(s.x - w[0], s.y - w[1]), reach = Math.max(s.r * 1.6, 16 / (cam.k * fit));
        if (d < reach && d < bd) { bd = d; best = s; }
      });
      return best;
    }
    canvas.addEventListener("pointerdown", function (e) {
      pointers[e.pointerId] = [e.clientX, e.clientY];
      var ids = Object.keys(pointers);
      if (ids.length === 2) { var a = pointers[ids[0]], b = pointers[ids[1]]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: cam.k }; }
      dragging = true; moved = 0; lx = e.clientX; ly = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    });
    canvas.addEventListener("pointermove", function (e) {
      if (pointers[e.pointerId]) pointers[e.pointerId] = [e.clientX, e.clientY];
      var ids = Object.keys(pointers);
      if (pinch && ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        cam.k = Math.max(0.4, Math.min(6, pinch.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d)); moved = 99; return;
      }
      if (dragging) {
        var dx = e.clientX - lx, dy = e.clientY - ly;
        moved += Math.abs(dx) + Math.abs(dy);
        cam.x -= dx / (cam.k * fit); cam.y -= dy / (cam.k * fit); lx = e.clientX; ly = e.clientY;
        return;
      }
      var s = pick(e.clientX, e.clientY);
      if (s !== hover) { hover = s; canvas.style.cursor = s ? "pointer" : "grab"; if (opts.onHover) opts.onHover(s && s.node, s); }
    });
    function up(e) {
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) pinch = null;
      if (!dragging) return;
      dragging = false;
      if (moved < 6) { var s = pick(e.clientX, e.clientY); selected = s; if (opts.onSelect) opts.onSelect(s && s.node); }
    }
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", function () { if (hover) { hover = null; if (opts.onHover) opts.onHover(null); } });
    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      var rect = canvas.getBoundingClientRect(), before = toWorld(e.clientX - rect.left, e.clientY - rect.top);
      cam.k = Math.max(0.4, Math.min(6, cam.k * Math.exp(-e.deltaY * 0.0015)));
      var after = toWorld(e.clientX - rect.left, e.clientY - rect.top);
      cam.x += before[0] - after[0]; cam.y += before[1] - after[1];
    }, { passive: false });
    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas); else window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", schedule);

    return {
      open: function (lobeNode, base) {
        layout(lobeNode.k || [], base); resize();
        cam = { x: 0, y: 0, k: 1 }; clock = 0; selected = null; hover = null;
        running = true; lastT = 0; schedule();
      },
      close: function () { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
      refresh: refresh,
      select: function (node) { selected = stars.filter(function (s) { return s.node === node; })[0] || null; },
      selected: function () { return selected && selected.node; },
      zoom: function (f) { cam.k = Math.max(0.4, Math.min(6, cam.k * f)); },
      home: function () { cam = { x: 0, y: 0, k: 1 }; }
    };
  }
  BB.Galaxy = Galaxy;
})();
