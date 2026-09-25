/* BLACKBOX worlds — what you find when you step inside a lobe of the brain.
   Each program is drawn as a galaxy: its topics are stars strung along a spiral arm (the order you
   learn them in, joined by a glowing path), and each topic's subtopics and single lessons/problems
   orbit it as smaller stars on dendrite-like branches. Stars light up as you learn them. Drag to pan,
   scroll or pinch to zoom, click a star to see its connections, double-click to fly into it. */
(function () {
  "use strict";
  var BB = window.BB;
  if (!BB) return;

  var GOLD = Math.PI * (3 - Math.sqrt(5));
  var PALETTE = ["#22d3ee", "#a78bfa", "#fbbf24", "#34d399", "#f472b6", "#5b8cff", "#fb923c", "#a3e635", "#38bdf8", "#ff6b81", "#2dd4bf", "#c084fc"];

  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgba(hex, a) { var c = rgb(hex); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ── model + layout ─────────────────────────────────────────────
  function build(tree, baseColor) {
    var nodes = [], byId = {};
    function make(src, parent, depth, color) {
      var leaf = Array.isArray(src);
      var n = { id: leaf ? src[0] : src.id, name: (leaf ? src[1] : src.n).replace(/^\d+ · /, ""), href: leaf ? src[2] : src.h, tag: leaf ? src[3] : "",
                leaf: leaf, parent: parent, depth: depth, kids: [], color: color, x: 0, y: 0, r: 0, cr: 0, total: 0, done: 0, idx: nodes.length,
                num: leaf ? "" : ((src.n || "").match(/^(\d+) · /) || [])[1] || "" };
      nodes.push(n); byId[n.id] = n;
      if (!leaf) (src.k || []).forEach(function (k, i) {
        n.kids.push(make(k, n, depth + 1, depth === 0 ? (k.c || PALETTE[i % PALETTE.length]) : color));
      });
      return n;
    }
    var root = make(tree, null, 0, baseColor);
    // sizes bottom-up: a node's radius grows with what it contains; cr is the radius of its whole cluster
    (function size(n) {
      if (n.leaf) { n.total = 1; n.r = 3.2; n.cr = 5; return; }
      n.kids.forEach(size);
      n.total = n.kids.reduce(function (s, k) { return s + k.total; }, 0) || 1;
      n.r = n.depth === 0 ? 26 : n.depth === 1 ? 9 + 2.4 * Math.sqrt(n.total) : 5 + 1.2 * Math.sqrt(n.total);
      if (n.depth === 0) return;
      // children in a sunflower (phyllotaxis) around the node, spaced by their own cluster size
      var sp = 0, cr = n.r;
      n.kids.forEach(function (k, i) {
        var a = i * GOLD, d = n.r + 8 + (k.leaf ? 7.5 : k.cr * 1.25) * Math.sqrt(i + 1) * (k.leaf ? 1 : 1.35);
        k.ox = Math.cos(a) * d; k.oy = Math.sin(a) * d;
        sp = Math.max(sp, d + k.cr);
      });
      n.cr = Math.max(cr, sp);
    })(root);
    // topics along an Archimedean spiral: consecutive topics touch-but-don't-overlap, arms stay apart
    var tops = root.kids, maxCr = tops.reduce(function (m, k) { return Math.max(m, k.cr); }, 30);
    var b = (maxCr * 2 + 26) / (2 * Math.PI), theta = 1.2, r0 = root.r + 30;
    tops.forEach(function (k, i) {
      if (i > 0) {
        var need = tops[i - 1].cr + k.cr + 18;
        for (var guard = 0; guard < 400; guard++) {                        // walk along the arm until there's room
          var rr = r0 + b * theta, px = Math.cos(theta) * rr, py = Math.sin(theta) * rr;
          if (Math.hypot(px - tops[i - 1].x, py - tops[i - 1].y) >= need) break;
          theta += 0.04;
        }
      } else theta = Math.max(theta, (k.cr + root.r + 20 - r0) / b);
      var R = r0 + b * theta;
      k.x = Math.cos(theta) * R; k.y = Math.sin(theta) * R;
    });
    (function place(n) {
      n.kids.forEach(function (k) { if (n.depth > 0) { k.x = n.x + k.ox; k.y = n.y + k.oy; } place(k); });
    })(root);
    var r = rng(7), stars = [];
    var ext = nodes.reduce(function (m, n) { return Math.max(m, Math.abs(n.x) + n.cr, Math.abs(n.y) + n.cr); }, 200);
    for (var i = 0; i < 420; i++) stars.push({ x: (r() * 2 - 1) * ext * 1.6, y: (r() * 2 - 1) * ext * 1.6, s: r() * 1.3 + 0.2, z: 0.2 + r() * 0.6, ph: r() * 6.28 });
    return { root: root, nodes: nodes, byId: byId, stars: stars, ext: ext };
  }

  // ── renderer ───────────────────────────────────────────────────
  function World(canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext("2d"), W = 1, H = 1, DPR = 1;
    var M = null, cam = { x: 0, y: 0, k: 1 }, fly = null, hover = null, selected = null, focus = null, t0 = performance.now(), bloom = 0;
    var dragging = false, moved = 0, lx = 0, ly = 0, pointers = {}, pinch = null, running = false, raf = 0, lastT = 0, pulses = [];
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
        if (n.leaf) { var was = n.done; n.done = isDone(n.id) ? 1 : 0; if (n.done && !was && bloom >= 1) n.flash = 1; return n.done; }
        n.done = n.kids.reduce(function (s, k) { return s + tally(k); }, 0);
        return n.done;
      })(M.root);
    }
    function fitCam(n) {
      var R = n === M.root ? M.ext : Math.max(n.cr, 30) * 1.15;
      return { x: n === M.root ? 0 : n.x, y: n === M.root ? 0 : n.y, k: Math.min(W, H) / DPR / (2 * R) };
    }
    function flyTo(n, instant) {
      focus = n;
      var c = fitCam(n);
      if (instant || reduced) { cam = c; fly = null; }
      else fly = { from: { x: cam.x, y: cam.y, k: cam.k }, to: c, t: 0 };
      if (opts.onFocus) opts.onFocus(n);
      start();
    }
    function toScreen(x, y) { return [W / 2 + (x - cam.x) * cam.k * DPR, H / 2 + (y - cam.y) * cam.k * DPR]; }
    function toWorld(sx, sy) { return [cam.x + (sx * DPR - W / 2) / (cam.k * DPR), cam.y + (sy * DPR - H / 2) / (cam.k * DPR)]; }

    // What a node is connected to: its parent, children, and its neighbours on the learning path.
    function related(n) {
      var out = {};
      if (!n) return out;
      out[n.id] = 2;
      for (var p = n.parent; p; p = p.parent) out[p.id] = 1;
      n.kids.forEach(function (k) { out[k.id] = 1; k.kids.forEach(function (g) { out[g.id] = 1; }); });
      var sib = n.parent ? n.parent.kids : [], i = sib.indexOf(n);
      if (n.depth === 1) { if (sib[i - 1]) out[sib[i - 1].id] = 1; if (sib[i + 1]) out[sib[i + 1].id] = 1; }
      return out;
    }
    function frac(n) { return n.total ? n.done / n.total : 0; }

    function frame(now) {
      raf = 0;
      if (!running || !M) return;
      var dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0.016), t = (now - t0) / 1000;
      lastT = now;
      bloom = Math.min(1, bloom + dt * 1.1);
      if (fly) {
        fly.t = Math.min(1, fly.t + dt / 0.9);
        var e = fly.t < .5 ? 4 * fly.t * fly.t * fly.t : 1 - Math.pow(-2 * fly.t + 2, 3) / 2;
        var lk = Math.log(fly.from.k) + (Math.log(fly.to.k) - Math.log(fly.from.k)) * e;
        cam.x = fly.from.x + (fly.to.x - fly.from.x) * e; cam.y = fly.from.y + (fly.to.y - fly.from.y) * e; cam.k = Math.exp(lk);
        if (fly.t >= 1) fly = null;
      }
      var hl = related(hover || selected), hasHl = !!(hover || selected), base = M.root.color;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // deep space: nebula tinted by the program's colour, parallax starfield
      var neb = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
      neb.addColorStop(0, rgba(base, 0.13 + 0.12 * frac(M.root))); neb.addColorStop(0.5, "rgba(80,60,160,0.06)"); neb.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = neb; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#cfd8ff";
      M.stars.forEach(function (s) {
        var px = W / 2 + (s.x - cam.x * s.z) * cam.k * s.z * DPR * 0.6, py = H / 2 + (s.y - cam.y * s.z) * cam.k * s.z * DPR * 0.6;
        px = ((px % W) + W) % W; py = ((py % H) + H) % H;
        ctx.globalAlpha = (0.25 + 0.35 * Math.sin(t * 0.8 + s.ph) * 0.5 + 0.2) * s.z;
        ctx.fillRect(px, py, s.s * DPR, s.s * DPR);
      });
      ctx.globalAlpha = 1;

      var k = cam.k * DPR;
      ctx.setTransform(k, 0, 0, k, W / 2 - cam.x * k, H / 2 - cam.y * k);
      var grow = function (n) { var d = Math.hypot(n.x, n.y) / (M.ext || 1); return Math.max(0, Math.min(1, (bloom * 1.6 - d * 0.7))); };

      // the learning path: topics joined in order along the spiral arm
      var tops = M.root.kids;
      ctx.lineCap = "round";
      for (var i = 0; i < tops.length; i++) {
        var a = i ? tops[i - 1] : M.root, b = tops[i], g = Math.min(grow(a), grow(b));
        if (g <= 0) continue;
        var lit = i === 0 || frac(a) >= 1, dim = hasHl && !(hl[a.id] && hl[b.id]);
        ctx.strokeStyle = lit ? rgba(b.color, dim ? 0.25 : 0.85) : rgba("#8fa0d8", dim ? 0.08 : 0.22);
        ctx.lineWidth = (lit ? 3 : 1.6) / cam.k * Math.min(1, cam.k * 1.6);
        ctx.setLineDash(lit ? [] : [5 / cam.k, 6 / cam.k]);
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx + (a.y - b.y) * 0.18, my - (a.x - b.x) * 0.18, a.x + (b.x - a.x) * g, a.y + (b.y - a.y) * g); ctx.stroke();
      }
      ctx.setLineDash([]);

      // dendrites: parent → child branches, lit where learning has reached
      M.nodes.forEach(function (n) {
        if (!n.parent || n.depth < 2) return;
        var p = n.parent, g = grow(n);
        if (g <= 0) return;
        var on = n.done > 0, dim = hasHl && !(hl[n.id] && hl[p.id]);
        ctx.strokeStyle = on ? rgba(n.color, dim ? 0.18 : 0.7) : rgba("#8fa0d8", dim ? 0.05 : 0.16);
        ctx.lineWidth = (on ? 1.4 : 0.8) / Math.max(0.6, cam.k);
        var mx = (p.x + n.x) / 2 + (n.y - p.y) * 0.12, my = (p.y + n.y) / 2 - (n.x - p.x) * 0.12;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.quadraticCurveTo(mx, my, p.x + (n.x - p.x) * g, p.y + (n.y - p.y) * g); ctx.stroke();
      });

      // signals travelling along lit branches and the path
      if (!reduced && bloom >= 1) {
        if (pulses.length < 60 && Math.random() < 0.5) {
          var cand = M.nodes[(Math.random() * M.nodes.length) | 0];
          if (cand.parent && cand.done > 0) pulses.push({ n: cand, u: 0, v: 0.6 + Math.random() * 0.8 });
        }
        ctx.globalCompositeOperation = "lighter";
        pulses = pulses.filter(function (pu) {
          pu.u += dt * pu.v;
          if (pu.u >= 1) return false;
          var p = pu.n.parent, n = pu.n, u = pu.u, iu = 1 - u;
          var qx = (p.x + n.x) / 2 + (n.y - p.y) * 0.12, qy = (p.y + n.y) / 2 - (n.x - p.x) * 0.12;
          var x = iu * iu * p.x + 2 * iu * u * qx + u * u * n.x, y = iu * iu * p.y + 2 * iu * u * qy + u * u * n.y;
          var rr = 3.2 / Math.max(0.5, cam.k);
          var gr = ctx.createRadialGradient(x, y, 0, x, y, rr);
          gr.addColorStop(0, "rgba(255,255,255,.95)"); gr.addColorStop(1, rgba(n.color, 0));
          ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, rr, 0, 6.2832); ctx.fill();
          return true;
        });
        ctx.globalCompositeOperation = "source-over";
      }

      // stars (nodes)
      var screenR = function (n) { return n.r * cam.k; };
      for (var j = M.nodes.length - 1; j >= 0; j--) {
        var n = M.nodes[j], g2 = grow(n);
        if (g2 <= 0) continue;
        var f = frac(n), rr2 = n.r * (0.4 + 0.6 * g2) * (n === selected ? 1.12 : 1), dim2 = hasHl && !hl[n.id];
        ctx.globalAlpha = dim2 ? 0.28 : 1;
        if (f > 0 || n.depth === 0) {                                          // glow
          ctx.globalCompositeOperation = "lighter";
          var gl = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, rr2 * (n.leaf ? 4.5 : 2.8));
          gl.addColorStop(0, rgba(n.color, 0.5 * Math.max(f, 0.35))); gl.addColorStop(1, rgba(n.color, 0));
          ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(n.x, n.y, rr2 * (n.leaf ? 4.5 : 2.8), 0, 6.2832); ctx.fill();
          ctx.globalCompositeOperation = "source-over";
        }
        if (n.leaf) {
          if (n.done) {
            ctx.fillStyle = rgba(n.color, 1); ctx.beginPath(); ctx.arc(n.x, n.y, rr2, 0, 6.2832); ctx.fill();
            ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.beginPath(); ctx.arc(n.x, n.y, rr2 * 0.45, 0, 6.2832); ctx.fill();
          } else {
            ctx.strokeStyle = rgba(n.color, 0.75); ctx.lineWidth = 1 / Math.max(0.7, cam.k);
            ctx.fillStyle = "rgba(10,12,20,.9)"; ctx.beginPath(); ctx.arc(n.x, n.y, rr2, 0, 6.2832); ctx.fill(); ctx.stroke();
          }
          if (n.flash) { n.flash = Math.max(0, n.flash - dt * 0.8); ctx.strokeStyle = rgba("#ffffff", n.flash); ctx.lineWidth = 2 / cam.k;
            ctx.beginPath(); ctx.arc(n.x, n.y, rr2 * (1 + (1 - n.flash) * 3), 0, 6.2832); ctx.stroke(); }
        } else {
          var core = ctx.createRadialGradient(n.x - rr2 * 0.3, n.y - rr2 * 0.3, rr2 * 0.1, n.x, n.y, rr2);
          core.addColorStop(0, rgba("#ffffff", 0.45 + 0.5 * f)); core.addColorStop(0.35, rgba(n.color, 0.5 + 0.5 * f)); core.addColorStop(1, rgba(n.color, 0.2 + 0.4 * f));
          ctx.fillStyle = core; ctx.beginPath(); ctx.arc(n.x, n.y, rr2, 0, 6.2832); ctx.fill();
          ctx.lineWidth = Math.max(1.2, rr2 * 0.16);                            // progress ring
          ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.beginPath(); ctx.arc(n.x, n.y, rr2 + ctx.lineWidth, 0, 6.2832); ctx.stroke();
          if (f > 0) { ctx.strokeStyle = rgba(n.color, 1); ctx.beginPath(); ctx.arc(n.x, n.y, rr2 + ctx.lineWidth, -Math.PI / 2, -Math.PI / 2 + f * 6.2832); ctx.stroke(); }
          if (n === selected || n === hover) {
            ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 1.5 / cam.k;
            ctx.beginPath(); ctx.arc(n.x, n.y, rr2 + ctx.lineWidth * 6 + 3 / cam.k, 0, 6.2832); ctx.stroke();
          }
        }
        if (n.leaf && (n === selected || n === hover)) {
          ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 1.5 / cam.k;
          ctx.beginPath(); ctx.arc(n.x, n.y, rr2 + 3 / cam.k, 0, 6.2832); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // labels, in screen space: most important first, and only where there's room (no overlaps)
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.textAlign = "center";
      var placed = (opts.reserve ? opts.reserve() : []).map(function (r) { return [r[0] * DPR, r[1] * DPR, r[2] * DPR, r[3] * DPR]; });
      var cands = M.nodes.filter(function (n) {
        var sr = screenR(n);
        return grow(n) >= 0.9 && (n.depth === 0 || n === hover || n === selected || (n.depth === 1 && sr > 4) || (!n.leaf && sr > 6) || (n.leaf && sr > 6.5));
      }).map(function (n) { return [n === hover || n === selected ? 0 : n.depth === 0 ? 1 : n.depth === 1 ? 2 : n.leaf ? 4 : 3, -n.r, n]; });
      cands.sort(function (x, y) { return x[0] - y[0] || x[1] - y[1]; });
      cands.forEach(function (c) {
        var n = c[2], sr = screenR(n), p = toScreen(n.x, n.y), big = n.depth <= 1 || c[0] === 0;
        var dim = hasHl && !hl[n.id], fs = (n.depth === 0 ? 15 : big ? 12.5 : 11) * DPR;
        ctx.font = (big ? "600 " : "500 ") + fs + "px ui-sans-serif, system-ui, -apple-system, sans-serif";
        var label = n.depth === 0 ? n.name : (n.num ? n.num + " · " : "") + n.name;
        if (label.length > 38) label = label.slice(0, 36) + "…";
        var y = p[1] + (sr + (n.leaf ? 6 : 12)) * DPR + fs * 0.8, w = ctx.measureText(label).width + 8 * DPR, h = fs * (n.leaf || n.depth === 0 ? 1.3 : 2.4);
        var box = [p[0] - w / 2, y - fs, w, h];
        if (c[0] !== 0 && placed.some(function (q) { return box[0] < q[0] + q[2] && box[0] + box[2] > q[0] && box[1] < q[1] + q[3] && box[1] + box[3] > q[1]; })) return;
        if (box[0] + box[2] < 0 || box[0] > W || box[1] > H || box[1] + box[3] < 0) return;
        placed.push(box);
        ctx.globalAlpha = dim ? 0.35 : 1;
        ctx.lineWidth = 4 * DPR; ctx.strokeStyle = "rgba(6,8,14,.85)"; ctx.strokeText(label, p[0], y);
        ctx.fillStyle = n.leaf ? (n.done ? "#e9fff6" : "#b7c0d6") : "#ffffff"; ctx.fillText(label, p[0], y);
        if (!n.leaf && n.depth > 0) {
          ctx.font = "500 " + (10 * DPR) + "px ui-monospace, monospace"; ctx.fillStyle = rgba(n.color, dim ? 0.4 : 0.95);
          ctx.fillText(n.done + "/" + n.total, p[0], y + 13 * DPR);
        }
      });
      ctx.globalAlpha = 1;
      schedule();
    }
    function schedule() { if (running && !raf && !document.hidden) raf = requestAnimationFrame(frame); }
    function start() { running = true; schedule(); }

    // ── interaction ──
    function pick(cx, cy) {
      if (!M) return null;
      var rect = canvas.getBoundingClientRect(), w = toWorld(cx - rect.left, cy - rect.top), best = null, bd = Infinity;
      M.nodes.forEach(function (n) {
        var d = Math.hypot(n.x - w[0], n.y - w[1]), reach = Math.max(n.r * 1.3, 9 / cam.k);
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
        cam.k = Math.max(0.08, Math.min(12, pinch.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d)); moved = 99; return;
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
    canvas.addEventListener("dblclick", function (e) {
      var n = pick(e.clientX, e.clientY);
      if (n && opts.onEnter) opts.onEnter(n);
    });
    canvas.addEventListener("wheel", function (e) {
      e.preventDefault(); fly = null;
      var rect = canvas.getBoundingClientRect(), before = toWorld(e.clientX - rect.left, e.clientY - rect.top);
      cam.k = Math.max(0.08, Math.min(12, cam.k * Math.exp(-e.deltaY * 0.0015)));
      var after = toWorld(e.clientX - rect.left, e.clientY - rect.top);
      cam.x += before[0] - after[0]; cam.y += before[1] - after[1];
    }, { passive: false });
    if ("ResizeObserver" in window) new ResizeObserver(function () { resize(); }).observe(canvas); else window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", schedule);
    resize();

    return {
      open: function (tree, color, focusId) {
        M = build(tree, color); selected = null; hover = null; pulses = []; bloom = reduced ? 1 : 0;
        refresh(); resize();
        flyTo(M.root, true);
        if (focusId && M.byId[focusId]) { var n = M.byId[focusId]; selected = n; flyTo(n, true); }
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
      zoom: function (f) { fly = { from: { x: cam.x, y: cam.y, k: cam.k }, to: { x: cam.x, y: cam.y, k: Math.max(0.08, Math.min(12, cam.k * f)) }, t: 0 }; }
    };
  }

  BB.World = World;
})();
