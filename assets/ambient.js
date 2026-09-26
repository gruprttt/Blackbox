/* BLACKBOX ambient background for reading pages: a slow star field, soft nebulae in the program's
   colour and a faint constellation of neurons that light up as you read. Kept deliberately quiet:
   it sits behind the page, fades out under the text column, caps at ~30 fps, pauses when the tab is
   hidden and draws a single still frame when the reader prefers reduced motion. */
(function () {
  "use strict";
  var layout = document.querySelector(".lesson-layout");
  if (!layout || !window.requestAnimationFrame) return;
  var canvas = document.createElement("canvas");
  canvas.className = "ambient-bg";
  canvas.setAttribute("aria-hidden", "true");
  document.body.insertBefore(canvas, document.body.firstChild);
  var g = canvas.getContext("2d");
  if (!g) return;

  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var color = (getComputedStyle(layout).getPropertyValue("--c") || "#5b8cff").trim();
  var rgb = hexRgb(color) || [91, 140, 255];
  var W = 0, H = 0, DPR = 1, stars = [], nodes = [], pulses = [], t0 = performance.now(), last = 0, raf = 0, lit = 0, litTarget = 0, burst = -1;

  function hexRgb(c) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
    if (!m) return null;
    var h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a.toFixed(3) + ")"; }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  function setup() {
    DPR = Math.min(1.5, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    var area = W * H;
    stars = [];
    for (var i = 0, n = Math.min(220, Math.round(area / 7000)); i < n; i++)
      stars.push({ x: Math.random() * W, y: Math.random() * H, z: rnd(0.2, 1), r: rnd(0.3, 1.2), tw: rnd(0, 6.28), sp: rnd(0.4, 1.4) });
    // Neurons prefer the margins, away from the text column.
    nodes = [];
    var count = Math.max(14, Math.min(42, Math.round(area / 36000)));
    for (var j = 0; j < count; j++) {
      var side = Math.random() < 0.5 ? 0 : 1, band = W > 1100 ? 0.26 : 0.5;
      var x = side ? W - Math.pow(Math.random(), 1.4) * W * band : Math.pow(Math.random(), 1.4) * W * band;
      nodes.push({ x: x, y: Math.random() * H, vx: rnd(-6, 6), vy: rnd(-5, 5), r: rnd(1.2, 2.4), order: Math.random(), ph: rnd(0, 6.28) });
    }
    nodes.sort(function (a, b) { return a.y - b.y; });
    nodes.forEach(function (nd, k) { nd.order = (k + Math.random() * 3) / (count + 3); });
  }

  function readProgress() {
    var max = document.documentElement.scrollHeight - innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
  }

  function frame(now) {
    raf = 0;
    var dt = Math.min(0.1, (now - last) / 1000 || 0.016);
    last = now;
    var t = (now - t0) / 1000, sy = scrollY;
    lit += (litTarget - lit) * Math.min(1, dt * 3);
    g.clearRect(0, 0, W, H);

    // nebulae
    var blobs = [[0.12, 0.18, 0.55, rgb, 0.10], [0.9, 0.72, 0.6, [160, 107, 255], 0.08], [0.78, 0.08, 0.35, rgb, 0.06]];
    blobs.forEach(function (b, i) {
      var x = W * b[0] + Math.sin(t * 0.05 + i * 2) * 40, y = H * b[1] + Math.cos(t * 0.04 + i) * 30 - (sy * 0.02) % H;
      var r = Math.max(W, H) * b[2] * (1 + Math.sin(t * 0.09 + i) * 0.06);
      var grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, rgba(b[3], b[4] * (0.8 + lit * 0.5)));
      grad.addColorStop(1, rgba(b[3], 0));
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
    });

    // stars (parallax with scroll, slow twinkle)
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i], y = (s.y - sy * 0.04 * s.z - t * 2 * s.z) % H;
      if (y < 0) y += H;
      var a = (0.25 + 0.55 * s.z) * (0.6 + 0.4 * Math.sin(t * s.sp + s.tw));
      g.fillStyle = "rgba(220,228,255," + a.toFixed(3) + ")";
      g.fillRect(s.x, y, s.r * s.z + 0.4, s.r * s.z + 0.4);
    }

    // neurons: drift, link to near neighbours, light up with reading progress
    var linkD = Math.min(170, Math.max(110, W / 9));
    for (var k = 0; k < nodes.length; k++) {
      var nd = nodes[k];
      if (!reduced) {
        nd.x += nd.vx * dt; nd.y += nd.vy * dt;
        if (nd.x < -20) nd.x = W + 20; else if (nd.x > W + 20) nd.x = -20;
        if (nd.y < -20) nd.y = H + 20; else if (nd.y > H + 20) nd.y = -20;
      }
      nd.on = nd.order <= lit || (burst >= 0 && nd.order <= (t - burst) / 1.6);
    }
    g.lineWidth = 1;
    for (var p = 0; p < nodes.length; p++) for (var q = p + 1; q < nodes.length; q++) {
      var A = nodes[p], B = nodes[q], dx = A.x - B.x, dy = A.y - B.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d > linkD) continue;
      var f = 1 - d / linkD, both = A.on && B.on;
      g.strokeStyle = both ? rgba(rgb, 0.28 * f) : "rgba(150,160,190," + (0.07 * f).toFixed(3) + ")";
      g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
      if (both && !reduced && Math.random() < dt * 0.05) pulses.push({ a: A, b: B, u: 0 });
    }
    for (var m = pulses.length - 1; m >= 0; m--) {
      var P = pulses[m];
      P.u += dt * 0.7;
      if (P.u >= 1) { pulses.splice(m, 1); continue; }
      var px = P.a.x + (P.b.x - P.a.x) * P.u, py = P.a.y + (P.b.y - P.a.y) * P.u;
      g.fillStyle = rgba(rgb, 0.9 * Math.sin(P.u * Math.PI));
      g.beginPath(); g.arc(px, py, 1.6, 0, 6.283); g.fill();
    }
    for (var k2 = 0; k2 < nodes.length; k2++) {
      var n2 = nodes[k2], pulse = 0.75 + 0.25 * Math.sin(t * 1.3 + n2.ph);
      if (n2.on) {
        var gl = g.createRadialGradient(n2.x, n2.y, 0, n2.x, n2.y, n2.r * 7);
        gl.addColorStop(0, rgba(rgb, 0.35 * pulse)); gl.addColorStop(1, rgba(rgb, 0));
        g.fillStyle = gl; g.beginPath(); g.arc(n2.x, n2.y, n2.r * 7, 0, 6.283); g.fill();
        g.fillStyle = rgba(rgb, 0.85 * pulse);
      } else g.fillStyle = "rgba(170,180,210,0.22)";
      g.beginPath(); g.arc(n2.x, n2.y, n2.r, 0, 6.283); g.fill();
    }
    if (burst >= 0 && t - burst > 3) burst = -1;
    if (!reduced) schedule();
  }
  function schedule() {
    if (raf || document.hidden) return;
    raf = requestAnimationFrame(function (now) {
      if (now - last < 32) { raf = 0; return schedule(); }   // ~30 fps is plenty for drift
      frame(now);
    });
  }
  function redraw() { if (reduced) { raf = 0; frame(performance.now()); } else schedule(); }

  // Reading progress lights the constellation; finishing the page sets it all off.
  function chapterFraction() {
    var ticks = document.querySelectorAll(".be-sec[data-lesson]");
    if (!ticks.length || !window.BB) return 0;
    var done = 0;
    ticks.forEach(function (x) { if (BB.isDone(x.getAttribute("data-lesson"))) done++; });
    return done / ticks.length;
  }
  var art = document.querySelector("article.lesson"), lessonId = art && art.getAttribute("data-lesson-id");
  function complete() { return lessonId ? !!(window.BB && BB.isDone(lessonId)) : chapterFraction() >= 1; }
  function update() {
    litTarget = complete() ? 1 : Math.max(readProgress(), chapterFraction());
    if (reduced) redraw();
  }
  var wasComplete = complete();
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", function () { setup(); redraw(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { last = performance.now(); schedule(); } });
  if (window.BB && BB.on) BB.on(function (w) {
    if (w !== "progress") return;
    update();
    var now = complete();
    if (now && !wasComplete) burst = (performance.now() - t0) / 1000;   // just finished: light it all up
    wasComplete = now;
  });
  setup(); update(); lit = litTarget; redraw();
})();
