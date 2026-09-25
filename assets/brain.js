/* BLACKBOX brain — a dependency-free 3D neural map rendered on <canvas>.
   Neurons are laid out on an anatomical brain surface (two folded hemispheres, cerebellum,
   brain stem) and split into regions, nearest anchor wins. At the top level the regions are
   lobes (DevOps, DSA, System Design, …); setLevel() swaps in any other set of regions — a
   lobe's topics, a topic's subtopics, single problems — with a zoom-through transition, so
   you "go inside" the brain. Progress lights neurons outward from each region's anchor, and
   the whole brain grows as more of it is wired. Always drawn on a dark screen. */
(function () {
  "use strict";
  var BB = window.BB;
  if (!BB) return;

  function rng(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function rgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgba(hex, a) { var c = rgb(hex); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

  // ── geometry (built once, shared) ──────────────────────────────
  var GEO = null;
  function geometry() {
    if (GEO) return GEO;
    var r = rng(20260924), N = 2300, P = [];
    function surf() { return 1 - Math.pow(r(), 4) * 0.34; }           // mostly on the cortex surface
    // Cerebrum: two folded hemispheres with a medial fissure, frontal/occipital/temporal lobes.
    while (P.length < N * 0.8) {
      var u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      var dx = s * Math.cos(th), dy = u, dz = s * Math.sin(th);
      var side = dx < 0 ? -1 : 1;
      var x = side * (0.05 + Math.abs(dx) * 0.66), y = dy * 0.58, z = dz * 0.96;
      x *= 0.78 + 0.22 * (dz + 1) / 2;                                   // occipital narrower than frontal
      if (dz > 0.2) y += 0.05 * dz;                                      // taller frontal lobe
      if (dy < 0.1 && dz > -0.4 && dz < 0.55 && Math.abs(dx) > 0.45) {   // temporal lobe bulge
        y -= 0.08 * (1 - Math.abs(dz - 0.07)); x *= 1.05;
      }
      if (y < -0.2) y = -0.2 + (y + 0.2) * 0.5;                          // flat base
      var fold = Math.sin(9 * dx + 3 * Math.sin(6 * dz)) * Math.sin(8 * dz + 3 * Math.sin(7 * dy));
      var k = (1 + 0.045 * fold) * surf();
      P.push({ x: x * k, y: y * k + 0.05, z: z * k, part: 0 });
    }
    // Cerebellum with folia
    while (P.length < N * 0.93) {
      var u2 = r() * 2 - 1, th2 = r() * Math.PI * 2, s2 = Math.sqrt(1 - u2 * u2), d2 = 1 - Math.pow(r(), 3) * 0.3;
      var cz = s2 * Math.sin(th2), cx = s2 * Math.cos(th2);
      P.push({ x: cx * 0.44 * d2 * (1 + 0.06 * Math.cos(cx * 3.1)), y: -0.33 + u2 * 0.16 * d2 + 0.013 * Math.sin(cz * 70), z: -0.58 + cz * 0.24 * d2, part: 1 });
    }
    // Brain stem
    while (P.length < N) {
      var t = r(), a = r() * Math.PI * 2, rad = 0.075 * (1 - t * 0.35) * Math.sqrt(r());
      P.push({ x: Math.cos(a) * rad, y: -0.27 - t * 0.58, z: -0.22 - t * 0.12 + Math.sin(a) * rad, part: 2 });
    }
    P.forEach(function (p) { p.s = 0.7 + r() * 0.6; p.ph = r() * 6.283; });

    // Synapses: nearest neighbours (grid-bucketed so it stays fast with more neurons).
    var edges = [], seen = {}, adj = P.map(function () { return []; }), cell = 0.14, grid = {};
    function key(x, y, z) { return Math.floor(x / cell) + "," + Math.floor(y / cell) + "," + Math.floor(z / cell); }
    P.forEach(function (p, i) { var k = key(p.x, p.y, p.z); (grid[k] = grid[k] || []).push(i); });
    P.forEach(function (p, i) {
      var near = [], gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell), gz = Math.floor(p.z / cell);
      for (var ax = -1; ax <= 1; ax++) for (var ay = -1; ay <= 1; ay++) for (var az = -1; az <= 1; az++) {
        (grid[(gx + ax) + "," + (gy + ay) + "," + (gz + az)] || []).forEach(function (j) {
          if (j === i) return;
          var q = P[j], dd = (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y) + (p.z - q.z) * (p.z - q.z);
          if (dd < 0.018) near.push([dd, j]);
        });
      }
      near.sort(function (a, b) { return a[0] - b[0]; });
      near.slice(0, 3).forEach(function (nb) {
        var a = Math.min(i, nb[1]), b = Math.max(i, nb[1]), k = a * 8192 + b;
        if (seen[k]) return;
        seen[k] = 1; adj[a].push(edges.length); adj[b].push(edges.length); edges.push([a, b]);
      });
    });
    GEO = { nodes: P, edges: edges, adj: adj };
    return GEO;
  }

  // Spread n anchors over the cortex (farthest-point sampling, deterministic) for levels
  // whose regions don't name their own anchor.
  var anchorCache = {};
  function autoAnchors(n) {
    if (anchorCache[n]) return anchorCache[n];
    var P = geometry().nodes, pool = [], out = [], best = 0, bd = 1e9, i;
    for (i = 0; i < P.length; i += 3) if (P[i].part === 0) pool.push(P[i]);
    pool.forEach(function (p, j) { var d = (p.x + 0.2) * (p.x + 0.2) + (p.y - 0.6) * (p.y - 0.6) + (p.z - 0.9) * (p.z - 0.9); if (d < bd) { bd = d; best = j; } });
    var dist = pool.map(function () { return 1e9; });
    while (out.length < n) {
      var p = pool[best];
      out.push([p.x, p.y, p.z]);
      var far = -1;
      pool.forEach(function (q, j) {
        var d = (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y) + (q.z - p.z) * (q.z - p.z);
        if (d < dist[j]) dist[j] = d;
        if (dist[j] > far) { far = dist[j]; best = j; }
      });
    }
    // Order anchors front-left → back-right so neighbouring siblings sit side by side.
    out.sort(function (a, b) { return (b[2] - a[2]) * 2 + (a[0] - b[0]) || 0; });
    return (anchorCache[n] = out);
  }

  // Assign every neuron to its nearest region anchor, ranked by distance so progress spreads outward.
  function assign(regions) {
    var P = geometry().nodes, anchors = regions.some(function (d) { return !d.anchor; }) ? autoAnchors(regions.length) : null;
    var byId = {}, ranks = new Int32Array(P.length), owner = new Int32Array(P.length), dist = new Float32Array(P.length);
    regions.forEach(function (d) { byId[d.id] = []; });
    P.forEach(function (p, i) {
      var best = 0, bd = 1e9;
      regions.forEach(function (d, j) {
        var an = anchors ? anchors[j] : d.anchor, dd = (p.x - an[0]) * (p.x - an[0]) + (p.y - an[1]) * (p.y - an[1]) + (p.z - an[2]) * (p.z - an[2]);
        if (dd < bd) { bd = dd; best = j; }
      });
      owner[i] = best; dist[i] = bd;
      byId[regions[best].id].push(i);
    });
    var centroid = {};
    Object.keys(byId).forEach(function (id) {
      byId[id].sort(function (a, b) { return dist[a] - dist[b]; });
      var cx = 0, cy = 0, cz = 0;
      byId[id].forEach(function (idx, rank) { ranks[idx] = rank; cx += P[idx].x; cy += P[idx].y; cz += P[idx].z; });
      var n = Math.max(1, byId[id].length);
      centroid[id] = [cx / n, cy / n, cz / n];
    });
    return { regions: byId, owner: owner, rank: ranks, centroid: centroid };
  }

  function sprite(hex) {
    var c = document.createElement("canvas");
    c.width = c.height = 64;
    var g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.1, rgba(hex, 1));
    gr.addColorStop(0.32, rgba(hex, 0.42));
    gr.addColorStop(1, rgba(hex, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return c;
  }

  // Small round dot (soft edge) for dormant neurons — smoother than fillRect squares.
  function dot(hex) {
    var c = document.createElement("canvas");
    c.width = c.height = 16;
    var g = c.getContext("2d"), gr = g.createRadialGradient(8, 8, 0, 8, 8, 8);
    gr.addColorStop(0, rgba(hex, 1)); gr.addColorStop(0.55, rgba(hex, 0.9)); gr.addColorStop(1, rgba(hex, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 16, 16);
    return c;
  }

  // ── renderer ───────────────────────────────────────────────────
  function Brain(canvas, opts) {
    opts = opts || {};
    var G = geometry();
    var domains = [], A = null;                                         // current level's regions + assignment
    var nodes = G.nodes.map(function (n) {
      return { x: n.x, y: n.y, z: n.z, d: 0, rank: 0, s: n.s, ph: n.ph, g: 0, t: 0, wait: 0, flash: 0, dead: 0, grow: false, tw: 0 };
    });
    var ctx = canvas.getContext("2d");
    var W = 0, H = 0, DPR = 1;
    var yaw = opts.yaw != null ? opts.yaw : 0.7, pitch = -0.2, zoom = opts.zoom || 1;
    var tiltX = 0, tiltY = 0, aimX = 0, aimY = 0;                      // cursor parallax
    var dragging = false, moved = 0, lastX = 0, lastY = 0, vel = 0, idleUntil = 0;
    var highlight = null, first = true, running = false, visible = true, raf = 0, last = 0, hl = {};
    var sprites = [], dots = [];
    var spriteWhite = sprite("#dfe7ff"), spriteRed = sprite("#ff4d5e");
    var pulses = [], ghosts = [];
    var PX = new Float32Array(nodes.length), PY = new Float32Array(nodes.length), PZ = new Float32Array(nodes.length);
    var stats = { neurons: 0, total: nodes.length, synapses: 0, regions: 0, byRegion: {} };
    var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    var growth = 0.84, growthAim = 0.84;                                // the brain physically grows as it's wired
    var tr = null;                                                      // level transition in flight
    var links = [], linkT = 0;                                          // connection arcs between regions

    function useRegions(list) {
      domains = list;
      A = assign(list);
      nodes.forEach(function (n, i) { n.d = A.owner[i]; n.rank = A.rank[i]; });
      sprites = list.map(function (d) { return sprite(d.color); });
      dots = list.map(function (d) { return dot(d.color); });
      hl = {}; list.forEach(function (d) { hl[d.id] = 0; });
      highlight = null; pulses = [];
    }
    useRegions(opts.regions || BB.DATA.domains);

    function resize() {
      DPR = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, Math.round(canvas.clientWidth * DPR));
      H = Math.max(1, Math.round(canvas.clientHeight * DPR));
      canvas.width = W; canvas.height = H;
    }

    // st: {regionId: {total, done, focusMin, pendingMin, soon}}. Lessons wire up to 75% of a
    // region and focus minutes the rest; o.full lets lessons wire all of it (inner levels).
    function setState(st, o) {
      o = o || {};
      var fresh = 0, litTotal = 0, regionsOn = 0, lessonShare = o.full ? 1 : 0.75;
      stats.byRegion = {};
      domains.forEach(function (d) {
        var region = A.regions[d.id], size = region.length, s = st[d.id] || {};
        var seed = s.soon || o.full ? 0 : 1;
        var lessonPart = s.total ? Math.round(size * lessonShare * Math.min(1, s.done / s.total)) : 0;
        var focusPart = o.full ? 0 : Math.min(Math.floor(size * 0.25), Math.floor((s.focusMin || 0) / 2));
        var lit = Math.min(size, seed + lessonPart + focusPart);
        var pend = Math.min(size - lit, Math.floor((s.pendingMin || 0) / 2));
        if (lit + pend > seed) regionsOn++;
        stats.byRegion[d.id] = { lit: lit + pend, size: size };
        litTotal += lit + pend;
        region.forEach(function (idx, rank) {
          var n = nodes[idx], want = rank < lit ? 1 : rank < lit + pend ? 2 : 0;
          if (want && !n.t) { n.t = 1; n.wait = first ? Math.random() * 1.6 : Math.min(o.quick ? 0.6 : 2.5, (fresh++) * (o.quick ? 0.004 : 0.12)); }
          else if (!want && n.t) { n.t = 0; if (n.grow && o.wither) n.dead = 1; }
          n.grow = want === 2;
        });
      });
      first = false;
      stats.neurons = litTotal;
      stats.regions = regionsOn;
      growthAim = 0.84 + 0.16 * Math.sqrt(litTotal / nodes.length);
      var syn = 0;
      G.edges.forEach(function (e) { if (nodes[e[0]].t && nodes[e[1]].t) syn++; });
      stats.synapses = syn;
      if (opts.onStats) opts.onStats(stats);
    }

    // Swap to another set of regions. dir "in" flies into `from` (a region id of the current
    // level); "out" pulls back. o.ready() is called at the swap so the caller can setState.
    function setLevel(list, o) {
      o = o || {};
      if (reduced || !o.dir) { useRegions(list); nodes.forEach(function (n) { n.g = n.t = 0; n.grow = false; }); first = true; if (o.ready) o.ready(); return; }
      var focus = [0, 0, 0];
      if (o.from && A.centroid[o.from]) focus = A.centroid[o.from];
      tr = { phase: "out", t: 0, dir: o.dir, focus: focus, list: list, ready: o.ready };
      schedule();
    }

    function spawnPulse() {
      for (var tries = 0; tries < 12; tries++) {
        var e = (Math.random() * G.edges.length) | 0, ed = G.edges[e];
        if (nodes[ed[0]].g > 0.6 && nodes[ed[1]].g > 0.6) {
          pulses.push({ e: e, dir: Math.random() < 0.5, t: 0, v: 1 + Math.random() * 1.6, hops: 0, trail: [] });
          return;
        }
      }
    }
    function walk(pu, list, i, litOnly, maxHops) {
      var E = G.edges, ed = E[pu.e], at = pu.dir ? ed[1] : ed[0], opts2 = [];
      G.adj[at].forEach(function (ei) {
        if (ei === pu.e) return;
        if (!litOnly || (nodes[E[ei][0]].g > 0.6 && nodes[E[ei][1]].g > 0.6)) opts2.push(ei);
      });
      if (!opts2.length || ++pu.hops > maxHops) { list.splice(i, 1); return false; }
      pu.e = opts2[(Math.random() * opts2.length) | 0];
      pu.dir = E[pu.e][0] === at; pu.t = 0;
      return true;
    }

    function frame(now) {
      raf = 0;
      if (!running) return;
      var raw = last ? (now - last) / 1000 : 0.016, dt = Math.min(0.05, raw), adt = Math.min(0.5, raw), t = now / 1000;
      last = now;
      if (!dragging) {
        if (now > idleUntil && !reduced) yaw += dt * (opts.speed || 0.12);
        yaw += vel; vel *= 0.93;
      }
      tiltX += (aimX - tiltX) * Math.min(1, dt * 3);
      tiltY += (aimY - tiltY) * Math.min(1, dt * 3);
      growth += (growthAim - growth) * Math.min(1, adt * 1.5);
      domains.forEach(function (d) { hl[d.id] += ((highlight === d.id ? 1 : 0) - hl[d.id]) * Math.min(1, dt * 6); });

      // level transition: fly into (or back out of) the brain, swap regions at the midpoint
      var trZoom = 1, trShift = 0, trAlpha = 1;
      if (tr) {
        tr.t += adt / (tr.phase === "out" ? 0.55 : 0.7);
        var k = Math.min(1, tr.t), ease = k * k * (3 - 2 * k);
        if (tr.phase === "out") {
          trZoom = tr.dir === "in" ? 1 + ease * 3.4 : 1 - ease * 0.55; trShift = tr.dir === "in" ? ease : 0; trAlpha = 1 - ease;
          if (k >= 1 && tr.keep) { var cbk = tr.ready; tr = null; if (cbk) cbk(); canvas.style.opacity = "0"; }
          else if (k >= 1) {
            useRegions(tr.list);
            nodes.forEach(function (n) { n.g = n.t = 0; n.grow = false; n.flash = 0; n.dead = 0; });
            first = true;
            if (tr.ready) tr.ready();
            tr = { phase: "in", t: 0, dir: tr.dir, focus: tr.focus }; trShift = 0;
          }
        } else {
          trZoom = tr.dir === "in" ? 0.45 + 0.55 * ease : 1.9 - 0.9 * ease; trAlpha = ease;
          if (k >= 1) tr = null;
        }
      }
      canvas.style.opacity = trAlpha < 1 ? trAlpha.toFixed(3) : "";

      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.wait > 0) { n.wait -= adt; continue; }                   // state animations use real time,
        var prev = n.g;                                                   // so they finish even at low fps
        n.g += (n.t - n.g) * Math.min(1, adt * 3.2);
        if (prev < 0.5 && n.g >= 0.5 && n.t) n.flash = 1;
        if (n.flash > 0) n.flash = Math.max(0, n.flash - adt * 1.4);
        if (n.dead > 0) n.dead = Math.max(0, n.dead - adt * 0.45);
        if (n.tw > 0) n.tw = Math.max(0, n.tw - adt * 1.6);
      }
      if (!reduced && Math.random() < 0.6) nodes[(Math.random() * nodes.length) | 0].tw = 1;

      // project (with breathing + cursor parallax)
      var Y = yaw + tiltX * 0.35, X = pitch + tiltY * 0.25;
      var cyw = Math.cos(Y), syw = Math.sin(Y), cp = Math.cos(X), sp = Math.sin(X);
      var breathe = reduced ? 1 : 1 + 0.012 * Math.sin(t * 0.9);
      // fit the brain's real extents (≈1.9 long × 1.5 tall incl. stem) in both directions
      var scale = Math.min(W * 0.45, H * 0.56) * zoom * (opts.fill || 1) * breathe * growth * trZoom, D = 3.2;
      var cx = W / 2, cy = H / 2 - 0.1 * scale / trZoom + (opts.offsetY || 0) * H;
      if (trShift && tr) {                                               // steer toward the region we're entering
        var f0 = tr.focus, fx = f0[0] * cyw + f0[2] * syw, fz = -f0[0] * syw + f0[2] * cyw, fy = f0[1] * cp - fz * sp;
        cx -= fx * scale * trShift; cy += fy * scale * trShift;
      }
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        var x1 = n.x * cyw + n.z * syw, z1 = -n.x * syw + n.z * cyw;
        var y1 = n.y * cp - z1 * sp, z2 = n.y * sp + z1 * cp, f = D / (D - z2);
        PX[i] = cx + x1 * scale * f; PY[i] = cy - y1 * scale * f; PZ[i] = (z2 + 1) / 2;
      }

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;

      // volumetric halo behind the brain, tinted by how wired it is
      var wired = stats.neurons / stats.total, hr = scale * 1.25;
      var halo = ctx.createRadialGradient(cx, cy, hr * 0.1, cx, cy, hr);
      halo.addColorStop(0, "rgba(91,140,255," + (0.07 + wired * 0.25) + ")");
      halo.addColorStop(0.45, "rgba(160,107,255," + (0.04 + wired * 0.12) + ")");
      halo.addColorStop(1, "rgba(5,6,10,0)");
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.ellipse(cx, cy, hr * 1.1, hr * 0.85, 0, 0, 6.2832); ctx.fill();

      // dormant wiring in 3 depth layers (far → near)
      var E = G.edges, e, a, b;
      ctx.lineWidth = 0.65 * DPR;
      [[0, 0.4, 0.025], [0.4, 0.65, 0.05], [0.65, 1.01, 0.085]].forEach(function (band) {
        ctx.strokeStyle = "rgba(150,170,255," + band[2] + ")";
        ctx.beginPath();
        for (e = 0; e < E.length; e++) {
          a = E[e][0]; b = E[e][1];
          if (nodes[a].g > 0.3 && nodes[b].g > 0.3) continue;
          var dz = (PZ[a] + PZ[b]) / 2;
          if (dz < band[0] || dz >= band[1]) continue;
          ctx.moveTo(PX[a], PY[a]); ctx.lineTo(PX[b], PY[b]);
        }
        ctx.stroke();
      });

      // live synapses per region, back then front
      ctx.globalCompositeOperation = "lighter";
      for (var di = 0; di < domains.length; di++) {
        var dim = highlight && domains[di].id !== highlight, boost = hl[domains[di].id];
        for (var layer = 0; layer < 2; layer++) {
          ctx.strokeStyle = rgba(domains[di].color, (dim ? 0.07 : (layer ? 0.62 : 0.3)) + boost * 0.25);
          ctx.lineWidth = (layer ? 1.35 : 0.9) * DPR;
          ctx.beginPath();
          var any = false;
          for (e = 0; e < E.length; e++) {
            a = E[e][0]; b = E[e][1];
            if (nodes[a].d !== di || nodes[a].g < 0.3 || nodes[b].g < 0.3) continue;
            if (((PZ[a] + PZ[b]) / 2 >= 0.5) !== !!layer) continue;
            ctx.moveTo(PX[a], PY[a]); ctx.lineTo(PX[b], PY[b]); any = true;
          }
          if (any) ctx.stroke();
        }
      }

      // neurons
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        var depth = 0.28 + 0.72 * PZ[i], dom = domains[n.d], h = hl[dom.id];
        var dimmed = highlight && dom.id !== highlight ? 0.25 : 1;
        if (n.g < 0.05 && !n.dead) {
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = Math.min(1, (0.14 + 0.34 * depth + n.tw * 0.45 + h * 0.35) * (dom.soon ? 0.6 : 1) * dimmed);
          var ds = (1.5 + depth * 1.9) * n.s * DPR * (1 + h * 0.35);
          ctx.drawImage(dots[n.d], PX[i] - ds / 2, PY[i] - ds / 2, ds, ds);
          ctx.globalAlpha = 1;
          continue;
        }
        ctx.globalCompositeOperation = "lighter";
        if (n.dead > 0) {
          ctx.globalAlpha = n.dead * depth;
          var rs = 16 * DPR * (0.6 + 0.4 * depth);
          ctx.drawImage(spriteRed, PX[i] - rs / 2, PY[i] - rs / 2, rs, rs);
          ctx.globalAlpha = 1;
          continue;
        }
        var pulse = n.grow ? 0.75 + 0.25 * Math.sin(t * 4 + i) : 0.88 + 0.12 * Math.sin(t * 1.6 + n.ph);
        ctx.globalAlpha = Math.min(1, n.g * (0.4 + 0.6 * depth) * dimmed * pulse * (1 + h * 0.3));
        var sz = (15 + n.flash * 26 + h * 6) * n.s * DPR * (0.5 + 0.5 * depth) * (n.grow ? 1.3 : 1);
        ctx.drawImage(n.grow ? spriteWhite : sprites[n.d], PX[i] - sz / 2, PY[i] - sz / 2, sz, sz);
        ctx.globalAlpha = 1;
      }

      // signal pulses with comet trails along lit synapses
      var maxP = Math.min(130, Math.floor(stats.synapses / 2.2));
      if (!reduced && pulses.length < maxP && Math.random() < 0.7) spawnPulse();
      ctx.globalCompositeOperation = "lighter";
      for (var p = pulses.length - 1; p >= 0; p--) {
        var pu = pulses[p];
        pu.t += dt * pu.v;
        if (pu.t >= 1 && !walk(pu, pulses, p, true, 16)) continue;
        var ed = E[pu.e], from = pu.dir ? ed[0] : ed[1], to = pu.dir ? ed[1] : ed[0];
        var px = PX[from] + (PX[to] - PX[from]) * pu.t, py = PY[from] + (PY[to] - PY[from]) * pu.t;
        var pd = 0.3 + 0.7 * (PZ[from] + (PZ[to] - PZ[from]) * pu.t);
        var pdim = highlight && domains[nodes[from].d].id !== highlight ? 0.2 : 1;
        pu.trail.unshift([px, py]); if (pu.trail.length > 6) pu.trail.pop();
        for (var q = pu.trail.length - 1; q >= 0; q--) {
          ctx.globalAlpha = pd * pdim * (1 - q / pu.trail.length) * 0.9;
          var ps = (10 - q * 1.2) * DPR * pd;
          ctx.drawImage(q ? sprites[nodes[from].d] : spriteWhite, pu.trail[q][0] - ps / 2, pu.trail[q][1] - ps / 2, ps, ps);
        }
      }

      // spontaneous background activity so even an untrained brain feels alive
      if (!reduced) {
        while (ghosts.length < 30) ghosts.push({ e: (Math.random() * E.length) | 0, dir: Math.random() < 0.5, t: Math.random(), v: 0.5 + Math.random() * 0.9, hops: 0 });
        for (var gq = ghosts.length - 1; gq >= 0; gq--) {
          var gp = ghosts[gq];
          gp.t += dt * gp.v;
          if (gp.t >= 1 && !walk(gp, ghosts, gq, false, 10)) continue;
          var ge = E[gp.e], ga = gp.dir ? ge[0] : ge[1], gb = gp.dir ? ge[1] : ge[0];
          var gx = PX[ga] + (PX[gb] - PX[ga]) * gp.t, gy = PY[ga] + (PY[gb] - PY[ga]) * gp.t;
          var gd = 0.3 + 0.7 * (PZ[ga] + (PZ[gb] - PZ[ga]) * gp.t);
          ctx.globalAlpha = gd * 0.5 * Math.max(0.05, Math.sin(Math.PI * Math.min(1, (gp.hops + gp.t) / 10)));
          var gs2 = 7 * DPR * gd;
          ctx.drawImage(sprites[nodes[ga].d], gx - gs2 / 2, gy - gs2 / 2, gs2, gs2);
        }
      }
      // connection arcs: bowed curves between region centres with signals running along them
      if (links.length && !tr) {
        linkT += dt;
        var P2 = function (c) {
          var x1 = c[0] * cyw + c[2] * syw, z1 = -c[0] * syw + c[2] * cyw, y1 = c[1] * cp - z1 * sp, z2 = c[1] * sp + z1 * cp, f = D / (D - z2);
          return [cx + x1 * scale * f, cy - y1 * scale * f];
        };
        ctx.globalCompositeOperation = "lighter";
        links.forEach(function (ln, li) {
          var ca = A.centroid[ln.a], cb = A.centroid[ln.b];
          if (!ca || !cb) return;
          var pa = P2(ca), pb = P2(cb), mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2;
          var dx = mx - cx, dy = my - cy, dl = Math.sqrt(dx * dx + dy * dy) || 1, bow = scale * 0.35;
          var qx = mx + dx / dl * bow, qy = my + dy / dl * bow - scale * 0.12;
          var appear = Math.min(1, linkT * 2.2 - li * 0.15);
          if (appear <= 0) return;
          var g = ctx.createLinearGradient(pa[0], pa[1], pb[0], pb[1]);
          g.addColorStop(0, rgba(ln.ca, 0.85 * appear)); g.addColorStop(1, rgba(ln.cb, 0.85 * appear));
          ctx.strokeStyle = g; ctx.lineWidth = (1.4 + ln.w * 2.2) * DPR;
          ctx.setLineDash([6 * DPR, 7 * DPR]); ctx.lineDashOffset = -linkT * 30 * DPR;
          ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.quadraticCurveTo(qx, qy, pb[0], pb[1]); ctx.stroke();
          ctx.setLineDash([]);
          for (var k2 = 0; k2 < 3; k2++) {                              // travelling signals
            var u = ((linkT * 0.35 + k2 / 3 + li * 0.13) % 1) * appear, iu = 1 - u;
            var px2 = iu * iu * pa[0] + 2 * iu * u * qx + u * u * pb[0], py2 = iu * iu * pa[1] + 2 * iu * u * qy + u * u * pb[1];
            ctx.globalAlpha = 0.9 * appear;
            var ss = 16 * DPR;
            ctx.drawImage(spriteWhite, px2 - ss / 2, py2 - ss / 2, ss, ss);
          }
          ctx.globalAlpha = appear;
          ctx.fillStyle = rgba(ln.cb, 1);
          ctx.beginPath(); ctx.arc(pb[0], pb[1], 4 * DPR, 0, 6.2832); ctx.fill();
          ctx.globalAlpha = 1;
          if (ln.label) {
            ctx.font = "600 " + Math.round(11 * DPR) + "px ui-sans-serif, system-ui, sans-serif";
            ctx.textAlign = "center"; ctx.globalCompositeOperation = "source-over";
            var lx = 0.25 * mx + 0.75 * qx, ly = 0.25 * my + 0.75 * qy, tw = ctx.measureText(ln.label).width + 14 * DPR;
            ctx.globalAlpha = appear;
            ctx.fillStyle = "rgba(8,10,16,.82)"; ctx.fillRect(lx - tw / 2, ly - 11 * DPR, tw, 20 * DPR);
            ctx.fillStyle = "#e8ecf6"; ctx.fillText(ln.label, lx, ly + 3 * DPR);
            ctx.globalAlpha = 1; ctx.globalCompositeOperation = "lighter";
          }
        });
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      schedule();
    }

    function schedule() { if (running && visible && !document.hidden && !raf) raf = requestAnimationFrame(frame); }
    function start() { running = true; last = 0; schedule(); }

    // ── interaction ──
    function nearest(clientX, clientY) {
      if (tr) return null;
      var rect = canvas.getBoundingClientRect(), mx = (clientX - rect.left) * DPR, my = (clientY - rect.top) * DPR;
      var best = -1, bd = (26 * DPR) * (26 * DPR);
      for (var i = 0; i < nodes.length; i++) {
        if (PZ[i] < 0.35) continue;
        var dx = PX[i] - mx, dy = PY[i] - my, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      return best < 0 ? null : domains[nodes[best].d];
    }
    if (opts.interactive) {
      canvas.addEventListener("pointerdown", function (e) {
        dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; vel = 0;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      });
      canvas.addEventListener("pointermove", function (e) {
        var rect = canvas.getBoundingClientRect();
        if (dragging) {
          var dx = e.clientX - lastX, dy = e.clientY - lastY;
          moved += Math.abs(dx) + Math.abs(dy);
          yaw += dx * 0.008; vel = dx * 0.0025;
          pitch = Math.max(-1, Math.min(0.7, pitch + dy * 0.006));
          lastX = e.clientX; lastY = e.clientY;
          idleUntil = performance.now() + 2500;
          return;
        }
        if (e.pointerType === "mouse") {
          aimX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
          aimY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
        }
        var d = nearest(e.clientX, e.clientY);
        canvas.style.cursor = d ? "pointer" : "grab";
        if (opts.onHover) opts.onHover(d, e.clientX - rect.left, e.clientY - rect.top);
      });
      canvas.addEventListener("pointerup", function (e) {
        dragging = false;
        if (moved < 6 && opts.onSelect) opts.onSelect(nearest(e.clientX, e.clientY));
      });
      canvas.addEventListener("dblclick", function (e) { if (opts.onEnter) opts.onEnter(nearest(e.clientX, e.clientY)); });
      canvas.addEventListener("pointerleave", function () { aimX = aimY = 0; if (!dragging && opts.onHover) opts.onHover(null); });
      if (opts.zoomable) canvas.addEventListener("wheel", function (e) {
        e.preventDefault();
        zoom = Math.max(0.6, Math.min(2.4, zoom * Math.exp(-e.deltaY * 0.0012)));
      }, { passive: false });
    }

    resize();
    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener("resize", resize);
    if ("IntersectionObserver" in window) new IntersectionObserver(function (en) { visible = en[0].isIntersecting; schedule(); }).observe(canvas);
    document.addEventListener("visibilitychange", schedule);
    start();

    return {
      setState: setState,
      setLevel: setLevel,
      // [{a, b, ca, cb, w, label}] — region ids, colours, weight 0..1, optional label; [] clears
      setLinks: function (list) { links = list || []; linkT = 0; },
      zoomTo: function (id, done) {                                    // fly into a region (used before leaving the brain)
        var c = A.centroid[id] || [0, 0, 0];
        tr = { phase: "out", t: 0, dir: "in", focus: c, list: domains, ready: done, keep: true };
      },
      busy: function () { return !!tr; },
      highlight: function (id) { highlight = id || null; },
      stats: function () { return stats; },
      regionSize: function (id) { return (A.regions[id] || []).length; }
    };
  }

  BB.Brain = Brain;
})();
