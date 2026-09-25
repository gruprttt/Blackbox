/* BLACKBOX app views: home dashboard, brain explorer, focus timer, tasks, habits. */
(function () {
  "use strict";
  var BB = window.BB;
  if (!BB) return;
  var $ = BB.$, $$ = BB.$$, esc = BB.esc, PAGE = BB.PAGE, ROOT = BB.ROOT;
  var DATA = BB.DATA;

  var S = function (p, extra) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' + (extra || "") + ">" + p + "</svg>"; };
  var I = {
    sun: S('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    cal: S('<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 10h18"/>'),
    inbox: S('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>'),
    list: S('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    check: S('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 'stroke-width="3"'),
    done: S('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>'),
    trash: S('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
    play: S('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>', 'fill="currentColor" stroke="none"'),
    book: S('<path d="M4 19.5V5a2 2 0 0 1 2-2h14v15H6.5A2.5 2.5 0 0 0 4 20.5 2.5 2.5 0 0 0 6.5 23H20"/>'),
    focus: S('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2h5M12 2v3"/>'),
    spark: S('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
    flame: S('<path d="M12 3c1 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2-4.6.3 1.6 1 2.6 2 3.1C11 9 11.5 6 12 3z"/>', 'fill="currentColor" stroke="none"'),
    x: S('<path d="M6 6l12 12M18 6 6 18"/>'),
    brain: S('<path d="M9.5 3A2.5 2.5 0 0 0 7 5.5v.3A3 3 0 0 0 4.5 9a3 3 0 0 0 .6 1.8A3 3 0 0 0 4 13.5 3 3 0 0 0 6 16.3V17a3 3 0 0 0 5.5 1.7V4.4A2.5 2.5 0 0 0 9.5 3z"/><path d="M14.5 3A2.5 2.5 0 0 1 17 5.5v.3A3 3 0 0 1 19.5 9a3 3 0 0 1-.6 1.8 3 3 0 0 1 1.1 2.7 3 3 0 0 1-2 2.8V17a3 3 0 0 1-5.5 1.7"/>'),
    link: S('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
    tomato: S('<circle cx="12" cy="13" r="8"/><path d="M12 5V3M9 5.5 12 7l3-1.5"/>'),
    right: S('<path d="M5 12h14M13 6l6 6-6 6"/>')
  };

  function stat(label, value, sub, color, icon) {
    return '<div class="stat" style="--sc:' + color + '"><span class="mono-label">' + (icon || "") + label + "</span><b>" + value + "</b>" + (sub ? "<p>" + sub + "</p>" : "") + "</div>";
  }
  function todayFocusMin() {
    var k = BB.dayKey(), m = 0;
    BB.sessions().forEach(function (s) { if (s.status === "done" && BB.dayKey(s.start) === k) m += s.min; });
    var a = BB.focus.get();
    if (a && a.mode === "focus" && BB.dayKey(a.start) === k) m += BB.focus.elapsed(a) / 60000;
    return m;
  }
  function lessonsToday() {
    var k = BB.dayKey(), n = 0, m = BB.doneMap();
    Object.keys(m).forEach(function (id) { if (m[id] && BB.dayKey(m[id]) === k) n++; });
    return n;
  }
  function dueLabel(due) {
    if (!due) return "";
    var d = BB.diffDays(due, BB.dayKey());
    if (d === 0) return "Today"; if (d === 1) return "Tomorrow"; if (d === -1) return "Yesterday";
    if (d < 0) return Math.abs(d) + "d overdue";
    var dt = BB.parseDay(due);
    return d < 7 ? dt.toLocaleDateString(undefined, { weekday: "short" }) : dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // ── habits model (shared by home + habits page) ────────────────
  var HABIT_COLORS = ["#2dd4bf", "#a78bfa", "#fbbf24", "#f472b6", "#38bdf8", "#a3e635"];
  function habitDefs() {
    var act = BB.activity();
    var list = [
      { id: "auto-lesson", name: "Finish a lesson", desc: "Tracked automatically", color: "#5b8cff", icon: I.book, auto: true, on: function (k) { return (act[k] || {}).lessons > 0; } },
      { id: "auto-focus", name: "Focus for 25 minutes", desc: "Tracked automatically", color: "#ff4d5e", icon: I.focus, auto: true, on: function (k) { return (act[k] || {}).focus >= 25; } }
    ];
    BB.habits.all().forEach(function (h) {
      list.push({ id: h.id, name: h.name, desc: "Tap a day to check in", color: h.color, icon: I.spark, on: function (k) { return !!(h.checks || {})[k]; } });
    });
    return list;
  }
  function toggleHabit(id, k) {
    var all = BB.habits.all();
    all.forEach(function (h) { if (h.id === id) { h.checks = h.checks || {}; if (h.checks[k]) delete h.checks[k]; else h.checks[k] = true; } });
    BB.habits.saveAll(all);
  }

  // ── brain mounting helper ──────────────────────────────────────
  function mountBrain(canvas, opts) {
    if (!canvas || !BB.Brain) return null;
    opts.forceDark = true;
    var tip = canvas.parentNode.querySelector("[data-brain-tooltip]"), brain;
    if (tip && opts.interactive) {
      var userHover = opts.onHover;
      // Docked (never follows the cursor), so it can't cover the brain.
      var card = opts.tipMode === "card", screen = canvas.parentNode, shown = null;
      tip.className = "brain-tooltip docked " + (card ? "card" : "label");
      opts.onHover = function (d, x, y) {
        if (userHover) userHover(d, x, y);
        if (!d) {
          shown = null; tip.hidden = true; screen.classList.remove("hovering");
          brain.highlight(opts.selected ? opts.selected() : null);
          return;
        }
        brain.highlight(d.id);
        if (shown !== d.id) {
          shown = d.id;
          tip.style.setProperty("--c", d.color);
          tip.innerHTML = opts.tip ? opts.tip(d, brain) : card ? regionTip(d, brain) : '<i></i>' + esc(d.name) + (d.soon ? " <em>soon</em>" : "");
        }
        tip.hidden = false; screen.classList.add("hovering");
      };
    }
    brain = BB.Brain(canvas, opts);
    var refresh = function (o) {
      if (opts.state) { var x = opts.state(); brain.setState(x.st, Object.assign({ full: x.full }, o)); }
      else brain.setState(BB.brainState(), o);
    };
    refresh();
    var lastTick = 0;
    BB.on(function (w, detail) {
      if (w === "progress" || w === "focus") refresh();
      else if (w === "session") refresh({ wither: detail && detail.status === "failed" });
      else if (w === "tick" && BB.focus.get() && Date.now() - lastTick > 1000) { lastTick = Date.now(); refresh(); }
    });
    brain.refresh = refresh;
    return brain;
  }
  function regionTip(d, brain) {
    var r = (brain.stats().byRegion || {})[d.id] || { lit: 0, size: 1 }, st = BB.brainState()[d.id] || { done: 0, total: 0, focusMin: 0 };
    var pct = Math.round(r.lit / r.size * 100);
    return '<div class="bt-head"><i style="background:' + d.color + ";box-shadow:0 0 10px " + d.color + '"></i><b>' + esc(d.name) + "</b></div>" +
      (d.soon ? '<p class="bt-soon">Dormant lobe · coming soon</p>'
        : '<div class="bt-bar"><span style="width:' + pct + "%;background:" + d.color + '"></span></div>' +
          '<p class="bt-meta"><span>' + pct + "% wired</span><span>" + r.lit + " neurons</span><span>" + st.done + "/" + st.total + " learned</span></p>" +
          '<p class="bt-hint">Click to go inside</p>');
  }
  function paintStats(s) {
    $$('[data-stat="neurons"]').forEach(function (el) { el.textContent = s.neurons.toLocaleString(); });
    $$('[data-stat="synapses"]').forEach(function (el) { el.textContent = s.synapses.toLocaleString(); });
    $$('[data-stat="regions"]').forEach(function (el) { el.textContent = s.regions + " / " + (s.of != null ? s.of : DATA.domains.filter(function (d) { return !d.soon; }).length); });
  }


  // ── shared: path & health helpers (home + tracks page) ──
  function met(a) { return !!a && (a.lessons > 0 || a.focus >= 25); }

  function slo() {
    var act = BB.activity(), today = BB.dayKey(), keys = Object.keys(act).filter(function (k) { return met(act[k]) || act[k].lessons || act[k].focus; }).sort();
    var todayAct = act[today] || { lessons: 0, focus: 0 };
    todayAct = { lessons: todayAct.lessons, focus: todayFocusMin() };
    if (!keys.length && !met(todayAct)) return { state: "idle", label: "NO DATA" };
    var first = keys[0] || today, win = Math.min(30, BB.diffDays(today, first) + 1), missed = 0, hit = 0;
    for (var i = 1; i < win; i++) { if (met(act[BB.addDays(today, -i)])) hit++; else missed++; }
    var todayMet = met(todayAct);
    if (todayMet) hit++;
    var allowed = Math.max(1, Math.round(win * 0.2));
    var end = new Date(); end.setHours(24, 0, 0, 0);
    var left = Math.max(0, end - Date.now()) / 60000;
    return {
      state: todayMet ? "ok" : "warn", label: todayMet ? "HEALTHY" : "AT RISK",
      detail: todayMet ? "Today’s SLO met" : BB.fmtMin(left) + " left to meet today’s SLO",
      budget: Math.max(0, allowed - missed) / allowed, missed: missed, allowed: allowed,
      attain: Math.round(hit / Math.max(1, win - (todayMet ? 0 : 1)) * 100), win: win
    };
  }

  // Daily activity score (lessons + focus/25) for anything matching a predicate.
  function daily(days, lessonPred, sessionPred) {
    var today = BB.dayKey(), idx = {}, out = [], m = BB.doneMap();
    for (var i = days - 1; i >= 0; i--) { idx[BB.addDays(today, -i)] = out.length; out.push(0); }
    Object.keys(m).forEach(function (id) { if (!m[id] || !lessonPred(id)) return; var k = BB.dayKey(m[id]); if (k in idx) out[idx[k]] += 1; });
    if (sessionPred) BB.sessions().forEach(function (x) { if (x.status !== "done" || !sessionPred(x)) return; var k = BB.dayKey(x.start); if (k in idx) out[idx[k]] += x.min / 25; });
    return out;
  }

  function lastSeen(lessonPred, sessionPred) {
    var t = 0, m = BB.doneMap();
    Object.keys(m).forEach(function (id) { if (m[id] && lessonPred(id)) t = Math.max(t, m[id]); });
    if (sessionPred) BB.sessions().forEach(function (x) { if (x.status === "done" && sessionPred(x)) t = Math.max(t, x.start); });
    return t;
  }

  function health(t) {
    if (!t) return { s: "cold", label: "cold" };
    var age = BB.diffDays(BB.dayKey(), BB.dayKey(t));
    if (age <= 3) return { s: "ok", label: "healthy", age: age };
    if (age <= 14) return { s: "warn", label: "stale · " + age + "d", age: age };
    return { s: "cold", label: "cold · " + age + "d", age: age };
  }

  function line(vals, color, h) {
    h = h || 26;
    var w = 160, max = Math.max.apply(null, vals.concat([0.001])), flat = vals.every(function (v) { return !v; });
    var pts = vals.map(function (v, i) { return (i * w / (vals.length - 1)).toFixed(1) + "," + (flat ? h / 2 : h - 3 - v / max * (h - 6)).toFixed(1); }).join(" ");
    return '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="' + color +
      '" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"' + (flat ? ' stroke-dasharray="2 4" opacity=".5"' : "") + "/></svg>";
  }

  // Learning path: tracks in order; "next" is the first unfinished lesson walking the path.
  function paintPath() {
    var P = window.BB_PATH || [], next = null, current = null, info = {}, total = 0;
    P.forEach(function (row) {
      var slug = row[0], n = 0, firstOpen = null;
      row[1].forEach(function (r) { var id = slug + "/" + r; if (BB.isDone(id)) n++; else if (!firstOpen) firstOpen = id; });
      info[slug] = { n: n, total: row[1].length, open: firstOpen };
      total += n;
      if (!next && firstOpen) { next = firstOpen; current = slug; }
    });
    $$("[data-path-track]").forEach(function (li) {
      var slug = li.getAttribute("data-path-track"), x = info[slug];
      if (!x) return;
      var done = x.n >= x.total, isCur = slug === current;
      li.classList.toggle("done", done);
      li.classList.toggle("is-current", isCur);
      li.classList.toggle("started", x.n > 0 && !done);
      $("[data-path-state]", li).textContent = done ? "Completed" : isCur ? (x.n ? "In progress" : "Up next") : x.n ? "Started" : "";
      var cta = $("[data-path-cta]", li);
      cta.firstChild.nodeValue = (done ? "Review " : x.n ? "Continue " : "Start ");
      var card = $(".path-card", li);
      card.href = isCur && x.open ? ROOT + x.open + "/index.html" : ROOT + slug + "/index.html";
      var lp = function (id) { return id.indexOf(slug + "/") === 0; };
      var seen = lastSeen(lp), h = health(seen);
      $("[data-path-spark]", li).innerHTML = line(daily(14, lp), getComputedStyle(li).getPropertyValue("--c").trim() || "#5b8cff", 22);
      $("[data-path-seen]", li).textContent = done ? "shipped" : !seen ? "never active" : h.age === 0 ? "active today" : "active " + h.age + "d ago";
      $("[data-path-dot]", li).className = "path-dot s-" + (done ? "ok" : x.n ? h.s : "idle");
    });
    var ps = $("[data-path-status]");
    if (ps) {
      var pathTotal = DATA.pathTotal || 1;
      var l14 = daily(14, function () { return true; }).reduce(function (a, b) { return a + b; }, 0) / 14, left = pathTotal - total, o = slo();
      var cur = P.findIndex(function (r) { return r[0] === current; });
      ps.innerHTML =
        '<div><span>status</span><b class="s-' + o.state + '"><i></i>' + (total >= pathTotal ? "COMPLETE" : o.label) + "</b></div>" +
        "<div><span>completion</span><b>" + (total / pathTotal * 100).toFixed(1) + "%</b></div>" +
        "<div><span>current</span><b>" + (cur >= 0 ? "Track " + ("0" + (cur + 1)).slice(-2) : "—") + "</b></div>" +
        "<div><span>pace · 14d</span><b>" + l14.toFixed(1) + " /day</b></div>" +
        "<div><span>eta</span><b>" + (l14 > 0 ? new Date(Date.now() + left / l14 * 864e5).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—") + "</b></div>";
    }
    var btn = $("[data-path-next]");
    if (btn && next) {
      var num = ("0" + (P.findIndex(function (r) { return r[0] === current; }) + 1)).slice(-2);
      btn.href = ROOT + next + "/index.html";
      $("[data-continue-label]", btn).textContent = total ? "Continue · Track " + num : "Start with Track 01";
    }
  }

  // ═════════════════════════════ HOME ═════════════════════════════
  function home() {
    var brain = mountBrain($('[data-brain="hero"]'), { interactive: true, fill: 0.92,
      onSelect: function (d) { if (d) location.href = ROOT + "brain/index.html#" + d.id; }, onStats: function (s) {
      paintStats(s);
      var cap = $("[data-brain-caption]");
      if (cap) {
        var pct = Math.round(s.neurons / s.total * 100);
        cap.textContent = s.neurons <= DATA.domains.length ? "Idle cortex · finish a lesson or a focus session to wire your first neurons." : pct + "% of your brain is wired — keep going.";
      }
      if (typeof renderRegions === "function" && document.querySelector("[data-region-health]") && document.querySelector("[data-region-health]").children.length) { renderRegions(); renderHeroFoot(); }
    } });

    function renderStats() {
      var streak = BB.learningStreak(), done = Object.keys(BB.doneMap()).length, today = lessonsToday();
      var fm = todayFocusMin(), sessionsToday = BB.sessions().filter(function (s) { return s.status === "done" && BB.dayKey(s.start) === BB.dayKey(); }).length;
      var s = brain ? brain.stats() : { neurons: 0, total: 1 };
      var el = $("[data-home-stats]");
      if (!el) return;
      el.innerHTML =
        stat("Focus today", BB.fmtMin(fm), sessionsToday + " session" + (sessionsToday === 1 ? "" : "s"), "var(--red)", I.focus) +
        stat("Streak", streak.current + "<small>days</small>", "Best " + streak.best, "#fbbf24", I.flame) +
        stat("Learned", done + "<small>/ " + DATA.total.toLocaleString() + "</small>", "+" + today + " today", "var(--blue)", I.book) +
        stat("Neurons", (s.neurons || 0).toLocaleString(), Math.round((s.neurons || 0) / s.total * 100) + "% wired", "#a06bff", I.brain);
    }

    function renderTasks() {
      var el = $("[data-home-tasks]");
      if (!el) return;
      var today = BB.dayKey();
      var list = BB.tasks.all().filter(function (t) { return !t.done && t.due && t.due <= today; })
        .sort(function (a, b) { return b.prio - a.prio || (a.due < b.due ? -1 : 1); }).slice(0, 6);
      var html = '<div class="panel-head"><h3>Today’s tasks</h3><a href="tasks/index.html">Open tasks →</a></div>';
      if (!list.length) html += '<div class="empty">Nothing due today.<br><a class="btn btn-ghost sm" href="tasks/index.html">Plan your day</a></div>';
      else html += '<ul class="mini-tasks">' + list.map(function (t) {
        return '<li><button class="check p' + t.prio + '" data-id="' + t.id + '" aria-label="Complete">' + I.check + '</button><span class="t-title">' + esc(t.title) +
          '</span><span class="mono-label">' + dueLabel(t.due) + "</span></li>";
      }).join("") + "</ul>";
      el.innerHTML = html;
      $$(".check", el).forEach(function (b) {
        b.addEventListener("click", function () { b.classList.add("is-done"); setTimeout(function () { BB.tasks.update(b.getAttribute("data-id"), { done: true, doneAt: Date.now() }); }, 250); });
      });
    }

    function renderHabits() {
      var el = $("[data-home-habits]");
      if (!el) return;
      var today = BB.dayKey();
      el.innerHTML = '<div class="panel-head"><h3>Habits</h3><a href="habits/index.html">All habits →</a></div><div class="mini-habits">' +
        habitDefs().slice(0, 5).map(function (h) {
          var st = BB.streaks(h.on), on = h.on(today);
          return '<div class="mini-habit" style="--hc:' + h.color + '"><div class="hday' + (on ? "" : " today") + '"><button class="' + (on ? "on" : "") + '" data-h="' + h.id + '"' + (h.auto ? " disabled" : "") +
            ' aria-label="' + esc(h.name) + '">' + I.check + '</button></div><span class="h-name">' + esc(h.name) + '</span><span class="h-streak">' + I.flame + st.current + "d</span></div>";
        }).join("") + "</div>";
      $$("[data-h]", el).forEach(function (b) { b.addEventListener("click", function () { toggleHabit(b.getAttribute("data-h"), today); }); });
    }


    // ═══ Mission control ═══
    var P = window.BB_PATH || [];
    function trackIndex(slug) { for (var i = 0; i < P.length; i++) if (P[i][0] === slug) return i; return -1; }
    function nextLesson() {
      for (var i = 0; i < P.length; i++) for (var j = 0; j < P[i][1].length; j++) {
        var id = P[i][0] + "/" + P[i][1][j];
        if (!BB.isDone(id)) return { id: id, track: i, slug: P[i][0], lesson: P[i][1][j] };
      }
      return null;
    }
    function pretty(slug) { var s = (slug || "").split("/").pop().replace(/-/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); }
    function series(days) {
      var act = BB.activity(), today = BB.dayKey(), out = [];
      for (var i = days - 1; i >= 0; i--) {
        var k = BB.addDays(today, -i), a = act[k] || { lessons: 0, focus: 0 };
        out.push({ k: k, lessons: a.lessons, focus: k === today ? todayFocusMin() : a.focus });
      }
      return out;
    }
    function spark(vals, color) {
      var w = 120, h = 30, max = Math.max.apply(null, vals.concat([1]));
      var pts = vals.map(function (v, i) { return (i * w / (vals.length - 1)).toFixed(1) + "," + (h - 3 - v / max * (h - 6)).toFixed(1); }).join(" ");
      return '<svg class="spark" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,' + h + " " + pts + " " + w + "," + h +
        '" fill="' + color + '" opacity=".14"/><polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>';
    }
    function pctile(arr, p) { if (!arr.length) return null; var a = arr.slice().sort(function (x, y) { return x - y; }); return a[Math.min(a.length - 1, Math.floor(p / 100 * a.length))]; }


    function renderTelemetry() {
      var el = $("[data-telemetry]");
      if (!el) return;
      var ser = series(14), last7 = ser.slice(-7);
      var lpd = last7.reduce(function (s, d) { return s + d.lessons; }, 0) / 7;
      var fpd = last7.reduce(function (s, d) { return s + d.focus; }, 0) / 7;
      var mins = BB.sessions().filter(function (x) { return x.status === "done"; }).map(function (x) { return x.min; });
      var p50 = pctile(mins, 50), p95 = pctile(mins, 95), p99 = pctile(mins, 99);
      var st = BB.learningStreak(), o = slo();
      var due = BB.tasks.all().filter(function (t) { return !t.done && t.due && t.due <= BB.dayKey(); }).length;
      var budgetPct = o.budget == null ? null : Math.round(o.budget * 100);
      el.innerHTML =
        '<div class="panel-head"><span class="mono-label">/ slo · error budget</span><span class="live-tag"><span class="rec live"></span>cortex · local</span></div>' +
        '<div class="tele-status s-' + o.state + '"><div><b>Learning pipeline</b><span>SLO · 1 lesson or 25 focus-min per day</span></div><span class="tele-pill">' + o.label + "</span></div>" +
        '<div class="tele-grid">' +
          '<div class="tcell"><span class="mono-label">lessons / day · 7d</span><b>' + lpd.toFixed(1) + "</b>" + spark(ser.map(function (d) { return d.lessons; }), "var(--blue)") + "</div>" +
          '<div class="tcell"><span class="mono-label">focus min / day · 7d</span><b>' + Math.round(fpd) + "</b>" + spark(ser.map(function (d) { return d.focus; }), "var(--red)") + "</div>" +
          '<div class="tcell"><span class="mono-label">session length</span><div class="pct-row"><span>p50<b>' + (p50 == null ? "—" : Math.round(p50) + "m") + "</b></span><span>p95<b>" + (p95 == null ? "—" : Math.round(p95) + "m") +
            "</b></span><span>p99<b>" + (p99 == null ? "—" : Math.round(p99) + "m") + "</b></span></div></div>" +
          '<div class="tcell"><span class="mono-label">uptime (streak)</span><b>' + st.current + "<small>d</small></b><span class=\"tsub\">best " + st.best + "d · " + due + " task" + (due === 1 ? "" : "s") + " due</span></div>" +
        "</div>" +
        '<div class="budget' + (budgetPct != null && budgetPct < 34 ? " low" : "") + '"><div class="budget-head"><span class="mono-label">error budget · ' + (o.win || 30) + "d window</span><b>" +
          (budgetPct == null ? "—" : budgetPct + "%") + '</b></div><div class="budget-bar"><span style="--p:' + (budgetPct == null ? 0 : budgetPct / 100) + '"></span></div><p>' +
          (o.state === "idle" ? "No data yet — finish a lesson to start measuring." : (o.missed > o.allowed ? "Budget exhausted — " + o.missed + " missed days vs " + o.allowed + " allowed" : o.missed + " of " + o.allowed + " allowed missed days used") + " · SLO attainment " + o.attain + "% · " + o.detail) + "</p></div>";
    }

    function renderHeroFoot() {
      var el = $("[data-hero-telemetry]");
      if (!el) return;
      var s = brain ? brain.stats() : { neurons: 0, total: 1, synapses: 0 };
      var a = BB.focus.get(), st = BB.learningStreak();
      el.innerHTML =
        '<div><span>wired</span><b>' + (s.neurons / s.total * 100).toFixed(1) + "%</b></div>" +
        '<div><span>focus today</span><b>' + BB.fmtMin(todayFocusMin()) + "</b></div>" +
        '<div><span>streak</span><b>' + st.current + "d</b></div>" +
        '<div><span>session</span><b class="' + (a ? "on" : "") + '">' + (a ? BB.fmtClock(BB.focus.remaining(a)) : "idle") + "</b></div>";
    }

    function renderRegions() {
      var el = $("[data-region-health]");
      if (!el) return;
      el.innerHTML = DATA.domains.map(function (d) {
        var lp = function (id) { return BB.domainOfLesson(id) === d.id; }, sp = function (x) { return BB.domain(x.domain).id === d.id; };
        var h = d.soon ? { s: "prov", label: "provisioning" } : health(lastSeen(lp, sp));
        return '<div class="rs-cell" style="--c:' + d.color + '"><span class="rs-name">' + esc(d.short.toLowerCase()) + '</span><span class="rs-spark">' + line(daily(30, lp, sp), d.color) +
          '</span><span class="rs-state s-' + h.s + '"><i></i>' + h.label + "</span></div>";
      }).join("");
    }

    // ═══ Telemetry banner: header metrics + live chart ═══
    function renderBannerHead() {
      var el = $("[data-tb-metrics]");
      if (!el) return;
      var o = slo(), mins = BB.sessions().filter(function (x) { return x.status === "done"; }).map(function (x) { return x.min; });
      var p = [50, 95, 99].map(function (q) { var v = pctile(mins, q); return v == null ? "—" : Math.round(v) + "m"; });
      var l14 = series(14).reduce(function (a, d) { return a + d.lessons; }, 0) / 14;
      var done = Object.keys(BB.doneMap()).length, left = DATA.total - done;
      var eta = l14 > 0 ? new Date(Date.now() + left / l14 * 864e5).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—";
      el.innerHTML = '<span class="tb-pill s-' + o.state + '"><i></i>' + o.label + "</span>" +
        "<span>p50 <b>" + p[0] + "</b></span><span>p95 <b>" + p[1] + "</b></span><span>p99 <b>" + p[2] + "</b></span>" +
        "<span>lpd <b>" + l14.toFixed(1) + "</b></span><span>eta <b>" + eta + "</b></span>";
      var chip = $("[data-tb-focus]"), a = BB.focus.get();
      if (chip) {
        chip.classList.toggle("on", !!a && a.mode === "focus");
        chip.innerHTML = "<i></i>" + (a ? (a.mode === "focus" ? "focus · " + BB.fmtClock(BB.focus.remaining(a)) + " · " + esc(BB.domain(a.domain).short) : "break · " + BB.fmtClock(BB.focus.remaining(a))) : "focus idle");
      }
    }

    var chart = (function () {
      var cv = $("[data-tb-chart]");
      if (!cv) return { refresh: function () {} };
      var ctx = cv.getContext("2d"), W = 0, H = 0, DPR = 1, data = null, t0 = performance.now(), visible = true, raf = 0, phase = 0, last = 0;
      var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      function resize() {
        DPR = Math.min(2, window.devicePixelRatio || 1);
        W = Math.max(1, Math.round(cv.clientWidth * DPR)); H = Math.max(1, Math.round(cv.clientHeight * DPR));
        cv.width = W; cv.height = H;
      }
      function refresh() {
        var N = 60, today = BB.dayKey(), idx = {}, lessons = [], focus = [], marks = [];
        for (var i = N - 1; i >= 0; i--) { idx[BB.addDays(today, -i)] = lessons.length; lessons.push(0); focus.push(0); }
        var m = BB.doneMap();
        Object.keys(m).forEach(function (id) { if (m[id]) { var k = BB.dayKey(m[id]); if (k in idx) lessons[idx[k]]++; } });
        BB.sessions().forEach(function (x) {
          var k = BB.dayKey(x.start);
          if (!(k in idx)) return;
          if (x.status === "done") focus[idx[k]] += x.min;
          marks.push({ i: idx[k], c: x.status === "done" ? BB.domain(x.domain).color : "#ff4d5e" });
        });
        var avg = lessons.map(function (_, i) { var s = 0, n = 0; for (var j = Math.max(0, i - 6); j <= i; j++) { s += lessons[j]; n++; } return s / n; });
        data = { N: N, lessons: lessons, focus: focus, avg: avg, marks: marks, empty: !lessons.some(Boolean) && !focus.some(Boolean) };
      }
      function y(v, max, top, bot) { return bot - (max ? v / max : 0) * (bot - top); }
      // Smooth curve through points (quadratic midpoints).
      function curve(pts, move) {
        if (move) ctx.moveTo(pts[0][0], pts[0][1]); else ctx.lineTo(pts[0][0], pts[0][1]);
        for (var i = 1; i < pts.length - 1; i++) {
          var mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
        }
        var l = pts[pts.length - 1]; ctx.lineTo(l[0], l[1]);
      }
      function draw(now) {
        raf = 0;
        if (!data || !W) return schedule();
        var dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
        var a = BB.focus.get(), focusing = a && a.mode === "focus" && !a.pausedAt;
        phase += dt * (focusing ? 5.5 : 2.2);
        var reveal = reduced ? 1 : Math.min(1, (now - t0) / 1400), ease = 1 - Math.pow(1 - reveal, 3);
        ctx.clearRect(0, 0, W, H);
        var padL = 4 * DPR, padR = 14 * DPR, top = 24 * DPR, midB = H * 0.56, barTop = midB + 8 * DPR, barB = H - 50 * DPR, sigTop = H - 30 * DPR, sigB = H - 4 * DPR;
        var X = function (i) { return padL + i / (data.N - 1) * (W - padL - padR); };
        // grid
        ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = DPR;
        for (var g = 0; g <= 4; g++) { var gy = top + g * (midB - top) / 4; ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, padL + ease * (W - padL), H); ctx.clip();
        var maxL = Math.max(1, Math.max.apply(null, data.lessons)), maxA = Math.max(1, Math.max.apply(null, data.avg)), maxF = Math.max(25, Math.max.apply(null, data.focus));
        // 7-day average area
        var grd = ctx.createLinearGradient(0, top, 0, midB);
        grd.addColorStop(0, "rgba(91,140,255,0.45)"); grd.addColorStop(1, "rgba(91,140,255,0.02)");
        var avgPts = data.avg.map(function (v, i) { return [X(i), y(v, maxA, top + 6 * DPR, midB)]; });
        ctx.beginPath(); ctx.moveTo(X(0), midB); curve(avgPts, false); ctx.lineTo(X(data.N - 1), midB); ctx.closePath(); ctx.fillStyle = grd; ctx.fill();
        ctx.beginPath(); curve(avgPts, true); ctx.strokeStyle = "#5b8cff"; ctx.lineWidth = 1.8 * DPR; ctx.stroke();
        // focus minutes (lightly smoothed) as a soft red area
        var fs = data.focus.map(function (v, i, a) { return ((a[i - 1] || v) + 2 * v + (a[i + 1] || v)) / 4; });
        var maxFs = Math.max(25, Math.max.apply(null, fs));
        var fPts = fs.map(function (v, i) { return [X(i), y(v, maxFs, top + 6 * DPR, midB)]; });
        var rg = ctx.createLinearGradient(0, top, 0, midB);
        rg.addColorStop(0, "rgba(255,77,94,0.22)"); rg.addColorStop(1, "rgba(255,77,94,0)");
        ctx.beginPath(); ctx.moveTo(X(0), midB); curve(fPts, false); ctx.lineTo(X(data.N - 1), midB); ctx.closePath(); ctx.fillStyle = rg; ctx.fill();
        ctx.beginPath(); curve(fPts, true); ctx.strokeStyle = "rgba(255,120,132,0.95)"; ctx.lineWidth = 1.4 * DPR; ctx.stroke();
        // daily lesson bars
        var bw = (W - padL - padR) / data.N * 0.72;
        data.lessons.forEach(function (v, i) {
          var hgt = Math.max(v ? 3 * DPR : 1.5 * DPR, v / maxL * (barB - barTop));
          ctx.fillStyle = v ? "rgba(56,189,248,0.75)" : "rgba(255,255,255,0.06)";
          ctx.fillRect(X(i) - bw / 2, barB - hgt, bw, hgt);
        });
        // session markers
        data.marks.forEach(function (mk) {
          var mx = X(mk.i);
          ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = DPR;
          ctx.beginPath(); ctx.moveTo(mx, 14 * DPR); ctx.lineTo(mx, 20 * DPR); ctx.stroke();
          ctx.fillStyle = mk.c; ctx.beginPath(); ctx.arc(mx, 10 * DPR, 3 * DPR, 0, 6.2832); ctx.fill();
        });
        ctx.restore();
        // "now" cursor
        var nx = X(data.N - 1), pulse = 0.5 + 0.5 * Math.sin(now / 350);
        ctx.setLineDash([3 * DPR, 4 * DPR]); ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = DPR;
        ctx.beginPath(); ctx.moveTo(nx, top); ctx.lineTo(nx, barB); ctx.stroke(); ctx.setLineDash([]);
        var ny = y(data.avg[data.N - 1], maxA, top + 6 * DPR, midB);
        ctx.fillStyle = "rgba(91,140,255," + (0.25 * pulse) + ")"; ctx.beginPath(); ctx.arc(nx, ny, (6 + 5 * pulse) * DPR, 0, 6.2832); ctx.fill();
        ctx.fillStyle = "#8aa9ff"; ctx.beginPath(); ctx.arc(nx, ny, 3 * DPR, 0, 6.2832); ctx.fill();
        // cortex signal: a live trace driven by how wired the brain is and whether you're focusing
        var st = brain ? brain.stats() : { neurons: 0, total: 1 }, wired = st.neurons / st.total;
        var amp = (sigB - sigTop) * 0.5 * Math.min(1, 0.18 + wired * 1.6 + (focusing ? 0.55 : 0));
        var mid = (sigTop + sigB) / 2, sg = ctx.createLinearGradient(0, 0, W, 0);
        sg.addColorStop(0, "rgba(91,140,255,0.15)"); sg.addColorStop(0.6, "rgba(160,107,255,0.7)"); sg.addColorStop(1, focusing ? "#ff4d5e" : "#8aa9ff");
        ctx.beginPath();
        for (var px = 0; px <= W; px += 3 * DPR) {
          var u = px / W * 18 - phase;
          var v = Math.sin(u) * 0.6 + Math.sin(u * 2.7 + 1.3) * 0.25 + Math.sin(u * 7.1) * 0.15 * (focusing ? 1.6 : 0.6);
          var env = 0.35 + 0.65 * (px / W);
          px ? ctx.lineTo(px, mid - v * amp * env) : ctx.moveTo(px, mid - v * amp * env);
        }
        ctx.strokeStyle = sg; ctx.lineWidth = 1.4 * DPR; ctx.stroke();
        ctx.font = 500 * 1 + " " + 10 * DPR + "px Geist Mono, monospace"; ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillText(focusing ? "cortex signal · focusing" : "cortex signal · idle", 2 * DPR, sigTop - 2 * DPR);
        if (data.empty) {
          ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = 12 * DPR + "px Geist, sans-serif";
          ctx.fillText("no activity yet — your first lesson draws the first bar", W / 2, (top + midB) / 2);
          ctx.textAlign = "start";
        }
        schedule();
      }
      function schedule() { if (visible && !document.hidden && !raf) raf = requestAnimationFrame(draw); }
      resize(); refresh();
      if ("ResizeObserver" in window) new ResizeObserver(resize).observe(cv);
      if ("IntersectionObserver" in window) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; schedule(); }).observe(cv);
      document.addEventListener("visibilitychange", schedule);
      schedule();
      return { refresh: refresh };
    })();

    function events() {
      var ev = [], m = BB.doneMap();
      Object.keys(m).forEach(function (id) {
        if (!m[id]) return;
        var slug = id.split("/")[0], ti = trackIndex(slug);
        ev.push({ t: m[id], lvl: "ok", k: "lesson.complete", msg: "track=" + ("0" + (ti + 1)).slice(-2) + ' "' + pretty(id) + '"' });
      });
      BB.sessions().forEach(function (x) {
        var d = BB.domain(x.domain);
        ev.push(x.status === "done"
          ? { t: x.end || x.start, lvl: "ok", k: "focus.done", msg: "dur=" + BB.fmtMin(x.min) + " region=" + d.short.toLowerCase() + " neurons=+" + Math.floor(x.min / 2) }
          : { t: x.end || x.start, lvl: "err", k: "focus.withered", msg: "after=" + BB.fmtMin(x.min) + " region=" + d.short.toLowerCase() });
      });
      BB.tasks.all().forEach(function (t) { if (t.done && t.doneAt) ev.push({ t: t.doneAt, lvl: "info", k: "task.done", msg: '"' + t.title + '"' }); });
      return ev.sort(function (a, b) { return b.t - a.t; }).slice(0, 40);
    }
    function stamp(t) {
      var d = new Date(t), p = BB.pad;
      var time = p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()) + "." + ("00" + d.getMilliseconds()).slice(-3);
      return BB.dayKey(t) === BB.dayKey() ? time : d.toLocaleDateString(undefined, { month: "short", day: "2-digit" }) + " " + time.slice(0, 5);
    }
    function heartbeat() {
      var s = brain ? brain.stats() : { neurons: 0, synapses: 0 }, a = BB.focus.get();
      return '<li class="lvl-dbg hb"><time>' + stamp(Date.now()) + '</time><span class="lvl">DBG</span><span class="ev">cortex.heartbeat</span><span class="msg" data-ev="cortex.heartbeat ">neurons=' + s.neurons +
        " synapses=" + s.synapses + " focus=" + (a ? (a.pausedAt ? "paused" : "running") + "(" + BB.fmtClock(BB.focus.remaining(a)) + ")" : "idle") + "</span></li>";
    }
    function renderLog() {
      var el = $("[data-log]");
      if (!el) return;
      var ev = events();
      el.innerHTML = heartbeat() + (ev.length ? ev.map(function (e) {
        return '<li class="lvl-' + e.lvl + '"><time>' + stamp(e.t) + '</time><span class="lvl">' + { ok: "OK", err: "WARN", info: "INFO" }[e.lvl] + '</span><span class="ev">' + e.k +
          '</span><span class="msg" data-ev="' + e.k + ' ">' + esc(e.msg) + "</span></li>";
      }).join("") : '<li class="lvl-dbg"><time>—</time><span class="lvl">INFO</span><span class="ev">cortex.boot</span><span class="msg" data-ev="cortex.boot ">no events yet — complete a lesson to emit your first event</span></li>');
    }
    setInterval(function () {
      var hb = $("[data-log] .hb");
      if (hb) { hb.outerHTML = heartbeat(); var n = $("[data-log] .hb"); if (n) { n.classList.add("flash"); } }
      renderHeroFoot();
      renderBannerHead();
    }, 2000);

    // ═══ Terminal ═══
    var termOut = $("[data-term-out]"), termIn = $("[data-term-input]"), termBody = $("[data-term-body]"), mirror = $("[data-term-mirror]");
    // The real <input> is invisible; this mirror draws the text with a block cursor at the caret.
    function paintMirror() {
      if (!mirror || !termIn) return;
      var v = termIn.value, pos = termIn.selectionStart == null ? v.length : termIn.selectionStart;
      mirror.innerHTML = esc(v.slice(0, pos)) + '<span class="term-cursor">' + (v.charAt(pos) ? esc(v.charAt(pos)) : " ") + "</span>" + esc(v.slice(pos + 1));
      mirror.scrollLeft = mirror.scrollWidth;
    }
    var hist = BB.load("bb-term-hist", []), hi = hist.length, lastList = [];
    var CMDS = ["help", "status", "next", "path", "track", "focus", "stop", "tasks", "add", "done", "search", "goto", "theme", "reset", "clear", "whoami", "uptime", "date"];
    function out(html, cls) {
      var line = document.createElement("div");
      line.className = "tl" + (cls ? " " + cls : "");
      line.innerHTML = html;
      termOut.appendChild(line);
      while (termOut.children.length > 220) termOut.removeChild(termOut.firstChild);
      termBody.scrollTop = termBody.scrollHeight;
    }
    function bar(f, n) { n = n || 16; var k = Math.round(f * n); return '<span class="tb">' + "█".repeat(k) + '</span><span class="tb-off">' + "░".repeat(n - k) + "</span>"; }
    function nav(url, label) { out('<span class="t-dim">→ opening ' + esc(label) + "…</span>"); setTimeout(function () { location.href = url; }, 450); }
    var run = {
      help: function () {
        [["status", "progress, streak, focus, brain"], ["next", "open the next lesson on the path"], ["path", "all tracks with progress"], ["track &lt;n&gt;", "open track n"],
         ["focus [min]", "start a focus session (default 25)"], ["stop", "give up the running session"], ["tasks", "tasks due today"], ["add &lt;text&gt;", "add a task due today"],
         ["done &lt;n&gt;", "complete task n from the last list"], ["search &lt;q&gt;", "search all lessons"], ["goto &lt;page&gt;", "brain · focus · tasks · habits"],
         ["theme", "toggle light/dark"], ["reset", "open reset & backup settings"], ["clear", "clear the screen"]
        ].forEach(function (r) { out('<span class="t-cmd">' + r[0] + '</span><span class="t-dim">' + r[1] + "</span>", "row"); });
      },
      status: function () {
        var done = Object.keys(BB.doneMap()).length, n = nextLesson(), st = BB.learningStreak(), s = brain ? brain.stats() : { neurons: 0, synapses: 0 };
        out('<span class="t-key">program </span>DevOps &amp; SRE');
        out('<span class="t-key">progress</span>' + bar(done / DATA.total) + " " + done + "/" + DATA.total + " (" + (done / DATA.total * 100).toFixed(1) + "%)");
        if (n) out('<span class="t-key">track   </span>' + ("0" + (n.track + 1)).slice(-2) + " · " + esc(DATA.tracks[n.slug].t));
        out('<span class="t-key">streak  </span>' + st.current + " day" + (st.current === 1 ? "" : "s") + ' <span class="t-dim">(best ' + st.best + ")</span>");
        out('<span class="t-key">focus   </span>' + BB.fmtMin(todayFocusMin()) + " today");
        out('<span class="t-key">brain   </span>' + s.neurons + " neurons · " + s.synapses + " synapses");
      },
      next: function () {
        var n = nextLesson();
        if (!n) { out('<span class="t-ok">✓ every lesson complete. legendary.</span>'); return; }
        out("Track " + ("0" + (n.track + 1)).slice(-2) + " · " + esc(pretty(n.lesson)));
        nav(ROOT + n.id + "/index.html", "lesson");
      },
      path: function () {
        P.forEach(function (row, i) {
          var done = row[1].filter(function (r) { return BB.isDone(row[0] + "/" + r); }).length, f = done / row[1].length;
          out('<span class="t-dim">' + ("0" + (i + 1)).slice(-2) + "</span> " + bar(f, 12) + " " + ("  " + Math.round(f * 100)).slice(-3) + "% " + esc(DATA.tracks[row[0]].t), "row-path");
        });
      },
      track: function (a) {
        var i = parseInt(a[0], 10) - 1;
        if (!(i >= 0 && i < P.length)) { out('<span class="t-err">usage: track &lt;1-' + P.length + "&gt;</span>"); return; }
        nav(ROOT + P[i][0] + "/index.html", "Track " + ("0" + (i + 1)).slice(-2));
      },
      focus: function (a) {
        if (BB.focus.get()) { out('<span class="t-warn">a session is already running</span>'); return; }
        var min = Math.max(1, Math.min(240, parseInt(a[0], 10) || 25)), n = nextLesson(), dom = n ? BB.domainOfLesson(n.id) : "devops";
        BB.focus.start({ min: min, domain: dom, label: n ? pretty(n.lesson) : "Focus", strict: BB.load("bb-strict", false) });
        out('<span class="t-ok">● focus started</span> ' + min + "m · region " + esc(BB.domain(dom).name) + ' <span class="t-dim">— timer in the header</span>');
      },
      stop: function () {
        if (!BB.focus.get()) { out('<span class="t-dim">no session running</span>'); return; }
        BB.focus.finish("failed"); out('<span class="t-err">session abandoned — growing neurons withered</span>');
      },
      tasks: function () {
        var today = BB.dayKey();
        lastList = BB.tasks.all().filter(function (t) { return !t.done && t.due && t.due <= today; }).sort(function (x, y) { return y.prio - x.prio; });
        if (!lastList.length) { out('<span class="t-dim">nothing due today · add one with</span> add &lt;text&gt;'); return; }
        lastList.forEach(function (t, i) { out('<span class="t-dim">[' + (i + 1) + "]</span> " + ["", '<span class="p1">!</span> ', '<span class="p2">!!</span> ', '<span class="p3">!!!</span> '][t.prio] + esc(t.title)); });
      },
      add: function (a) {
        var title = a.join(" ").trim();
        if (!title) { out('<span class="t-err">usage: add &lt;text&gt;</span>'); return; }
        BB.tasks.add({ title: title, due: BB.dayKey() }); out('<span class="t-ok">+ task added</span> ' + esc(title));
      },
      done: function (a) {
        var t = lastList[parseInt(a[0], 10) - 1];
        if (!t) { out('<span class="t-err">run</span> tasks <span class="t-err">first, then</span> done &lt;n&gt;'); return; }
        BB.tasks.update(t.id, { done: true, doneAt: Date.now() }); out('<span class="t-ok">✓ done</span> ' + esc(t.title));
      },
      search: function (a) { BB.openSearch(a.join(" ")); },
      "goto": function (a) {
        var pgs = { brain: 1, focus: 1, tasks: 1, habits: 1 };
        if (!pgs[a[0]]) { out('<span class="t-err">usage: goto brain|focus|tasks|habits</span>'); return; }
        nav(ROOT + a[0] + "/index.html", a[0]);
      },
      theme: function () { var b = $("[data-theme-toggle]"); if (b) b.click(); out('<span class="t-dim">theme → ' + document.documentElement.getAttribute("data-theme") + "</span>"); },
      reset: function () { BB.openSettings(); out('<span class="t-dim">opened settings → reset</span>'); },
      clear: function () { termOut.innerHTML = ""; },
      whoami: function () { out("an engineer, figuring things out."); },
      uptime: function () { var st = BB.learningStreak(); out("up " + st.current + " day" + (st.current === 1 ? "" : "s") + ", best " + st.best + ", load average: " + series(3).map(function (d) { return d.lessons; }).join(", ")); },
      date: function () { out(new Date().toString()); }
    };
    function exec(line) {
      out('<span class="term-prompt">you@blackbox:~$</span> ' + esc(line), "echo");
      var parts = line.trim().split(/\s+/), cmd = (parts.shift() || "").toLowerCase();
      if (!cmd) return;
      if (cmd === "sudo") { out('<span class="t-warn">nice try. you are already root of your own learning.</span>'); return; }
      if (cmd === "ls") cmd = "path";
      if (cmd === "open") cmd = "track";
      if (run[cmd]) run[cmd](parts); else out('<span class="t-err">command not found: ' + esc(cmd) + '</span> <span class="t-dim">— try</span> help');
    }
    if (termIn) {
      out('<span class="t-ok">BLACKBOX shell</span> <span class="t-dim">· type</span> help <span class="t-dim">to see commands</span>');
      var nx = nextLesson();
      if (nx) out('<span class="t-dim">motd: next up →</span> Track ' + ("0" + (nx.track + 1)).slice(-2) + " · " + esc(pretty(nx.lesson)) + ' <span class="t-dim">(run</span> next<span class="t-dim">)</span>');
      $("[data-term-form]").addEventListener("submit", function (e) {
        e.preventDefault();
        var v = termIn.value;
        termIn.value = "";
        if (v.trim()) { hist.push(v); hist = hist.slice(-50); BB.save("bb-term-hist", hist); }
        hi = hist.length;
        exec(v);
        paintMirror();
      });
      ["input", "keyup", "click", "focus", "blur", "select"].forEach(function (ev) { termIn.addEventListener(ev, paintMirror); });
      termIn.addEventListener("keydown", function () { setTimeout(paintMirror, 0); });
      termIn.addEventListener("keydown", function (e) {
        if (e.key === "ArrowUp") { e.preventDefault(); if (hi > 0) termIn.value = hist[--hi] || ""; }
        else if (e.key === "ArrowDown") { e.preventDefault(); hi = Math.min(hist.length, hi + 1); termIn.value = hist[hi] || ""; }
        else if (e.key === "Tab") {
          e.preventDefault();
          var v = termIn.value.trim().toLowerCase(), hits = CMDS.filter(function (c) { return c.indexOf(v) === 0; });
          if (hits.length === 1) { termIn.value = hits[0] + " "; setTimeout(paintMirror, 0); }
          else if (hits.length > 1) out('<span class="t-dim">' + hits.join("  ") + "</span>");
        } else if (e.key === "l" && e.ctrlKey) { e.preventDefault(); termOut.innerHTML = ""; }
        else if (e.key === "c" && e.ctrlKey && !window.getSelection().toString()) { e.preventDefault(); out('<span class="term-prompt">you@blackbox:~$</span> ' + esc(termIn.value) + '<span class="t-dim">^C</span>', "echo"); termIn.value = ""; }
      });
      termBody.addEventListener("click", function () { if (!window.getSelection().toString()) termIn.focus({ preventScroll: true }); });
    }

    renderTasks(); renderHabits(); paintPath(); renderTelemetry(); renderRegions(); renderLog(); renderHeroFoot(); renderBannerHead();
    BB.on(function (w) {
      if (w === "tasks") { renderTasks(); renderTelemetry(); renderLog(); }
      if (w === "habits" || w === "progress" || w === "session") { renderHabits(); renderTelemetry(); renderRegions(); renderLog(); renderHeroFoot(); renderBannerHead(); chart.refresh(); }
      if (w === "progress") paintPath();
      if (w === "focus") { renderHeroFoot(); renderBannerHead(); }
    });
  }

  // ═════════════════════════════ BRAIN ═════════════════════════════
  function brainPage() {
    // Two views of the same progress. The BRAIN shows your programs as lobes: click one to light up
    // how it connects to the others, double-click to fly inside. Inside is a WORLD — the program as a
    // galaxy of topic stars along a learning path, with subtopics and single lessons/problems in orbit.
    var TREE = window.BB_TREE || { id: "", n: "Your brain", k: [] };
    var list = $("[data-region-list]"), stage = $("[data-brain-stage]"), tip = $("[data-brain-tooltip]");
    var brainCanvas = $('[data-brain="full"]'), worldCanvas = $("[data-world]");
    var parent = {}, byId = {}, lobeOf = {}, at = null, mode = "brain", selLobe = null, lobeNode = null, brain, world;
    var isLeaf = function (x) { return Array.isArray(x); };
    var idOf = function (x) { return isLeaf(x) ? x[0] : x.id; };
    (function index(node) { (node.k || []).forEach(function (k) { byId[idOf(k)] = k; parent[idOf(k)] = node; if (!isLeaf(k)) index(k); }); })(TREE);
    DATA.domains.forEach(function (d) { lobeOf[d.id] = d; });
    function doneAt(id) { var m = BB.doneMap(); return Object.prototype.hasOwnProperty.call(m, id) && (at == null || m[id] <= at); }
    function tally(node) {
      if (isLeaf(node)) return { done: doneAt(node[0]) ? 1 : 0, total: 1 };
      var r = { done: 0, total: 0 };
      (node.k || []).forEach(function (k) { var x = tally(k); r.done += x.done; r.total += x.total; });
      return r;
    }
    function pct(x) { return x.total ? Math.round(x.done / x.total * 100) : 0; }
    function lobeFor(id) { var n = byId[id]; while (n && parent[idOf(n)] !== TREE) n = parent[idOf(n)]; return n; }
    function stats(a, b, c, la, lb, lc) {
      $("[data-s1]").textContent = a; $("[data-s2]").textContent = b; $("[data-s3]").textContent = c;
      $("[data-s1-label]").textContent = la; $("[data-s2-label]").textContent = lb; $("[data-s3-label]").textContent = lc;
    }

    // ── header, crumbs, panel ──
    function crumbs(items) {
      $("[data-brain-crumbs]").innerHTML = items.map(function (it, i) {
        return i === items.length - 1 ? "<span>" + esc(it[0]) + "</span>" : '<a href="' + it[1] + '">' + esc(it[0]) + "</a>";
      }).join("<i>/</i>");
    }
    function header() {
      var up = $("[data-brain-up]"), tools = $("[data-world-tools]");
      if (mode === "brain") {
        crumbs([["Brain", "#"]]);
        $("[data-level-title]").textContent = selLobe ? lobeOf[selLobe].name : "Your brain";
        $("[data-level-sub]").textContent = selLobe ? "Double-click the lobe (or press Enter) to step inside and watch what you've learned grow."
          : "Every lesson you finish, problem you solve and focus minute wires new neurons. Click a lobe to select it; double-click to step inside.";
        $("[data-stage-tip]").textContent = "Click a lobe to select it · double-click to step inside";
        up.hidden = true; tools.hidden = true;
        $("[data-brain-path]").textContent = "cortex@blackbox:~ — neural map";
        document.title = "Your brain · BLACKBOX";
        return;
      }
      var foc = world.focused() || world.root(), path = [], n = foc;
      while (n) { path.unshift(n); n = n.parent; }
      crumbs([["Brain", "#"]].concat(path.map(function (x, i) { return [i === 0 ? lobeOf[lobeNode.id].short : x.name, "#" + x.id]; })));
      $("[data-level-title]").textContent = foc.depth === 0 ? lobeOf[lobeNode.id].name : foc.name;
      var t = tally(byId[foc.id] || lobeNode);
      $("[data-level-sub]").textContent = t.done + " of " + t.total + " learned. Every leaf is something to learn — open, glowing leaves are the ones you know. Learn more and watch the tree fill out.";
      $("[data-stage-tip]").textContent = "Drag to move · scroll to zoom · click a branch or leaf · double-click to fly to it";
      up.hidden = false; tools.hidden = false;
      $("[data-brain-path]").textContent = "cortex@blackbox:~/" + lobeNode.id + " — growing";
      document.title = (foc.depth === 0 ? lobeOf[lobeNode.id].name : foc.name) + " · Brain · BLACKBOX";
    }
    function lobeRow(d, st, by) {
      var r = by[d.id] || { lit: 0, size: 1 }, s = st[d.id] || { done: 0, total: 0, focusMin: 0 }, p = Math.round(r.lit / r.size * 100);
      return '<button class="region' + (d.soon ? " soon" : "") + (selLobe === d.id ? " is-active" : "") + '" data-lobe="' + d.id + '" style="--c:' + d.color + '">' +
        '<span class="region-top"><i></i><b>' + esc(d.name) + "</b><span>" + (d.soon ? "soon" : p + "%") + "</span></span>" +
        '<div class="progress"><div class="progress-bar"><span style="--p:' + (r.lit / r.size) + '"></span></div></div>' +
        (d.soon ? '<span class="region-meta">Dormant — ' + esc(d.blurb) + "</span>"
                : '<span class="region-meta"><span>' + s.done + "/" + s.total + " learned</span><span>" + BB.fmtMin(s.focusMin) + " focus</span></span>") + "</button>";
    }
    function panelBrain() {
      var st = BB.brainState(at == null ? undefined : at), by = (brain && brain.stats().byRegion) || {}, html = "";
      if (selLobe) {
        var d = lobeOf[selLobe], s = st[selLobe] || { done: 0, total: 0 };
        html += '<div class="lobe-card" style="--c:' + d.color + '"><p class="mono-label">Selected lobe</p><h3>' + esc(d.name) + "</h3><p>" + esc(d.blurb) + "</p>" +
          '<div class="rp-sum"><b>' + pct(s) + "%</b><span>" + s.done + " / " + s.total + " learned</span></div>" +
          (d.soon ? '<p class="region-meta">Coming soon — nothing to grow yet.</p>' : '<button class="btn btn-primary sm" data-enter="' + d.id + '">Step inside ' + esc(d.short) + " →</button>") +
"</div>";
      }
      html += '<p class="mono-label rp-label">Lobes</p>' + DATA.domains.map(function (d) { return lobeRow(d, st, by); }).join("") +
        '<p class="region-note">Learning wires up to 75% of a lobe; focus sessions wire the rest (one neuron per 2 focused minutes).</p>';
      list.innerHTML = html;
      $$("[data-lobe]", list).forEach(function (b) {
        b.addEventListener("click", function () { selectLobe(b.getAttribute("data-lobe")); });
        b.addEventListener("dblclick", function () { enter(b.getAttribute("data-lobe")); });
      });
      $$("[data-enter]", list).forEach(function (b) { b.addEventListener("click", function () { enter(b.getAttribute("data-enter")); }); });
    }
    function panelWorld() {
      var sel = world.selected() || world.focused() || world.root(), src = byId[sel.id] || lobeNode, t = tally(src), html = "";
      var kind = sel.leaf ? (lobeNode.id === "dsa" ? "Problem" : lobeNode.id === "devops" ? "Lesson" : lobeNode.id === "backend" ? "Section" : "Concept")
        : sel.depth === 0 ? "Tree" : sel.depth === 1 ? "Branch · topic" : "Twig · subtopic";
      html += '<div class="lobe-card" style="--c:' + sel.color + '"><p class="mono-label">' + kind + "</p><h3>" + esc(sel.name) + "</h3>";
      if (sel.leaf) {
        var done = doneAt(sel.id);
        html += '<div class="leaf-actions">' + (at == null ? '<button class="btn ' + (done ? "btn-ghost" : "btn-primary") + ' sm" data-toggle="' + esc(sel.id) + '">' + (done ? "✓ Learned — undo" : "Mark learned") + "</button>" : "") +
          (sel.href ? '<a class="btn btn-ghost sm" href="' + ROOT + esc(sel.href) + '">Open →</a>' : "") + "</div>" + (sel.tag ? '<p class="region-meta">' + esc(sel.tag) + "</p>" : "");
      } else {
        html += '<div class="rp-sum"><b>' + pct(t) + "%</b><span>" + t.done + " / " + t.total + " learned</span>" + (sel.href ? '<a href="' + ROOT + esc(sel.href) + '">Open page →</a>' : "") + "</div>" +
          (sel !== world.focused() ? '<button class="btn btn-primary sm" data-fly="' + esc(sel.id) + '">Fly in →</button>' : "");
      }
      // connections: where it sits and what it links to
      var conns = [];
      if (sel.parent) conns.push(["Part of", sel.parent]);
      var sib = sel.parent ? sel.parent.kids : [], i = sib.indexOf(sel);
      if (sel.depth === 1) { if (sib[i - 1]) conns.push(["Comes after", sib[i - 1]]); if (sib[i + 1]) conns.push(["Leads to", sib[i + 1]]); }
      if (conns.length) html += '<p class="mono-label" style="margin-top:14px">On the tree</p><div class="conn-list">' + conns.map(function (c) {
        var tt = tally(byId[c[1].id] || lobeNode);
        return '<button class="conn" data-node="' + esc(c[1].id) + '" style="--c:' + c[1].color + '"><i></i><span><b>' + esc(c[1].depth === 0 ? lobeOf[lobeNode.id].name : c[1].name) + "</b><em>" + c[0] + "</em></span><small>" + pct(tt) + "%</small></button>";
      }).join("") + "</div>";
      html += "</div>";
      if (!sel.leaf && sel.kids.length) {
        html += '<p class="mono-label rp-label">' + (sel.kids[0].leaf ? "Leaves on this branch" : "Branches") + " · " + sel.kids.length + "</p>" + sel.kids.map(function (k) {
          if (k.leaf) {
            var dn = doneAt(k.id);
            return '<div class="region leaf' + (dn ? " is-done" : "") + '" data-node="' + esc(k.id) + '" style="--c:' + k.color + '"><button class="leaf-check" data-toggle="' + esc(k.id) + '"' + (at != null ? " disabled" : "") +
              ' aria-label="' + (dn ? "Mark not learned" : "Mark learned") + '">' + I.check + '</button><a class="leaf-name" href="' + ROOT + esc(k.href) + '">' + esc(k.name) + "</a>" +
              (k.tag ? '<span class="leaf-tag t-' + esc(String(k.tag).toLowerCase()) + '">' + esc(k.tag) + "</span>" : "") + "</div>";
          }
          var kt = tally(byId[k.id]);
          return '<button class="region" data-node="' + esc(k.id) + '" style="--c:' + k.color + '"><span class="region-top"><i></i><b>' + esc((k.num ? k.num + " · " : "") + k.name) + "</b><span>" + pct(kt) + "%</span></span>" +
            '<div class="progress"><div class="progress-bar"><span style="--p:' + (kt.total ? kt.done / kt.total : 0) + '"></span></div></div><span class="region-meta"><span>' + kt.done + "/" + kt.total + ' learned</span><span class="go-in">Fly in →</span></span></button>';
        }).join("");
      }
      list.innerHTML = html;
      $$("[data-node]", list).forEach(function (b) {
        b.addEventListener("click", function (e) {
          if (e.target.closest("a, [data-toggle]")) return;
          var n = world.node(b.getAttribute("data-node"));
          if (!n) return;
          if (n.leaf) { world.select(n.id); panelWorld(); } else go(n.id);
        });
      });
      $$("[data-fly]", list).forEach(function (b) { b.addEventListener("click", function () { go(b.getAttribute("data-fly")); }); });
      $$("[data-toggle]", list).forEach(function (b) {
        b.addEventListener("click", function () {
          var id = b.getAttribute("data-toggle"), on = !BB.isDone(id);
          BB.setDone(id, on);
          if (on) BB.toast("A new leaf opened in " + lobeOf[lobeNode.id].name, lobeOf[lobeNode.id].color);
        });
      });
    }
    function worldStats() {
      var r = world.root(), topicsDone = r.kids.filter(function (k) { return k.done >= k.total; }).length;
      stats(r.done.toLocaleString(), pct({ done: r.done, total: r.total }) + "%", topicsDone + " / " + r.kids.length, "Leaves open", "Grown", "Branches full");
    }
    function paint() {
      header();
      if (mode === "brain") { panelBrain(); var s = brain.stats(); stats(s.neurons.toLocaleString(), s.synapses.toLocaleString(), s.regions + " / " + DATA.domains.filter(function (d) { return !d.soon; }).length, "Neurons", "Synapses", "Lobes active"); }
      else { worldStats(); panelWorld(); }
      drawGrowth();
    }

    // ── brain mode ──
    function selectLobe(id) {
      selLobe = id || null;
      brain.highlight(selLobe);
      paint();
    }
    function enter(id, focusId) {
      var d = lobeOf[id], node = (TREE.k || []).filter(function (k) { return k.id === id; })[0];
      if (!d || d.soon || !node || !(node.k || []).length) { BB.toast((d ? d.name : "This lobe") + " is dormant — coming soon"); return; }
      var open = function () {
        mode = "world"; lobeNode = node; selLobe = id;
        brainCanvas.hidden = true; worldCanvas.hidden = false; stage.classList.add("in-world");
        world.open(node, d.color, focusId);
        var h = "#" + (focusId || id);
        if (location.hash !== h) history.replaceState(null, "", h);
        paint();
      };
      if (mode === "brain" && !brainCanvas.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches) brain.zoomTo(id, open);
      else open();
    }
    function exitWorld() {
      if (world) world.close();
      mode = "brain"; worldCanvas.hidden = true; brainCanvas.hidden = false; stage.classList.remove("in-world");
      history.replaceState(null, "", location.pathname + location.search);
      selectLobe(selLobe);
    }
    function go(id) {                                  // fly to a node inside the current world
      world.focus(id);
      var h = "#" + id;
      if (location.hash !== h) history.replaceState(null, "", h);
      paint();
    }
    function back() {
      if (mode !== "world") return;
      var f = world.focused();
      if (f && f.parent) go(f.parent.depth === 0 ? f.parent.id : f.parent.id); else exitWorld();
    }
    function fromHash() {
      var id = decodeURIComponent(location.hash.slice(1));
      if (!id) { if (mode === "world") exitWorld(); return; }
      var lobe = lobeOf[id] ? (TREE.k || []).filter(function (k) { return k.id === id; })[0] : lobeFor(id);
      if (!lobe) return;
      if (mode === "world" && lobeNode === lobe) { go(id); return; }
      if (mode === "world") world.close();
      mode = "brain"; brainCanvas.hidden = true;           // skip the fly-in animation for deep links
      enter(lobe.id, id === lobe.id ? null : id);
    }

    brain = mountBrain(brainCanvas, {
      interactive: true, zoomable: true, fill: 0.95, speed: 0.08, offsetY: window.innerWidth < 640 ? 0.05 : 0.02,
      tipMode: "card", selected: function () { return selLobe; },
      onStats: function () { if (brain && mode === "brain" && list) paint(); },
      onSelect: function (d) { if (d) selectLobe(d.id); else selectLobe(null); },
      onEnter: function (d) { if (d) enter(d.id); }
    });
    world = BB.World(worldCanvas, {
      isDone: doneAt,
      reserve: function () {                          // keep labels out from under the overlaid title and stats
        var c = worldCanvas.getBoundingClientRect(), out = [];
        [".stage-top", ".stage-stats", "[data-world-tools]", "[data-brain-up]"].forEach(function (sel) {
          var el = $(sel, stage); if (!el || el.hidden) return;
          var r = el.getBoundingClientRect(); out.push([r.left - c.left, r.top - c.top, r.width, r.height]);
        });
        return out;
      },
      onSelect: function (n) { if (n && !n.leaf && n.depth === 0) world.select(null); paint(); },
      onFocus: function () {},
      onEnter: function (n) {
        if (n.leaf) { if (n.href) location.href = ROOT + n.href; return; }
        if (n.depth === 0) return;
        go(n.id);
      },
      onHover: function (n) {
        if (!tip) return;
        if (!n) { tip.hidden = true; stage.classList.remove("hovering"); return; }
        var t = n.leaf ? null : tally(byId[n.id] || lobeNode);
        tip.className = "brain-tooltip docked card"; tip.style.setProperty("--c", n.color);
        tip.innerHTML = '<div class="bt-head"><i style="background:' + n.color + ";box-shadow:0 0 10px " + n.color + '"></i><b>' + esc(n.depth === 0 ? lobeOf[lobeNode.id].name : n.name) + "</b></div>" +
          (n.leaf ? '<p class="bt-meta"><span>' + (n.done ? "✓ learned — leaf open" : "bud — not learned yet") + "</span>" + (n.tag ? "<span>" + esc(n.tag) + "</span>" : "") + '</p><p class="bt-hint">Click for details · double-click to open</p>'
                  : '<div class="bt-bar"><span style="width:' + pct(t) + "%;background:" + n.color + '"></span></div><p class="bt-meta"><span>' + pct(t) + "% grown</span><span>" + t.done + "/" + t.total + '</span></p><p class="bt-hint">Double-click to fly to this branch</p>');
        tip.hidden = false; stage.classList.add("hovering");
      }
    });

    $("[data-brain-up]").addEventListener("click", back);
    $("[data-brain-crumbs]").addEventListener("click", function (e) {
      var a = e.target.closest("a"); if (!a) return;
      e.preventDefault();
      var id = a.getAttribute("href").slice(1);
      if (!id) exitWorld(); else go(id);
    });
    $$("[data-wz]").forEach(function (b) {
      b.addEventListener("click", function () { var v = b.getAttribute("data-wz"); if (v === "fit") go(lobeNode.id); else world.zoom(v === "in" ? 1.5 : 1 / 1.5); });
    });
    document.addEventListener("keydown", function (e) {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "Escape" || e.key === "Backspace") { if (mode === "world") { e.preventDefault(); back(); } else if (selLobe) selectLobe(null); }
      if (e.key === "Enter" && mode === "brain" && selLobe) enter(selLobe);
    });
    window.addEventListener("hashchange", fromHash);
    BB.on(function (w) {
      if (w !== "progress") return;
      brain.refresh();
      if (mode === "world") world.refresh();
      paint();
    });

    // ── growth over time: chart + time travel ──
    var range = $("[data-time-range]"), chart = $("[data-growth-chart]"), playing = 0;
    function span() { var s0 = BB.firstActivity(), now = Date.now(); return [Math.min(s0 || now - 864e5, now - 864e5), now]; }
    function curNode() { if (mode !== "world") return TREE; var f = world.focused(); return f && byId[f.id] || lobeNode; }
    function leafTimes(node) {
      var out = [], m = BB.doneMap();
      (function walk(n) { (n.k || []).forEach(function (k) { if (isLeaf(k)) { if (m[k[0]]) out.push(m[k[0]]); else if (k[0] in m) out.push(0); } else walk(k); }); })(node);
      return out.sort(function (a, b) { return a - b; });
    }
    function drawGrowth() {
      if (!chart) return;
      var DPR = Math.min(2, window.devicePixelRatio || 1), w = chart.clientWidth * DPR, h = chart.clientHeight * DPR;
      if (!w || !h) return;
      chart.width = w; chart.height = h;
      var g = chart.getContext("2d"), sp = span(), node = curNode(), times = leafTimes(node), total = Math.max(1, tally(node).total);
      var color = mode === "world" ? lobeOf[lobeNode.id].color : "#5b8cff", N = 90, pts = [], j = 0, c = 0;
      for (var i = 0; i <= N; i++) {
        var tt = sp[0] + (sp[1] - sp[0]) * i / N;
        while (j < times.length && times[j] <= tt) { j++; c++; }
        pts.push([i / N * w, h - 2 * DPR - (c / total) * (h - 6 * DPR) * 0.92 - (c ? 2 * DPR : 0)]);
      }
      var grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, color + "66"); grad.addColorStop(1, color + "00");
      g.beginPath(); g.moveTo(0, h); pts.forEach(function (p) { g.lineTo(p[0], p[1]); }); g.lineTo(w, h); g.closePath(); g.fillStyle = grad; g.fill();
      g.beginPath(); pts.forEach(function (p, k) { k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.strokeStyle = color; g.lineWidth = 1.5 * DPR; g.stroke();
      var week = times.filter(function (x) { return x > Date.now() - 7 * 864e5; }).length;
      $("[data-time-delta]").textContent = week ? "+" + week + " this week" : "";
    }
    function setTime(v, quick) {
      var sp = span();
      at = v >= 100 ? null : sp[0] + (sp[1] - sp[0]) * v / 100;
      var label = at == null ? "Today" : new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
      $("[data-time-date]").textContent = label;
      var tl = $("[data-time-label]");
      tl.hidden = at == null; tl.textContent = "⟲ Your brain on " + label;
      stage.classList.toggle("rewound", at != null);
      if (mode === "world") world.refresh(); else brain.refresh({ quick: quick });
      paint();
    }
    if (range) range.addEventListener("input", function () { cancelAnimationFrame(playing); playing = 0; setTime(+range.value, true); });
    var playBtn = $("[data-time-play]");
    if (playBtn) playBtn.addEventListener("click", function () {
      if (playing) { cancelAnimationFrame(playing); playing = 0; return; }
      var t0 = performance.now(), dur = 7000, lastV = -1;
      range.value = 0; setTime(0, true);
      var step = function (now) {
        var v = Math.min(100, Math.round((now - t0) / dur * 100));
        if (v !== lastV) { lastV = v; range.value = v; setTime(v, true); }
        playing = v < 100 ? requestAnimationFrame(step) : 0;
      };
      playing = requestAnimationFrame(step);
    });
    window.addEventListener("resize", drawGrowth);
    brain.refresh = (function (orig) { return function (o) { if (at != null) { brain.setState(BB.brainState(at), o); return; } orig(o); }; })(brain.refresh);

    if (location.hash.length > 1) fromHash(); else paint();
  }

  // ═════════════════════════════ FOCUS ═════════════════════════════
  function focusPage() {
    var root = $("[data-focus-root]");
    var CIRC = 2 * Math.PI * 116;
    var PRESETS = { focus: [15, 25, 45, 60, 90], short: [5, 10], long: [15, 20, 30] };
    var dur = { focus: BB.load("bb-dur-focus", 25), short: BB.load("bb-dur-short", 5), long: BB.load("bb-dur-long", 15) };
    var mode = "focus", lastFail = 0;
    var domSel = $("[data-focus-domain-select]"), taskSel = $("[data-focus-task-select]"), strict = $("[data-strict]");
    var ring = $("[data-ring]"), timeEl = $("[data-focus-time]"), statusEl = $("[data-focus-status]"), subEl = $("[data-focus-sub]");
    var growLabel = $("[data-grow-label]");

    var lastLesson = BB.load("bb-last", null);
    var defaultDomain = BB.load("bb-focus-domain", lastLesson ? BB.domainOfLesson(lastLesson.id) : "devops");
    domSel.innerHTML = DATA.domains.filter(function (d) { return !d.soon; }).map(function (d) {
      return '<option value="' + d.id + '"' + (d.id === defaultDomain ? " selected" : "") + ">" + esc(d.name) + "</option>";
    }).join("");
    domSel.addEventListener("change", function () { BB.save("bb-focus-domain", domSel.value); });
    strict.checked = !!BB.load("bb-strict", false);
    strict.addEventListener("change", function () { BB.save("bb-strict", strict.checked); });

    function fillTasks() {
      var cur = taskSel.value;
      var open = BB.tasks.all().filter(function (t) { return !t.done; }).slice(0, 60);
      taskSel.innerHTML = '<option value="">No task</option>' + open.map(function (t) { return '<option value="' + t.id + '">' + esc(t.title) + "</option>"; }).join("");
      var qs = new URLSearchParams(location.search).get("task");
      taskSel.value = cur || qs || "";
    }
    fillTasks();
    taskSel.addEventListener("change", function () {
      var t = BB.tasks.get(taskSel.value);
      if (t && t.lesson) domSel.value = BB.domainOfLesson(t.lesson);
    });

    $$("[data-mode]").forEach(function (b) {
      b.addEventListener("click", function () { if (BB.focus.get()) return; mode = b.getAttribute("data-mode"); render(); });
    });

    function renderDurations() {
      var el = $("[data-durations]");
      el.innerHTML = PRESETS[mode].map(function (m) { return '<button data-min="' + m + '"' + (dur[mode] === m ? ' class="is-active"' : "") + ">" + m + "m</button>"; }).join("") +
        '<input type="number" min="1" max="240" value="' + dur[mode] + '" aria-label="Custom minutes" data-custom>';
      $$("[data-min]", el).forEach(function (b) { b.addEventListener("click", function () { setDur(+b.getAttribute("data-min")); }); });
      $("[data-custom]", el).addEventListener("change", function (e) { var v = Math.max(1, Math.min(240, +e.target.value || 25)); setDur(v); });
    }
    function setDur(m) { dur[mode] = m; BB.save("bb-dur-" + mode, m); render(); }

    function renderActions() {
      var a = BB.focus.get(), el = $("[data-focus-actions]");
      var html;
      if (!a) html = '<button class="btn ' + (mode === "focus" ? "btn-red" : "btn-primary") + '" data-act="start">' + I.play + (mode === "focus" ? "Start focus" : "Start break") + "</button>";
      else if (a.mode !== "focus") html = '<button class="btn btn-ghost" data-act="skip">Skip break</button>';
      else if (a.pausedAt) html = '<button class="btn btn-primary" data-act="resume">' + I.play + 'Resume</button><button class="btn btn-danger" data-act="giveup">Give up</button>';
      else html = (a.strict ? "" : '<button class="btn btn-ghost" data-act="pause">Pause</button>') + '<button class="btn btn-danger" data-act="giveup">Give up</button>';
      el.innerHTML = html;
      $$("[data-act]", el).forEach(function (b) {
        b.addEventListener("click", function () {
          var act = b.getAttribute("data-act");
          if (act === "start") {
            var t = BB.tasks.get(taskSel.value);
            BB.focus.start({ min: dur[mode], mode: mode, domain: domSel.value, task: taskSel.value || null, strict: mode === "focus" && strict.checked,
                             label: t ? t.title : mode === "focus" ? BB.domain(domSel.value).name : "Break" });
          } else if (act === "pause") BB.focus.pause();
          else if (act === "resume") BB.focus.resume();
          else if (act === "skip") BB.focus.finish("done", true);
          else if (act === "giveup") {
            var n = BB.focus.neurons();
            if (confirm(n ? "Give up? The " + n + " neurons growing right now will wither." : "Give up this session?")) BB.focus.finish("failed");
          }
          render();
        });
      });
    }

    function renderClock() {
      var a = BB.focus.get();
      var total = a ? a.dur * 1000 : dur[mode] * 60000;
      var rem = a ? BB.focus.remaining(a) : total;
      var frac = a ? Math.min(1, BB.focus.elapsed(a) / total) : 0;
      ring.style.strokeDashoffset = CIRC * (1 - frac);
      timeEl.textContent = BB.fmtClock(rem);
      var m = a ? a.mode : mode;
      root.classList.toggle("is-break", m !== "focus");
      root.classList.toggle("is-failed", !a && Date.now() - lastFail < 6000);
      root.setAttribute("data-state", !a ? "idle" : a.pausedAt ? "paused" : "running");
      if (!a) {
        statusEl.textContent = Date.now() - lastFail < 6000 ? "Withered" : mode === "focus" ? "Ready" : "Break";
        subEl.textContent = mode === "focus" ? "~" + Math.floor(dur.focus / 2) + " neurons on completion" : "Rest your neurons";
      } else {
        statusEl.textContent = a.pausedAt ? "Paused" : a.mode === "focus" ? "Focusing" : "On a break";
        subEl.textContent = a.mode === "focus" ? "+" + BB.focus.neurons(a) + " neurons growing" : "Recharging";
      }
      document.title = a ? BB.fmtClock(rem) + " · " + (a.mode === "focus" ? "Focus" : "Break") + " · BLACKBOX" : "Focus · BLACKBOX";
      if (growLabel) {
        var d = a ? BB.domain(a.domain) : null;
        growLabel.className = "mono-label" + (a && a.mode === "focus" ? " growing" : !a && Date.now() - lastFail < 6000 ? " withered" : "");
        growLabel.textContent = a && a.mode === "focus" ? "Growing " + BB.focus.neurons(a) + " new neurons in " + d.name + (a.strict ? " · deep focus" : "")
          : !a && Date.now() - lastFail < 6000 ? "Session abandoned — new growth withered" : "Idle — start a session to grow neurons";
      }
    }

    function render() {
      var a = BB.focus.get();
      if (a) mode = a.mode;
      $$("[data-mode]").forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-mode") === mode); });
      if (a) { domSel.value = a.mode === "focus" ? a.domain : domSel.value; if (a.task) taskSel.value = a.task; strict.checked = a.strict || strict.checked; }
      renderDurations(); renderActions(); renderClock(); renderStats();
    }

    function renderStats() {
      var sessions = BB.sessions(), done = sessions.filter(function (s) { return s.status === "done"; });
      var today = BB.dayKey(), todays = done.filter(function (s) { return BB.dayKey(s.start) === today; });
      var act = BB.activity(), focusStreak = BB.streaks(function (k) { return (act[k] || {}).focus >= 1; });
      var totalMin = done.reduce(function (m, s) { return m + s.min; }, 0);
      var failed = sessions.filter(function (s) { return s.status === "failed"; }).length;
      $("[data-focus-stats]").innerHTML =
        stat("Today", BB.fmtMin(todayFocusMin()), todays.length + " sessions", "var(--red)", I.focus) +
        stat("Focus streak", focusStreak.current + "<small>days</small>", "Best " + focusStreak.best, "#fbbf24", I.flame) +
        stat("All time", BB.fmtMin(totalMin), done.length + " sessions", "var(--blue)", I.cal) +
        stat("Withered", failed, failed ? "Deep focus is hard. Keep going." : "No abandoned sessions", "#a06bff", I.brain);
      // week bars
      var days = [], max = 1;
      for (var i = 6; i >= 0; i--) {
        var k = BB.addDays(today, -i), m = (act[k] || {}).focus || 0;
        if (k === today) m = todayFocusMin();
        days.push([k, m]); max = Math.max(max, m);
      }
      $("[data-week-total]").textContent = BB.fmtMin(days.reduce(function (s, d) { return s + d[1]; }, 0)) + " total";
      $("[data-week-bars]").innerHTML = days.map(function (d) {
        return '<div class="bar' + (d[0] === today ? " today" : "") + '"><em>' + (d[1] ? Math.round(d[1]) : "") + '</em><i style="height:' + Math.max(2, d[1] / max * 100) + '%"></i><span>' +
          BB.parseDay(d[0]).toLocaleDateString(undefined, { weekday: "narrow" }) + "</span></div>";
      }).join("");
      var recent = sessions.slice(-14).reverse();
      $("[data-session-list]").innerHTML = recent.length ? recent.map(function (s) {
        var d = BB.domain(s.domain);
        return '<li style="--c:' + d.color + '"><span class="s-dot' + (s.status === "failed" ? " failed" : "") + '"></span><span class="s-name">' + esc(s.label || d.name) +
          '</span><span class="s-meta">' + (s.status === "failed" ? "withered · " : "") + BB.fmtMin(s.min) + " · " + new Date(s.start).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) + "</span></li>";
      }).join("") : '<li class="empty">No sessions yet — your first one grows your first neurons.</li>';
    }

    mountBrain($('[data-brain="focus"]'), { interactive: true, fill: 0.9, speed: 0.1 });
    BB.on(function (w, detail) {
      if (w === "tick") renderClock();
      else if (w === "focus") render();
      else if (w === "session") {
        if (detail && detail.status === "failed") lastFail = Date.now();
        if (detail && detail.status === "done" && detail.session && detail.session.mode === "focus") {
          var n = BB.sessions().filter(function (s) { return s.status === "done" && BB.dayKey(s.start) === BB.dayKey(); }).length;
          mode = n % 4 === 0 ? "long" : "short";
        } else if (detail && detail.session && detail.session.mode !== "focus") mode = "focus";
        render();
      } else if (w === "tasks") fillTasks();
    });
    document.addEventListener("keydown", function (e) {
      if (e.code !== "Space" || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName)) return;
      e.preventDefault();
      var a = BB.focus.get();
      var btn = $(!a ? '[data-act="start"]' : a.pausedAt ? '[data-act="resume"]' : '[data-act="pause"]');
      if (btn) btn.click();
    });
    render();
  }

  // ═════════════════════════════ TASKS ═════════════════════════════
  function tasksPage() {
    var root = $("[data-tasks-root]"), side = $("[data-tasks-side]"), view = $("[data-tasks-view]"), detail = $("[data-task-detail]");
    var SMART = [
      { id: "today", name: "Today", icon: I.sun, lc: "var(--blue)" },
      { id: "next7", name: "Next 7 days", icon: I.cal, lc: "#a06bff" },
      { id: "inbox", name: "Inbox", icon: I.inbox, lc: "var(--text-3)" },
      { id: "all", name: "All tasks", icon: I.list, lc: "var(--text-3)" },
      { id: "done", name: "Completed", icon: I.done, lc: "var(--ok)" }
    ];
    var LIST_COLORS = ["#5b8cff", "#ff4d5e", "#a78bfa", "#2dd4bf", "#fbbf24", "#f472b6", "#a3e635", "#38bdf8"];
    var state = { list: BB.load("bb-tasks-list", "today"), view: BB.load("bb-tasks-view", "list"), sel: null };
    var PRIO = ["None", "Low", "Medium", "High"];

    function lists() { return BB.tasks.lists(); }
    function listById(id) { return lists().find(function (l) { return l.id === id; }); }
    function filterFor(id, all) {
      var today = BB.dayKey(), wk = BB.addDays(today, 7);
      return all.filter(function (t) {
        if (id === "done") return t.done;
        if (t.done) return false;
        if (id === "today") return t.due && t.due <= today;
        if (id === "next7") return t.due && t.due <= wk;
        if (id === "inbox") return t.list === "inbox";
        if (id === "all") return true;
        return t.list === id;
      });
    }
    function sortTasks(a) {
      return a.sort(function (x, y) {
        if (x.done !== y.done) return x.done ? 1 : -1;
        if (x.done) return (y.doneAt || 0) - (x.doneAt || 0);
        return (y.prio - x.prio) || ((x.due || "9999") < (y.due || "9999") ? -1 : (x.due || "9999") > (y.due || "9999") ? 1 : 0) || (y.created - x.created);
      });
    }

    // ── sidebar ──
    function renderSide() {
      var all = BB.tasks.all();
      var btn = function (id, name, icon, lc, count, custom) {
        return '<button class="list-btn' + (state.list === id ? " is-active" : "") + '" data-list="' + id + '" style="--lc:' + lc + '">' + (icon || '<span class="l-dot"></span>') +
          '<span class="l-name">' + esc(name) + '</span><span class="l-count">' + (count || "") + "</span></button>";
      };
      side.innerHTML = '<div class="side-group">Smart lists</div>' +
        SMART.map(function (s) { return btn(s.id, s.name, s.icon, s.lc, s.id === "done" ? "" : filterFor(s.id, all).length); }).join("") +
        '<div class="side-group">Lists</div>' +
        lists().map(function (l) { return btn(l.id, l.name, "", l.color, filterFor(l.id, all).length, true); }).join("") +
        '<form class="add-list" data-add-list><input type="text" placeholder="+ New list" aria-label="New list name" maxlength="40"></form>';
      $$("[data-list]", side).forEach(function (b) { b.addEventListener("click", function () { setList(b.getAttribute("data-list")); }); });
      $("[data-add-list]", side).addEventListener("submit", function (e) {
        e.preventDefault();
        var name = e.target.querySelector("input").value.trim();
        if (!name) return;
        var l = lists(), id = "l-" + BB.uid();
        l.push({ id: id, name: name, color: LIST_COLORS[l.length % LIST_COLORS.length] });
        BB.tasks.saveLists(l); setList(id);
      });
      // mobile list picker
      var mob = $("[data-mobile-lists]");
      if (!mob) {
        mob = document.createElement("select");
        mob.className = "mobile-lists"; mob.setAttribute("data-mobile-lists", ""); mob.setAttribute("aria-label", "List");
        $(".tasks-head").after(mob);
        mob.addEventListener("change", function () { setList(mob.value); });
      }
      mob.innerHTML = SMART.map(function (s) { return '<option value="' + s.id + '">' + s.name + "</option>"; }).join("") +
        '<optgroup label="Lists">' + lists().map(function (l) { return '<option value="' + l.id + '">' + esc(l.name) + "</option>"; }).join("") + "</optgroup>";
      mob.value = state.list;
    }
    function setList(id) { state.list = id; BB.save("bb-tasks-list", id); renderAll(); }

    // ── task row ──
    function row(t) {
      var l = t.list === "inbox" ? null : listById(t.list), today = BB.dayKey();
      var dueCls = t.due ? (t.due < today && !t.done ? " overdue" : t.due === today ? " today" : "") : "";
      var subDone = (t.sub || []).filter(function (s) { return s.done; }).length;
      var meta = (t.due ? '<span class="due' + dueCls + '">' + I.cal + dueLabel(t.due) + "</span>" : "") +
        (l && state.list !== l.id ? '<span class="t-list" style="--lc:' + l.color + '"><i></i>' + esc(l.name) + "</span>" : "") +
        (t.lesson ? '<a class="t-lesson" href="' + ROOT + t.lesson + '/index.html" data-stop>' + I.book + "Lesson</a>" : "") +
        ((t.sub || []).length ? "<span>" + subDone + "/" + t.sub.length + " subtasks</span>" : "") +
        (t.pomos ? "<span>" + I.tomato + t.pomos + "</span>" : "");
      return '<li class="task' + (t.done ? " done" : "") + (state.sel === t.id ? " is-selected" : "") + '" data-id="' + t.id + '" draggable="true">' +
        '<button class="check p' + t.prio + (t.done ? " is-done" : "") + '" data-check aria-label="' + (t.done ? "Mark as not done" : "Complete") + '">' + I.check + "</button>" +
        '<div class="t-body"><span class="t-title">' + esc(t.title) + "</span>" + (meta ? '<span class="t-meta">' + meta + "</span>" : "") + "</div>" +
        '<div class="t-act"><button class="play" data-play title="Focus on this">' + I.play + '</button><button data-del title="Delete">' + I.trash + "</button></div></li>";
    }
    function bindRows(scope) {
      $$(".task", scope).forEach(function (li) {
        var id = li.getAttribute("data-id");
        li.addEventListener("click", function (e) {
          if (e.target.closest("[data-check],[data-play],[data-del],[data-stop]")) return;
          state.sel = id; root.classList.add("has-detail"); renderView(); renderDetail(true);
        });
        $("[data-check]", li).addEventListener("click", function () {
          var t = BB.tasks.get(id);
          if (!t.done) $("[data-check]", li).classList.add("is-done");
          setTimeout(function () { BB.tasks.update(id, { done: !t.done, doneAt: t.done ? null : Date.now() }); if (!t.done) BB.toast("Completed · " + t.title, "var(--ok)"); }, t.done ? 0 : 220);
        });
        var play = $("[data-play]", li);
        if (play) play.addEventListener("click", function () { startFocus(id); });
        var del = $("[data-del]", li);
        if (del) del.addEventListener("click", function () { removeTask(id); });
        li.addEventListener("dragstart", function (e) { e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "move"; li.classList.add("dragging"); });
        li.addEventListener("dragend", function () { li.classList.remove("dragging"); });
      });
    }
    function startFocus(id) {
      var t = BB.tasks.get(id);
      if (!BB.focus.get()) BB.focus.start({ min: BB.load("bb-dur-focus", 25), domain: t.lesson ? BB.domainOfLesson(t.lesson) : BB.load("bb-focus-domain", "devops"),
                                            task: id, label: t.title, strict: BB.load("bb-strict", false) });
      location.href = ROOT + "focus/index.html";
    }
    function removeTask(id) {
      var t = BB.tasks.get(id);
      BB.tasks.remove(id);
      if (state.sel === id) closeDetail();
      BB.toast("Deleted · " + (t ? t.title : "task"), "var(--red)");
    }
    function dropZone(el, onDrop) {
      el.addEventListener("dragover", function (e) { e.preventDefault(); el.classList.add("drop"); });
      el.addEventListener("dragleave", function (e) { if (!el.contains(e.relatedTarget)) el.classList.remove("drop"); });
      el.addEventListener("drop", function (e) { e.preventDefault(); el.classList.remove("drop"); var id = e.dataTransfer.getData("text/plain"); if (id) onDrop(id); });
    }

    // ── views ──
    function renderView() {
      var all = BB.tasks.all(), items = sortTasks(filterFor(state.list, all));
      var smart = SMART.find(function (s) { return s.id === state.list; }), l = listById(state.list);
      $("[data-list-title]").textContent = smart ? smart.name : l ? l.name : "Tasks";
      $("[data-list-kicker]").textContent = smart ? "Smart list" : "List";
      $$("[data-view]").forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-view") === state.view); });
      var today = BB.dayKey();

      if (state.view === "matrix") {
        var Q = [
          { p: 3, name: "Urgent & important", sub: "Do first", c: "var(--prio-3)" },
          { p: 2, name: "Important, not urgent", sub: "Schedule", c: "var(--prio-2)" },
          { p: 1, name: "Urgent, not important", sub: "Delegate", c: "var(--prio-1)" },
          { p: 0, name: "Neither", sub: "Eliminate", c: "var(--text-3)" }
        ];
        var open = items.filter(function (t) { return !t.done; });
        view.innerHTML = '<div class="matrix">' + Q.map(function (q) {
          var qs = open.filter(function (t) { return t.prio === q.p; });
          return '<div class="quad" data-q="' + q.p + '" style="--qc:' + q.c + '"><div class="quad-head"><b>' + q.name + "</b><span>" + q.sub + "</span><em>" + qs.length + '</em></div><ul class="task-list">' +
            qs.map(row).join("") + "</ul></div>";
        }).join("") + "</div>";
        $$(".quad", view).forEach(function (qd) { dropZone(qd, function (id) { BB.tasks.update(id, { prio: +qd.getAttribute("data-q") }); }); });
      } else if (state.view === "week") {
        var base = state.list === "done" ? BB.tasks.all().filter(function (t) { return !t.done; }) : filterFor(["today", "next7", "inbox", "all"].indexOf(state.list) >= 0 ? "all" : state.list, all);
        var html = '<div class="week">';
        for (var i = 0; i < 7; i++) {
          var k = BB.addDays(today, i), dt = BB.parseDay(k);
          var dayTasks = sortTasks(base.filter(function (t) { return i === 0 ? t.due && t.due <= k : t.due === k; }));
          html += '<div class="day' + (i === 0 ? " today" : "") + '" data-day="' + k + '"><div class="day-head"><b>' + (i === 0 ? "Today" : dt.toLocaleDateString(undefined, { weekday: "short" })) +
            "</b><span>" + dt.getDate() + '</span></div><ul class="task-list">' + dayTasks.map(row).join("") + "</ul></div>";
        }
        view.innerHTML = html + "</div>";
        $$(".day", view).forEach(function (d) { dropZone(d, function (id) { BB.tasks.update(id, { due: d.getAttribute("data-day") }); }); });
      } else {
        if (!items.length) {
          view.innerHTML = '<div class="empty panel">' + (state.list === "done" ? "Nothing completed yet." : "All clear. Add a task above, or save lessons from any lesson page with <b>Add to tasks</b>.") + "</div>";
        } else {
          var groups = [];
          if (state.list === "done") groups = [["Completed", items]];
          else {
            var over = [], tod = [], tom = [], later = [], none = [];
            items.forEach(function (t) {
              if (!t.due) none.push(t);
              else if (t.due < today) over.push(t);
              else if (t.due === today) tod.push(t);
              else if (t.due === BB.addDays(today, 1)) tom.push(t);
              else later.push(t);
            });
            groups = [["Overdue", over, "overdue"], ["Today", tod], ["Tomorrow", tom], ["Upcoming", later], ["No date", none]];
          }
          if (state.list !== "done" && !SMART.some(function (s) { return s.id === state.list && s.id !== "inbox"; })) {
            var doneHere = sortTasks(all.filter(function (t) { return t.done && (state.list === "inbox" ? t.list === "inbox" : t.list === state.list); }));
            if (doneHere.length) groups.push(["Completed", doneHere, "", true]);
          }
          view.innerHTML = groups.filter(function (g) { return g[1].length; }).map(function (g) {
            return '<details class="task-group"' + (g[3] ? "" : " open") + '><summary class="' + (g[2] || "") + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 6 6 6-6 6"/></svg>' + g[0] + " · " + g[1].length + '</summary><ul class="task-list">' + g[1].map(row).join("") + "</ul></details>";
          }).join("");
        }
      }
      bindRows(view);
    }

    // ── detail panel ──
    function closeDetail() { state.sel = null; detail.hidden = true; root.classList.remove("has-detail"); renderView(); }
    function renderDetail(force) {
      var t = state.sel && BB.tasks.get(state.sel);
      if (!t) { detail.hidden = true; root.classList.remove("has-detail"); return; }
      if (!force && detail.contains(document.activeElement)) return;
      detail.hidden = false;
      var l = listById(t.list);
      detail.innerHTML =
        '<div class="detail-top"><button class="check p' + t.prio + (t.done ? " is-done" : "") + '" data-d-check aria-label="Toggle done">' + I.check + '</button><span class="mono-label">' +
        (l ? esc(l.name) : "Inbox") + (t.done ? " · done" : "") + '</span><button class="icon-btn" data-d-close aria-label="Close">' + I.x + "</button></div>" +
        '<input class="detail-title" type="text" value="' + esc(t.title) + '" data-d-title aria-label="Title">' +
        '<div><span class="mono-label">Priority</span><div class="prio-pick" style="margin-top:8px">' + PRIO.map(function (p, i) {
          return '<button data-p="' + i + '"' + (t.prio === i ? ' class="is-active"' : "") + ">" + p + "</button>";
        }).join("") + "</div></div>" +
        '<div class="detail-row"><label class="field"><span class="mono-label">Due</span><input type="date" value="' + (t.due || "") + '" data-d-due></label>' +
        '<label class="field"><span class="mono-label">List</span><select data-d-list><option value="inbox">Inbox</option>' +
        lists().map(function (x) { return '<option value="' + x.id + '"' + (x.id === t.list ? " selected" : "") + ">" + esc(x.name) + "</option>"; }).join("") + "</select></label></div>" +
        '<label class="field"><span class="mono-label">Notes</span><textarea rows="5" placeholder="Details, links, thoughts…" data-d-notes>' + esc(t.notes) + "</textarea></label>" +
        '<div><span class="mono-label">Subtasks</span><ul class="subtasks" style="margin:8px 0">' + (t.sub || []).map(function (s, i) {
          return '<li class="' + (s.done ? "done" : "") + '"><button class="check' + (s.done ? " is-done" : "") + '" data-sub="' + i + '">' + I.check + "</button><span>" + esc(s.title) +
            '</span><button class="x" data-sub-del="' + i + '" aria-label="Remove">' + I.x + "</button></li>";
        }).join("") + '</ul><input type="text" placeholder="+ Add subtask" data-sub-add></div>' +
        (t.lesson ? '<a class="btn btn-ghost sm" href="' + ROOT + t.lesson + '/index.html">' + I.book + "Open lesson</a>" : "") +
        (t.pomos ? '<p class="mono-label">' + t.pomos + " focus session" + (t.pomos === 1 ? "" : "s") + " on this task</p>" : "") +
        '<div class="detail-foot"><button class="btn btn-red" data-d-play>' + I.play + 'Focus</button><button class="btn btn-danger" data-d-del>' + I.trash + "Delete</button></div>";

      var up = function (patch) { BB.tasks.update(t.id, patch); };
      $("[data-d-close]", detail).addEventListener("click", closeDetail);
      $("[data-d-check]", detail).addEventListener("click", function () { up({ done: !t.done, doneAt: t.done ? null : Date.now() }); renderDetail(true); });
      var timer;
      $("[data-d-title]", detail).addEventListener("input", function (e) { clearTimeout(timer); timer = setTimeout(function () { up({ title: e.target.value.trim() || "Untitled" }); }, 250); });
      $("[data-d-notes]", detail).addEventListener("input", function (e) { clearTimeout(timer); timer = setTimeout(function () { up({ notes: e.target.value }); }, 300); });
      $$("[data-p]", detail).forEach(function (b) { b.addEventListener("click", function () { up({ prio: +b.getAttribute("data-p") }); renderDetail(true); }); });
      $("[data-d-due]", detail).addEventListener("change", function (e) { up({ due: e.target.value || null }); });
      $("[data-d-list]", detail).addEventListener("change", function (e) { up({ list: e.target.value }); renderDetail(true); });
      $$("[data-sub]", detail).forEach(function (b) { b.addEventListener("click", function () { var s = t.sub.slice(); s[+b.getAttribute("data-sub")].done = !s[+b.getAttribute("data-sub")].done; up({ sub: s }); renderDetail(true); }); });
      $$("[data-sub-del]", detail).forEach(function (b) { b.addEventListener("click", function () { var s = t.sub.slice(); s.splice(+b.getAttribute("data-sub-del"), 1); up({ sub: s }); renderDetail(true); }); });
      $("[data-sub-add]", detail).addEventListener("keydown", function (e) {
        if (e.key !== "Enter" || !e.target.value.trim()) return;
        up({ sub: (t.sub || []).concat([{ title: e.target.value.trim(), done: false }]) });
        renderDetail(true); $("[data-sub-add]", detail).focus();
      });
      $("[data-d-play]", detail).addEventListener("click", function () { startFocus(t.id); });
      $("[data-d-del]", detail).addEventListener("click", function () { removeTask(t.id); });
    }

    // ── quick add with natural-language parsing ──
    var DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    function parse(text) {
      var out = { title: text, due: null, prio: null, list: null, listName: null }, s = " " + text + " ", m;
      var today = BB.dayKey();
      var take = function (re, fn) { m = s.match(re); if (m) { fn(m); s = s.replace(m[0], " "); } };
      take(/\s!(high|hi|h|3|medium|med|m|2|low|lo|l|1|none|0)(?=\s)/i, function (m) {
        var v = m[1].toLowerCase(); out.prio = /^(high|hi|h|3)$/.test(v) ? 3 : /^(medium|med|m|2)$/.test(v) ? 2 : /^(low|lo|l|1)$/.test(v) ? 1 : 0;
      });
      take(/\s#([\w-]+)(?=\s)/, function (m) {
        var name = m[1].toLowerCase(), hit = lists().find(function (l) { return l.name.toLowerCase().replace(/\s+/g, "").indexOf(name.replace(/-/g, "")) === 0; });
        if (hit) out.list = hit.id; else out.listName = m[1];
      });
      take(/\s(today|tod|tonight)(?=\s)/i, function () { out.due = today; });
      take(/\s(tomorrow|tmr|tmrw)(?=\s)/i, function () { out.due = BB.addDays(today, 1); });
      take(/\snext week(?=\s)/i, function () { out.due = BB.addDays(today, 7); });
      take(/\sin (\d{1,3}) days?(?=\s)/i, function (m) { out.due = BB.addDays(today, +m[1]); });
      take(/\s(\d{4}-\d{2}-\d{2})(?=\s)/, function (m) { out.due = m[1]; });
      take(/\s(?:on )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*(?=\s)/i, function (m) {
        var target = DAYS.indexOf(m[1].toLowerCase()), cur = new Date().getDay(), delta = (target - cur + 7) % 7 || 7;
        out.due = BB.addDays(today, delta);
      });
      out.title = s.replace(/\s+/g, " ").trim();
      return out;
    }
    var qa = $("[data-quick-add]"), qaIn = $("input", qa), chips = $("[data-qa-chips]");
    qaIn.addEventListener("input", function () {
      var p = parse(qaIn.value);
      chips.innerHTML = (p.due ? '<span class="qa-chip">' + dueLabel(p.due) + "</span>" : "") +
        (p.prio ? '<span class="qa-chip p' + p.prio + '">!' + PRIO[p.prio] + "</span>" : "") +
        (p.list ? '<span class="qa-chip">#' + esc(listById(p.list).name) + "</span>" : p.listName ? '<span class="qa-chip">#' + esc(p.listName) + " (new)</span>" : "");
    });
    qa.addEventListener("submit", function (e) {
      e.preventDefault();
      var p = parse(qaIn.value);
      if (!p.title) return;
      if (p.listName) {
        var l = lists(), id = "l-" + BB.uid();
        l.push({ id: id, name: p.listName, color: LIST_COLORS[l.length % LIST_COLORS.length] });
        BB.tasks.saveLists(l); p.list = id;
      }
      var custom = !SMART.some(function (s) { return s.id === state.list; });
      BB.tasks.add({
        title: p.title,
        prio: p.prio == null ? 0 : p.prio,
        list: p.list || (custom ? state.list : "inbox"),
        due: p.due || ((state.list === "today" || state.list === "next7") ? BB.dayKey() : null)
      });
      qaIn.value = ""; chips.innerHTML = "";
    });

    $$("[data-view]").forEach(function (b) {
      b.addEventListener("click", function () { state.view = b.getAttribute("data-view"); BB.save("bb-tasks-view", state.view); renderView(); });
    });
    document.addEventListener("keydown", function (e) {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "n" || e.key === "N") { e.preventDefault(); qaIn.focus(); }
      if (e.key === "Escape" && state.sel) closeDetail();
    });

    function renderAll() { renderSide(); renderView(); renderDetail(false); }
    BB.on(function (w) { if (w === "tasks") renderAll(); });
    renderAll();
  }

  // ═════════════════════════════ HABITS ═════════════════════════════
  function habitsPage() {
    function render() {
      var act = BB.activity(), today = BB.dayKey();
      var streak = BB.learningStreak();
      var activeDays = 0;
      for (var i = 0; i < 365; i++) { var a = act[BB.addDays(today, -i)]; if (a && (a.lessons || a.focus >= 1 || a.habit)) activeDays++; }
      var focusMin = BB.sessions().reduce(function (m, s) { return m + (s.status === "done" ? s.min : 0); }, 0);
      $("[data-habit-stats]").innerHTML =
        stat("Current streak", streak.current + "<small>days</small>", "Learn, focus or check in daily", "var(--red)", I.flame) +
        stat("Best streak", streak.best + "<small>days</small>", "Personal record", "#fbbf24", I.spark) +
        stat("Active days", activeDays, "In the last year", "var(--blue)", I.cal) +
        stat("Lessons", Object.keys(BB.doneMap()).length, BB.fmtMin(focusMin) + " focused", "#a06bff", I.book);

      // heatmap: 26 weeks, columns start on Sunday
      var start = BB.addDays(today, -(25 * 7 + BB.parseDay(today).getDay()));
      var cells = "";
      for (var d = 0; d < 26 * 7; d++) {
        var k = BB.addDays(start, d), x = act[k] || { lessons: 0, focus: 0 };
        var score = x.lessons + x.focus / 25 + (x.habit ? 0.5 : 0);
        var lv = score === 0 ? 0 : score < 1 ? 1 : score < 2 ? 2 : score < 4 ? 3 : 4;
        cells += '<i data-l="' + lv + '" class="' + (k === today ? "today" : k > today ? "future" : "") + '" title="' +
          BB.parseDay(k).toDateString() + " · " + x.lessons + " lessons · " + Math.round(x.focus) + ' min focus"></i>';
      }
      $("[data-heatmap]").innerHTML = '<div class="heatmap">' + cells + '</div><div class="heat-legend">Less <i style="background:var(--surface-3)"></i>' +
        '<i style="background:color-mix(in srgb, var(--blue) 30%, var(--surface-3))"></i><i style="background:color-mix(in srgb, var(--blue) 55%, var(--surface-3))"></i>' +
        '<i style="background:color-mix(in srgb, var(--violet) 75%, var(--surface-3))"></i><i style="background:var(--red)"></i> More</div>';
      var hw = $("[data-heatmap]"); hw.scrollLeft = hw.scrollWidth;

      // habits
      var days = [];
      for (var j = 6; j >= 0; j--) days.push(BB.addDays(today, -j));
      $("[data-week-range]").textContent = BB.parseDay(days[0]).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " – today";
      $("[data-habit-list]").innerHTML = habitDefs().map(function (h) {
        var st = BB.streaks(h.on);
        return '<div class="habit" style="--hc:' + h.color + '"><div class="habit-name"><span class="h-icon">' + h.icon + "</span><div><b>" + esc(h.name) + "</b><em>" + h.desc + "</em></div></div>" +
          '<div class="habit-week">' + days.map(function (k) {
            var on = h.on(k);
            return '<div class="hday' + (k === today ? " today" : "") + '"><span>' + BB.parseDay(k).toLocaleDateString(undefined, { weekday: "narrow" }) + '</span><button class="' + (on ? "on" : "") +
              '" data-h="' + h.id + '" data-k="' + k + '"' + (h.auto ? " disabled" : "") + ' aria-label="' + esc(h.name) + " " + k + '">' + I.check + "</button></div>";
          }).join("") + "</div>" +
          '<div class="habit-streak"><b>' + I.flame + st.current + " day" + (st.current === 1 ? "" : "s") + "</b><span>best " + st.best + "</span></div>" +
          (h.auto ? "<span></span>" : '<button class="x" data-h-del="' + h.id + '" aria-label="Delete habit">' + I.trash + "</button>") + "</div>";
      }).join("");
      $$("[data-h]").forEach(function (b) { b.addEventListener("click", function () { toggleHabit(b.getAttribute("data-h"), b.getAttribute("data-k")); }); });
      $$("[data-h-del]").forEach(function (b) {
        b.addEventListener("click", function () {
          if (!confirm("Delete this habit and its history?")) return;
          BB.habits.saveAll(BB.habits.all().filter(function (h) { return h.id !== b.getAttribute("data-h-del"); }));
        });
      });
    }
    $("[data-habit-add]").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = e.target.name.value.trim();
      if (!name) return;
      var all = BB.habits.all();
      all.push({ id: "h-" + BB.uid(), name: name, color: HABIT_COLORS[all.length % HABIT_COLORS.length], checks: {} });
      BB.habits.saveAll(all);
      e.target.reset();
    });
    BB.on(function (w) { if (w === "habits" || w === "progress" || w === "session") render(); });
    render();
  }

  // ═════════════════════════════ TRACKS PAGE ═════════════════════════════
  function tracksPage() {
    // One hub: the program chips switch the pane in place (and the URL hash), nothing navigates away
    // until you open something to learn.
    var chips = $$("[data-program]"), panes = $$("[data-program-pane]");
    var ids = panes.map(function (p) { return p.getAttribute("data-program-pane"); });
    function program(id) {
      if (ids.indexOf(id) < 0) id = BB.load("bb-tracks-program", ids[0]);
      if (ids.indexOf(id) < 0) id = ids[0];
      panes.forEach(function (p) { p.hidden = p.getAttribute("data-program-pane") !== id; });
      chips.forEach(function (c) { c.classList.toggle("is-active", c.getAttribute("data-program") === id); });
      var d = BB.domain(id);
      $("[data-program-title]").textContent = d ? d.name : "Tracks";
      document.title = (d ? d.name : "Tracks") + " · Tracks · BLACKBOX";
      BB.save("bb-tracks-program", id);
      if (location.hash.slice(1) !== id) history.replaceState(null, "", "#" + id);
      if (id === "devops" && window.BB_MINDMAP) setTimeout(function () { window.BB_MINDMAP.resize(); }, 0);
    }
    chips.forEach(function (c) { c.addEventListener("click", function (e) { e.preventDefault(); program(c.getAttribute("data-program")); }); });
    window.addEventListener("hashchange", function () { program(location.hash.slice(1)); });
    program(location.hash.slice(1));

    // DevOps: map / list
    var vpanes = $$("[data-view-pane]"), seg = $$("[data-tracks-view] button");
    function show(v) {
      vpanes.forEach(function (p) { p.hidden = p.getAttribute("data-view-pane") !== v; });
      seg.forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-v") === v); });
      BB.save("bb-tracks-view", v);
      if (v === "map" && window.BB_MINDMAP) window.BB_MINDMAP.resize();
    }
    seg.forEach(function (b) { b.addEventListener("click", function () { show(b.getAttribute("data-v")); }); });
    if (seg.length) show(BB.load("bb-tracks-view", "map"));
    paintPath();
    BB.on(function (w) { if (w === "progress" || w === "session") paintPath(); });

    // DSA: a topic row expands in place to its problems, grouped by subtopic
    $$("[data-expand]").forEach(function (row) {
      row.addEventListener("click", function (e) {
        if (e.target.closest("a")) return;
        var id = row.getAttribute("data-expand"), exp = $('[data-expanded="' + id + '"]'), open = exp.hidden;
        exp.hidden = !open; row.classList.toggle("is-open", open);
        $(".rt-name", row).setAttribute("aria-expanded", open);
        if (!open) return;
        var box = $("[data-inline-rows]", exp);
        if (box.childNodes.length) return;
        box.innerHTML = '<p class="coll-empty">Loading problems…</p>';
        BB.dsaRows(function (rows) {
          var groups = [], by = {};
          Object.keys(rows).forEach(function (pid) {
            if (pid.split("/")[1] !== id) return;
            var r = rows[pid], g = by[r[2]];
            if (!g) { g = by[r[2]] = { name: r[2], rows: [] }; groups.push(g); }
            g.rows.push(r);
          });
          box.innerHTML = groups.map(function (g) {
            return '<h4 class="rt-sub">' + esc(g.name) + "</h4>" +
              '<div class="table-wrap"><table class="pt-table"><thead><tr><th class="pn">#</th><th>Problem</th><th>Difficulty</th><th class="c">Solved</th><th class="c">Bookmark</th>' +
              '<th class="c">Revision</th><th class="c">Pattern</th><th>Practice</th></tr></thead><tbody>' +
              g.rows.map(function (r, i) { return BB.dsaRowHtml(r, i + 1); }).join("") + "</tbody></table></div>";
          }).join("");
          if (BB.paintSheet) BB.paintSheet();
          BB.emit("progress");
        });
      });
    });
  }

  var routes = { home: home, tracks: tracksPage, brain: brainPage, focus: focusPage, tasks: tasksPage, habits: habitsPage };
  if (routes[PAGE]) routes[PAGE]();
})();
