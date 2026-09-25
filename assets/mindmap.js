/* BLACKBOX skill map — any program's topics laid out as a prerequisite graph you can pan, zoom and
   expand. One instance per program: BB.SkillMap(rootElement, data). data = {nodes: [{slug, num, title,
   q, color, domain, href, groups: [{title, href, items: [[progressId, title, meta, href]]}]}], edges,
   words: {node, groups, items}}. */
(function () {
  "use strict";
  var BB = window.BB;
  if (!BB) return;
  var $ = BB.$, $$ = BB.$$, esc = BB.esc, ROOT = BB.ROOT;

  function SkillMap(root, M, name) {
  var layer = $("[data-mm-layer]", root), svg = $("[data-mm-edges]", root), panel = $("[data-mm-panel]", root);
  var WORD = M.words || { node: "Track", groups: "topics", items: "lessons" };
  M.tracks = M.nodes;
  M.tracks.forEach(function (t) { t.topics = t.groups; t.topics.forEach(function (g) { g.lessons = g.items; }); });
  layer.insertBefore(svg, layer.firstChild);

  var NW = 268, NH = 136, GX = 44, GY = 96, TOPIC_H = 40;
  var n = M.tracks.length, open = {}, view = { x: 0, y: 0, k: 1 }, pos = [], topicBoxes = {};
  (BB.load("bb-map-open-" + name, name === "devops" ? BB.load("bb-map-open", []) : []) || []).forEach(function (i) { open[i] = true; });

  // ── graph layering (longest path) + barycentric ordering ──
  var parents = M.tracks.map(function () { return []; });
  M.edges.forEach(function (e) { parents[e[1]].push(e[0]); });
  var lvl = M.tracks.map(function () { return 0; });
  for (var pass = 0; pass < n; pass++) M.edges.forEach(function (e) { lvl[e[1]] = Math.max(lvl[e[1]], lvl[e[0]] + 1); });
  var layers = [];
  lvl.forEach(function (l, i) { (layers[l] = layers[l] || []).push(i); });
  var order = {};
  layers.forEach(function (row, li) {
    if (li > 0) row.sort(function (a, b) {
      var ba = parents[a].reduce(function (s, p) { return s + order[p]; }, 0) / Math.max(1, parents[a].length);
      var bb = parents[b].reduce(function (s, p) { return s + order[p]; }, 0) / Math.max(1, parents[b].length);
      return ba - bb || a - b;
    });
    row.forEach(function (i, k) { order[i] = k - (row.length - 1) / 2; });
  });

  // ── progress ──
  function trackState() {
    var P = window.BB_PATH || [], next = null, st = [];
    M.tracks.forEach(function (t, i) {
      var total = 0, done = 0, firstOpen = null;
      t.topics.forEach(function (tp) {
        tp.lessons.forEach(function (l) {
          var id = l[0];
          total++;
          if (BB.isDone(id)) done++; else if (!firstOpen) firstOpen = id;
        });
      });
      st[i] = { done: done, total: total, open: firstOpen && hrefOf(t, firstOpen) };
      if (next === null && firstOpen) next = i;
    });
    st.current = next == null ? -1 : next;
    return st;
  }
  function hrefOf(t, id) {
    for (var a = 0; a < t.topics.length; a++) for (var b = 0; b < t.topics[a].lessons.length; b++) if (t.topics[a].lessons[b][0] === id) return t.topics[a].lessons[b][3];
    return t.href;
  }
  function topicProgress(t, tp) {
    var d = 0;
    tp.lessons.forEach(function (l) { if (BB.isDone(l[0])) d++; });
    return d;
  }

  // ── layout & render ──
  function layout() {
    var y = 0;
    pos = [];
    layers.forEach(function (row) {
      var extra = 0;
      row.forEach(function (i) {
        pos[i] = { x: order[i] * (NW + GX) - NW / 2, y: y };
        if (open[i]) extra = Math.max(extra, 18 + M.tracks[i].topics.length * TOPIC_H);
      });
      y += NH + extra + GY;
    });
  }
  function render() {
    layout();
    var st = trackState(), html = "";
    M.tracks.forEach(function (t, i) {
      var s = st[i], pct = s.total ? s.done / s.total : 0;
      var cls = s.done >= s.total ? "s-done" : i === st.current ? "s-cur" : s.done ? "s-start" : "s-new";
      html += '<div class="mm-node ' + cls + (open[i] ? " is-open" : "") + '" data-node="' + i + '" style="--c:' + t.color + ";transform:translate(" + pos[i].x + "px," + pos[i].y + 'px)" tabindex="0" role="button" aria-label="' + WORD.node + " " + t.num + ": " + esc(t.title) + '">' +
        '<div class="mm-kicker"><span>' + WORD.node + " " + t.num + '</span><span class="mm-state">' + (cls === "s-done" ? "completed" : cls === "s-cur" ? "you are here" : cls === "s-start" ? "started" : "") + "</span></div>" +
        "<h3>" + esc(t.title) + "</h3>" +
        (t.q ? '<p class="mm-q">“' + esc(t.q) + "”</p>" : '<p class="mm-q"></p>') +
        '<div class="mm-foot"><span>' + (t.topics.length > 1 ? t.topics.length + " " + WORD.groups : s.total + " " + WORD.items) + '</span><span class="mm-bar"><i style="width:' + (pct * 100).toFixed(1) + '%"></i></span><span>' + Math.round(pct * 100) + "%</span></div>" +
        '<button class="mm-plus" data-toggle="' + i + '" aria-label="' + (open[i] ? "Hide" : "Show") + ' topics" aria-expanded="' + !!open[i] + '">' + (open[i] ? "−" : "+") + "</button></div>";
      if (open[i]) {
        html += '<div class="mm-topics" style="--c:' + t.color + ";transform:translate(" + pos[i].x + "px," + (pos[i].y + NH + 18) + 'px)">' +
          t.topics.map(function (tp, j) {
            var d = topicProgress(t, tp), tot = tp.lessons.length;
            return '<button class="mm-topic' + (d >= tot ? " done" : d ? " started" : "") + '" data-topic="' + i + ":" + j + '"><span class="mm-ring" style="--p:' + (d / tot) + '"></span><span class="mm-tt">' +
              esc(tp.title) + '</span><span class="mm-tc">' + d + "/" + tot + "</span></button>";
          }).join("") + "</div>";
      }
    });
    layer.innerHTML = "";
    layer.appendChild(svg);
    layer.insertAdjacentHTML("beforeend", html);

    // edges
    var paths = "";
    M.edges.forEach(function (e) {
      var a = pos[e[0]], b = pos[e[1]], x1 = a.x + NW / 2, y1 = a.y + NH, x2 = b.x + NW / 2, y2 = b.y;
      if (open[e[0]]) y1 += 18 + M.tracks[e[0]].topics.length * TOPIC_H;
      var dy = Math.max(40, (y2 - y1) * 0.5);
      var d = "M" + x1 + "," + y1 + " C" + x1 + "," + (y1 + dy) + " " + x2 + "," + (y2 - dy) + " " + x2 + "," + y2;
      var fromDone = st[e[0]].done >= st[e[0]].total, intoCur = e[1] === st.current;
      paths += '<path d="' + d + '" class="mm-edge' + (fromDone ? " done" : "") + (intoCur ? " live" : "") + '" style="--c:' + M.tracks[e[0]].color + '"/>';
    });
    M.tracks.forEach(function (t, i) {
      if (!open[i]) return;
      var x = pos[i].x + NW / 2;
      paths += '<path d="M' + x + "," + (pos[i].y + NH) + " L" + x + "," + (pos[i].y + NH + 18) + '" class="mm-edge stub" style="--c:' + t.color + '"/>';
    });
    svg.innerHTML = paths;
  }

  // ── pan / zoom ──
  function apply() { layer.style.transform = "translate(" + view.x + "px," + view.y + "px) scale(" + view.k + ")"; }
  function bounds() {
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    pos.forEach(function (p, i) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x + NW); minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y + NH + (open[i] ? 18 + M.tracks[i].topics.length * TOPIC_H : 0));
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  function fit() {
    var b = bounds(), W = root.clientWidth, H = root.clientHeight, pad = 48;
    view.k = Math.max(0.25, Math.min(1, Math.min((W - pad * 2) / b.w, (H - pad * 2) / b.h)));
    view.x = (W - b.w * view.k) / 2 - b.x * view.k;
    view.y = pad - b.y * view.k;
    apply();
  }
  function centerOn(i, k) {
    var p = pos[i], W = root.clientWidth, H = root.clientHeight;
    view.k = k || Math.max(view.k, 0.85);
    view.x = W / 2 - (p.x + NW / 2) * view.k - (panel.hidden || W < 760 ? 0 : 190);
    view.y = H / 2.6 - (p.y + NH / 2) * view.k;
    apply();
  }
  function zoomAt(f, cx, cy) {
    var k = Math.max(0.25, Math.min(2.2, view.k * f));
    view.x = cx - (cx - view.x) * (k / view.k);
    view.y = cy - (cy - view.y) * (k / view.k);
    view.k = k; apply();
  }
  root.addEventListener("wheel", function (e) {
    if (e.target.closest(".mm-panel")) return;
    e.preventDefault();
    var r = root.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);   // pinch / ctrl+wheel
    else { view.x -= e.deltaX; view.y -= e.deltaY; apply(); }                                              // two-finger scroll pans
  }, { passive: false });

  var pointers = {}, drag = null, moved = 0, pinch = null;
  root.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".mm-panel, .mm-tools, .mm-plus")) return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pointers);
    if (ids.length === 1) { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; moved = 0; }
    else if (ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
    }
  });
  window.addEventListener("pointermove", function (e) {
    if (!pointers[e.pointerId]) return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pointers);
    if (pinch && ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]], r = root.getBoundingClientRect();
      zoomAt(pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d / view.k, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      moved = 99;
    } else if (drag) {
      moved = Math.max(moved, Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y));
      if (moved > 5) { root.classList.add("dragging"); view.x = drag.vx + e.clientX - drag.x; view.y = drag.vy + e.clientY - drag.y; apply(); }
    }
  });
  function endPointer(e) {
    delete pointers[e.pointerId];
    if (Object.keys(pointers).length < 2) pinch = null;
    if (!Object.keys(pointers).length) { drag = null; setTimeout(function () { root.classList.remove("dragging"); }, 0); }
  }
  window.addEventListener("pointerup", endPointer);
  window.addEventListener("pointercancel", endPointer);

  // ── clicks: expand, open panels ──
  root.addEventListener("click", function (e) {
    if (moved > 5) { moved = 0; return; }
    var tog = e.target.closest("[data-toggle]");
    if (tog) {
      var i = +tog.getAttribute("data-toggle");
      open[i] = !open[i];
      BB.save("bb-map-open-" + name, Object.keys(open).filter(function (k) { return open[k]; }).map(Number));
      render(); apply();
      return;
    }
    var tp = e.target.closest("[data-topic]");
    if (tp) { var p = tp.getAttribute("data-topic").split(":"); showTopic(+p[0], +p[1]); return; }
    var node = e.target.closest("[data-node]");
    if (node) { showTrack(+node.getAttribute("data-node")); return; }
    if (!e.target.closest(".mm-panel, .mm-tools")) closePanel();
  });
  root.addEventListener("keydown", function (e) {
    var node = e.target.closest && e.target.closest("[data-node]");
    if (node && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); showTrack(+node.getAttribute("data-node")); return; }
    if (e.target.closest && e.target.closest(".mm-panel")) return;
    var step = 60;
    if (e.key === "ArrowLeft") view.x += step; else if (e.key === "ArrowRight") view.x -= step;
    else if (e.key === "ArrowUp") view.y += step; else if (e.key === "ArrowDown") view.y -= step;
    else if (e.key === "+" || e.key === "=") return zoomAt(1.2, root.clientWidth / 2, root.clientHeight / 2);
    else if (e.key === "-") return zoomAt(1 / 1.2, root.clientWidth / 2, root.clientHeight / 2);
    else return;
    e.preventDefault(); apply();
  });
  $$("[data-mm]", root).forEach(function (b) {
    b.addEventListener("click", function () {
      var a = b.getAttribute("data-mm"), W = root.clientWidth, H = root.clientHeight;
      if (a === "in") zoomAt(1.25, W / 2, H / 2);
      else if (a === "out") zoomAt(0.8, W / 2, H / 2);
      else if (a === "fit") fit();
      else if (a === "here") { var st = trackState(); centerOn(st.current >= 0 ? st.current : 0, 0.95); }
    });
  });

  // ── side panel ──
  function closePanel() { panel.hidden = true; $$(".mm-node.is-selected").forEach(function (x) { x.classList.remove("is-selected"); }); }
  function select(i) { $$(".mm-node").forEach(function (x) { x.classList.toggle("is-selected", +x.getAttribute("data-node") === i); }); }
  function showTrack(i) {
    var t = M.tracks[i], s = trackState()[i], pct = s.total ? Math.round(s.done / s.total * 100) : 0;
    select(i);
    panel.hidden = false;
    panel.style.setProperty("--c", t.color);
    panel.innerHTML = '<div class="mp-head"><span class="mono-label">' + WORD.node + " " + t.num + (t.domain ? " · " + esc(t.domain) : "") + '</span><button class="icon-btn" data-close aria-label="Close">✕</button></div>' +
      "<h2>" + esc(t.title) + "</h2>" + (t.q ? '<p class="mp-q">“' + esc(t.q) + '”</p>' : "") +
      '<div class="mp-prog"><div class="progress-bar"><span style="--p:' + (pct / 100) + '"></span></div><span class="mono-label">' + s.done + "/" + s.total + " · " + pct + "%</span></div>" +
      '<div class="mp-actions"><a class="btn btn-primary sm" href="' + ROOT + (s.open || t.topics[0].lessons[0][3]) + '">' +
      (s.done >= s.total ? "Review" : s.done ? "Continue" : "Start") + '</a><a class="btn btn-ghost sm" href="' + ROOT + t.href + '">Open ' + WORD.node.toLowerCase() + ' page</a></div>' +
      '<p class="mono-label mp-sub">' + (t.topics.length > 1 ? WORD.groups : WORD.items) + '</p><ul class="mp-list">' + t.topics.map(function (tp, j) {
        var d = topicProgress(t, tp), tot = tp.lessons.length;
        return '<li><button data-topic="' + i + ":" + j + '" class="' + (d >= tot ? "done" : "") + '"><span class="mm-ring" style="--p:' + (d / tot) + '"></span><span>' + esc(tp.title) + "</span><em>" + d + "/" + tot + "</em></button></li>";
      }).join("") + "</ul>";
    wirePanel();
  }
  function showTopic(i, j) {
    var t = M.tracks[i], tp = t.topics[j], d = topicProgress(t, tp), tot = tp.lessons.length;
    select(i);
    panel.hidden = false;
    panel.style.setProperty("--c", t.color);
    panel.innerHTML = '<div class="mp-head"><button class="link-btn" data-back="' + i + '">← ' + WORD.node + " " + t.num + '</button><button class="icon-btn" data-close aria-label="Close">✕</button></div>' +
      (t.topics.length > 1 ? '<span class="mono-label">' + (j + 1) + " of " + t.topics.length + "</span>" : "") + "<h2>" + esc(tp.title || t.title) + "</h2>" +
      '<div class="mp-prog"><div class="progress-bar"><span style="--p:' + (d / tot) + '"></span></div><span class="mono-label">' + d + "/" + tot + " " + WORD.items + "</span></div>" +
      '<ol class="mp-lessons">' + tp.lessons.map(function (l, k) {
        var done = BB.isDone(l[0]);
        return '<li class="' + (done ? "done" : "") + '"><a href="' + ROOT + l[3] + '"><span class="lnum"><b>' + (k + 1) + '</b><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span><span>' +
          esc(l[1]) + "</span><em>" + esc(l[2] || "") + "</em></a></li>";
      }).join("") + "</ol>" +
      '<a class="btn btn-ghost sm" href="' + ROOT + (tp.href || t.href) + '">Open page</a>';
    wirePanel();
  }
  function wirePanel() {
    var c = $("[data-close]", panel); if (c) c.addEventListener("click", closePanel);
    var bk = $("[data-back]", panel); if (bk) bk.addEventListener("click", function () { showTrack(+bk.getAttribute("data-back")); });
    panel.scrollTop = 0;
  }

  // ── boot ──
  function resize() { apply(); }
  render();
  // Start readable: show the whole map only if the cards stay legible, otherwise centre on where you are.
  function startView() {
    fit();
    var s0 = trackState(), cur = Math.max(0, s0.current);
    if (root.clientWidth < 700) centerOn(cur, 0.78);
    else if (view.k < 0.62 || s0.current > 0) centerOn(cur, Math.max(0.85, view.k));
  }
  var fitted = !!root.clientWidth;
  if (fitted) startView();
  BB.on(function (w) { if (w === "progress") { render(); apply(); } });
  return { resize: function () { if (!root.clientWidth) return; if (!fitted) { fitted = true; startView(); } else apply(); } };
  }

  // One map per program on the Tracks page.
  BB.maps = {};
  var data = window.BB_MAPS || {};
  $$("[data-mindmap]").forEach(function (root) {
    var name = root.getAttribute("data-mindmap");
    if (data[name] && data[name].nodes.length) BB.maps[name] = SkillMap(root, data[name], name);
  });
  window.BB_MINDMAP = { resize: function () { Object.keys(BB.maps).forEach(function (k) { BB.maps[k].resize(); }); } };
})();
