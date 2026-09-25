/* BLACKBOX core: storage, progress, focus engine, tasks store, search, theme, lesson page. */
(function () {
  "use strict";

  var doc = document.documentElement;
  var ROOT = doc.getAttribute("data-root") || "";
  var PAGE = doc.getAttribute("data-page");
  var DATA = window.BB_DATA || { domains: [], tracks: {}, total: 0, aliases: {} };
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var BB = (window.BB = { ROOT: ROOT, PAGE: PAGE, DATA: DATA });

  // ── utils ──────────────────────────────────────────────────────
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  }
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  BB.load = load; BB.save = save; BB.$ = $; BB.$$ = $$; BB.uid = uid; BB.esc = esc; BB.pad = pad;

  var listeners = [];
  BB.on = function (fn) { listeners.push(fn); };
  function emit(what, detail) { listeners.forEach(function (f) { try { f(what, detail); } catch (e) { console.error(e); } }); }
  BB.emit = emit;

  // ── dates ──────────────────────────────────────────────────────
  BB.dayKey = function (d) { d = d == null ? new Date() : new Date(d); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  BB.parseDay = function (k) { var p = k.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); };
  BB.addDays = function (k, n) { var d = BB.parseDay(k); d.setDate(d.getDate() + n); return BB.dayKey(d); };
  BB.diffDays = function (a, b) { return Math.round((BB.parseDay(a) - BB.parseDay(b)) / 864e5); };
  BB.fmtMin = function (m) { m = Math.round(m); return m < 60 ? m + "m" : Math.floor(m / 60) + "h " + pad(m % 60) + "m"; };
  BB.fmtClock = function (ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return pad(Math.floor(s / 60)) + ":" + pad(s % 60); };

  // ── domains ────────────────────────────────────────────────────
  var domainMap = {};
  DATA.domains.forEach(function (d) { domainMap[d.id] = d; });
  BB.domain = function (id) { return domainMap[id] || domainMap[(DATA.aliases || {})[id]] || DATA.domains[0]; };
  BB.domainOfLesson = function (lid) { var t = DATA.tracks[(lid || "").split("/")[0]]; return t ? t.d : "devops"; };

  // ── toast & sound ──────────────────────────────────────────────
  function toast(msg, color) {
    var t = $(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.innerHTML = "<i></i><span></span>"; document.body.appendChild(t); }
    t.style.setProperty("--tc", color || "var(--blue)");
    $("span", t).textContent = msg;
    t.classList.add("show");
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  BB.toast = toast;

  function sound(kind) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      var ctx = BB._ac || (BB._ac = new AC());
      if (ctx.state === "suspended") ctx.resume();
      var notes = kind === "done" ? [523, 659, 784, 1047] : kind === "start" ? [440, 660] : [330, 247, 185];
      notes.forEach(function (f, i) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = kind === "fail" ? "triangle" : "sine";
        o.frequency.value = f;
        var t = ctx.currentTime + i * 0.11;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.09, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0008, t + 0.6);
        o.connect(g); g.connect(ctx.destination);
        o.start(t); o.stop(t + 0.65);
      });
    } catch (e) { /* audio unavailable */ }
  }
  BB.sound = sound;

  function notify(title, body) {
    try { if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body: body, silent: true }); } catch (e) {}
  }

  // ── lesson progress ────────────────────────────────────────────
  var doneAt = load("bb-done-at", null);
  if (!doneAt) {
    doneAt = {};
    load("hc-done", []).forEach(function (id) { doneAt[id] = 0; });
    save("bb-done-at", doneAt);
  }
  BB.doneMap = function () { return doneAt; };
  BB.isDone = function (id) { return Object.prototype.hasOwnProperty.call(doneAt, id); };
  BB.setDone = function (id, on) {
    if (on) doneAt[id] = Date.now(); else delete doneAt[id];
    save("bb-done-at", doneAt);
    if (on) BB.tasks.all().forEach(function (t) { if (t.lesson === id && !t.done) BB.tasks.update(t.id, { done: true, doneAt: Date.now() }); });
    emit("progress");
  };

  // ── focus sessions ─────────────────────────────────────────────
  BB.sessions = function () { return load("bb-sessions", []); };
  function addSession(s) { var a = BB.sessions(); a.push(s); if (a.length > 3000) a = a.slice(-3000); save("bb-sessions", a); }

  var F = (BB.focus = {
    get: function () { return load("bb-focus", null); },
    set: function (a) { save("bb-focus", a); emit("focus"); paintPill(); },
    elapsed: function (a) { a = a || F.get(); if (!a) return 0; return Math.max(0, (a.pausedAt || Date.now()) - a.start - (a.paused || 0)); },
    remaining: function (a) { a = a || F.get(); return a ? a.dur * 1000 - F.elapsed(a) : 0; },
    neurons: function (a) { a = a || F.get(); return a && a.mode === "focus" ? Math.floor(F.elapsed(a) / 120000) : 0; },
    start: function (o) {
      var a = { id: uid(), start: Date.now(), dur: Math.round(o.min * 60), mode: o.mode || "focus", domain: o.domain || "foundations",
                task: o.task || null, strict: !!o.strict, label: o.label || "", paused: 0, pausedAt: null };
      F.set(a);
      sound("start");
      try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch (e) {}
      return a;
    },
    pause: function () { var a = F.get(); if (!a || a.pausedAt || a.strict) return; a.pausedAt = Date.now(); F.set(a); },
    resume: function () { var a = F.get(); if (!a || !a.pausedAt) return; a.paused += Date.now() - a.pausedAt; a.pausedAt = null; F.set(a); },
    finish: function (status, early) {
      var a = F.get();
      if (!a) return null;
      var mins = Math.min(F.elapsed(a), a.dur * 1000) / 60000;
      var grown = F.neurons(a);
      if (a.mode === "focus" && (status === "failed" || mins >= 1 || !early)) {
        addSession({ id: a.id, start: a.start, end: Date.now(), min: status === "done" && !early ? a.dur / 60 : +mins.toFixed(1),
                     domain: a.domain, task: a.task, label: a.label, status: status });
      }
      save("bb-focus", null);
      paintPill();
      var d = BB.domain(a.domain);
      if (status === "done") {
        sound("done");
        if (a.mode === "focus") {
          toast("Session complete · +" + Math.max(grown, Math.floor(mins / 2)) + " neurons in " + d.name, d.color);
          notify("Focus complete", "Neurons wired in " + d.name + ". Take a short break.");
          if (a.task) { var t = BB.tasks.get(a.task); if (t) BB.tasks.update(a.task, { pomos: (t.pomos || 0) + 1 }); }
        } else {
          toast("Break over — ready for another round?", "var(--ok)");
          notify("Break over", "Ready for another focus session?");
        }
      } else {
        sound("fail");
        toast(grown ? grown + " growing neurons withered" : "Session abandoned", "var(--red)");
      }
      emit("session", { status: status, session: a, grown: grown });
      return a;
    }
  });

  // Strict ("deep focus") mode: leaving the site for >10s withers the session.
  function markHidden() {
    var a = F.get();
    if (a && a.strict && a.mode === "focus" && !a.pausedAt) { a.hiddenAt = Date.now(); save("bb-focus", a); }
  }
  function checkHidden() {
    var a = F.get();
    if (!a || !a.hiddenAt) return;
    var away = Date.now() - a.hiddenAt;
    if (away > 10000 && F.remaining(a) > 0) {
      F.finish("failed");
      toast("You left for " + Math.round(away / 1000) + "s — deep focus broken", "var(--red)");
    } else { delete a.hiddenAt; save("bb-focus", a); }
  }
  document.addEventListener("visibilitychange", function () { document.hidden ? markHidden() : checkHidden(); });
  window.addEventListener("pagehide", markHidden);

  // Header pill + completion ticker (works on every page).
  var pill = $("[data-focus-pill]");
  function paintPill() {
    if (!pill) return;
    var a = F.get();
    if (!a || PAGE === "focus") { pill.hidden = true; return; }
    pill.hidden = false;
    pill.classList.toggle("paused", !!a.pausedAt);
    $("[data-focus-pill-time]", pill).textContent = BB.fmtClock(F.remaining(a));
    $("[data-focus-pill-label]", pill).textContent = a.mode === "focus" ? (a.label || BB.domain(a.domain).short) : "Break";
  }
  setInterval(function () {
    var a = F.get();
    if (a && !a.pausedAt && F.remaining(a) <= 0) F.finish("done");
    paintPill();
    emit("tick");
  }, 500);

  // ── tasks store ────────────────────────────────────────────────
  var DEFAULT_LISTS = [
    { id: "reading", name: "Reading list", color: "#5b8cff" },
    { id: "work", name: "Work", color: "#ff4d5e" },
    { id: "personal", name: "Personal", color: "#a78bfa" }
  ];
  BB.tasks = {
    all: function () { return load("bb-tasks", []); },
    saveAll: function (list) { save("bb-tasks", list); emit("tasks"); },
    get: function (id) { return BB.tasks.all().find(function (t) { return t.id === id; }); },
    add: function (t) {
      var task = Object.assign({ id: uid(), title: "", notes: "", list: "inbox", due: null, prio: 0, done: false, doneAt: null,
                                 created: Date.now(), lesson: null, sub: [], pomos: 0 }, t);
      var all = BB.tasks.all(); all.unshift(task); BB.tasks.saveAll(all); return task;
    },
    update: function (id, patch) {
      var all = BB.tasks.all();
      all.forEach(function (t) { if (t.id === id) Object.assign(t, patch); });
      BB.tasks.saveAll(all);
    },
    remove: function (id) { BB.tasks.saveAll(BB.tasks.all().filter(function (t) { return t.id !== id; })); },
    lists: function () { return load("bb-lists", DEFAULT_LISTS); },
    saveLists: function (l) { save("bb-lists", l); emit("tasks"); },
    byLesson: function (lid) { return BB.tasks.all().find(function (t) { return t.lesson === lid; }); }
  };

  // ── habits & activity ──────────────────────────────────────────
  BB.habits = {
    all: function () { return load("bb-habits", []); },
    saveAll: function (h) { save("bb-habits", h); emit("habits"); }
  };
  BB.activity = function () {
    var by = {};
    function day(k) { return by[k] || (by[k] = { lessons: 0, focus: 0 }); }
    Object.keys(doneAt).forEach(function (id) { if (doneAt[id]) day(BB.dayKey(doneAt[id])).lessons++; });
    BB.sessions().forEach(function (s) { if (s.status === "done") day(BB.dayKey(s.start)).focus += s.min; });
    BB.habits.all().forEach(function (h) { Object.keys(h.checks || {}).forEach(function (k) { day(k).habit = true; }); });
    return by;
  };
  BB.streaks = function (isActive) {
    var today = BB.dayKey(), cur = 0, best = 0, run = 0, k;
    k = isActive(today) ? today : BB.addDays(today, -1);
    while (isActive(k)) { cur++; k = BB.addDays(k, -1); }
    for (var i = 400; i >= 0; i--) { if (isActive(BB.addDays(today, -i))) { run++; best = Math.max(best, run); } else run = 0; }
    return { current: cur, best: best };
  };
  BB.learningStreak = function () {
    var act = BB.activity();
    return BB.streaks(function (k) { var a = act[k]; return !!a && (a.lessons > 0 || a.focus >= 1 || a.habit); });
  };

  // ── brain state (consumed by brain.js) ─────────────────────────
  // `at` (ms) rewinds to how the brain looked then; omitted means now, including a running session.
  BB.brainState = function (at) {
    var st = {};
    DATA.domains.forEach(function (d) { st[d.id] = { total: d.total, done: 0, focusMin: 0, pendingMin: 0, soon: d.soon }; });
    Object.keys(doneAt).forEach(function (id) { if (at != null && doneAt[id] > at) return; var d = st[BB.domainOfLesson(id)]; if (d) d.done++; });
    BB.sessions().forEach(function (s) {
      var d = st[BB.domain(s.domain).id];
      if (s.status === "done" && d && (at == null || s.start <= at)) d.focusMin += s.min;
    });
    var a = F.get();
    if (at == null && a && a.mode === "focus" && st[BB.domain(a.domain).id]) st[BB.domain(a.domain).id].pendingMin = F.elapsed(a) / 60000;
    return st;
  };
  // When you started: the first completion or focus session (legacy completions have no time).
  BB.firstActivity = function () {
    var t = Infinity;
    Object.keys(doneAt).forEach(function (id) { if (doneAt[id]) t = Math.min(t, doneAt[id]); });
    BB.sessions().forEach(function (s) { if (s.status === "done") t = Math.min(t, s.start); });
    return t === Infinity ? null : t;
  };

  // ── theme ──────────────────────────────────────────────────────
  function setTheme(t, persist) {
    doc.setAttribute("data-theme", t);
    if (persist) { try { localStorage.setItem("theme", t); } catch (e) {} }
    emit("theme");
  }
  function toggleTheme() { setTheme(doc.getAttribute("data-theme") === "dark" ? "light" : "dark", true); }
  $$("[data-theme-toggle]").forEach(function (b) { b.addEventListener("click", toggleTheme); });
  try {
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", function (e) {
      var stored = null; try { stored = localStorage.getItem("theme"); } catch (err) {}
      if (!stored) setTheme(e.matches ? "light" : "dark", false);
    });
  } catch (e) {}
  if (!isMac) $$("[data-mod-key]").forEach(function (k) { k.textContent = "Ctrl K"; });

  // ── progress painting ──────────────────────────────────────────
  function paintProgress() {
    $$("[data-lesson]").forEach(function (li) { li.classList.toggle("is-done", BB.isDone(li.getAttribute("data-lesson"))); });
    var ids = Object.keys(doneAt);
    $$("[data-progress-prefix]").forEach(function (el) {
      var prefixes = el.getAttribute("data-progress-prefix").split("|");
      var total = +el.getAttribute("data-progress-total") || 1;
      var n = 0;
      ids.forEach(function (id) { for (var i = 0; i < prefixes.length; i++) if (id.indexOf(prefixes[i]) === 0) { n++; break; } });
      n = Math.min(n, total);
      var bar = $(".progress-bar span", el);
      if (bar) bar.style.setProperty("--p", n / total);
      var c = $("[data-progress-count]", el);
      if (c) c.textContent = n;
      el.classList.toggle("is-complete", n >= total);
    });
    $$("[data-nd-track]").forEach(function (el) {
      var pre = el.getAttribute("data-nd-track"), n = 0;
      ids.forEach(function (id) { if (id.indexOf(pre) === 0) n++; });
      el.style.setProperty("--p", Math.min(1, n / (+el.getAttribute("data-nd-total") || 1)));
    });
    $$("[data-topic]").forEach(function (card) {
      var p = $("[data-progress-prefix]", card);
      card.classList.toggle("is-complete", !!(p && p.classList.contains("is-complete")));
    });
    $$("[data-resume]").forEach(function (btn) {
      var prefix = btn.getAttribute("data-resume");
      var items = $$("[data-lesson]", btn.closest("main") || document).filter(function (li) { return li.getAttribute("data-lesson").indexOf(prefix) === 0; });
      var started = items.some(function (li) { return BB.isDone(li.getAttribute("data-lesson")); });
      var next = items.find(function (li) { return !BB.isDone(li.getAttribute("data-lesson")); });
      var label = $("span", btn);
      if (!started || !label) return;
      if (next) { btn.href = $("a", next).getAttribute("href"); label.textContent = "Continue"; }
      else label.textContent = "Review again";
    });
  }
  BB.on(function (w) { if (w === "progress") paintProgress(); });

  window.addEventListener("storage", function (e) {
    if (e.key === "bb-done-at") { doneAt = load("bb-done-at", {}); paintProgress(); syncLessonButtons(); emit("progress"); }
    else if (e.key === "bb-focus") { paintPill(); emit("focus"); }
    else if (e.key === "bb-tasks" || e.key === "bb-lists") emit("tasks");
    else if (e.key === "bb-sessions") emit("session", {});
    else if (e.key === "bb-habits") emit("habits");
    else if (e.key === "theme" && e.newValue) setTheme(e.newValue, false);
  });

  // ── home: continue card ────────────────────────────────────────
  if (PAGE === "home") {
    var last = load("bb-last", load("hc-last", null));
    var card = $("[data-continue]");
    if (last && last.id && card) {
      $("[data-continue-href]").href = ROOT + last.id + "/index.html";
      $("[data-continue-title]").textContent = last.title;
      $("[data-continue-sub]").textContent = last.sub;
      card.hidden = false;
      $("[data-continue-link]").href = ROOT + last.id + "/index.html";
      $("[data-continue-label]").textContent = "Continue learning";
    }
  }

  var expandBtn = $("[data-expand-all]");
  if (expandBtn) expandBtn.addEventListener("click", function () {
    var cards = $$(".topic-card"), open = cards.some(function (c) { return !c.open; });
    cards.forEach(function (c) { c.open = open; });
    expandBtn.textContent = open ? "Collapse all" : "Expand all";
  });

  // Track banner "Focus on this"
  $$("[data-focus-domain]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (!F.get()) F.start({ min: 25, domain: b.getAttribute("data-focus-domain"), label: $("h1").textContent.trim() });
      location.href = ROOT + "focus/index.html";
    });
  });

  // ── lesson page ────────────────────────────────────────────────
  var article = $("article.lesson");
  var completeBtn = $("[data-complete]");
  var addTaskBtn = $("[data-add-task]");
  function syncLessonButtons() {
    if (!article) return;
    var id = article.getAttribute("data-lesson-id");
    if (completeBtn) completeBtn.classList.toggle("is-done", BB.isDone(id));
    if (addTaskBtn) addTaskBtn.classList.toggle("is-on", !!BB.tasks.byLesson(id));
  }
  BB.on(function (w) { if (w === "tasks") syncLessonButtons(); });

  if (article) {
    var lid = article.getAttribute("data-lesson-id");
    var ltitle = article.getAttribute("data-lesson-title");
    var dom = BB.domain(article.getAttribute("data-domain"));
    save("bb-last", { id: lid, title: ltitle, sub: article.getAttribute("data-lesson-sub") });
    syncLessonButtons();

    completeBtn.addEventListener("click", function () {
      if (BB.isDone(lid)) { BB.setDone(lid, false); toast("Marked as not completed"); }
      else {
        BB.setDone(lid, true);
        completeBtn.classList.remove("pop"); void completeBtn.offsetWidth; completeBtn.classList.add("pop");
        toast("Neurons wired in " + dom.name + ($("[data-nav-next]") ? " · press → for next" : ""), dom.color);
      }
      syncLessonButtons();
    });

    addTaskBtn.addEventListener("click", function () {
      var existing = BB.tasks.byLesson(lid);
      if (existing) { BB.tasks.remove(existing.id); toast("Removed from tasks"); }
      else { BB.tasks.add({ title: ltitle, list: "reading", lesson: lid, due: BB.dayKey() }); toast("Added to Reading list · due today", "var(--blue)"); }
    });

    $("[data-focus-lesson]").addEventListener("click", function () {
      if (F.get()) { toast("A focus session is already running"); return; }
      var t = BB.tasks.byLesson(lid);
      F.start({ min: 25, domain: dom.id, label: ltitle, task: t ? t.id : null });
      toast("25-minute focus started — neurons growing in " + dom.short, "var(--red)");
    });

    $$(".prose .codehilite").forEach(function (block) {
      var btn = document.createElement("button");
      btn.className = "copy-btn"; btn.type = "button";
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg><span>Copy</span>';
      btn.addEventListener("click", function () {
        var text = $("pre", block).innerText;
        var ok = function () { btn.classList.add("copied"); $("span", btn).textContent = "Copied"; setTimeout(function () { btn.classList.remove("copied"); $("span", btn).textContent = "Copy"; }, 1500); };
        var fallback = function () {
          var ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); ok(); } catch (e) {} ta.remove();
        };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, fallback); else fallback();
      });
      block.appendChild(btn);
    });

    var bar = $(".read-progress"), ticking = false;
    var onScroll = function () {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () {
        var rect = article.getBoundingClientRect(), total = rect.height - window.innerHeight + 120;
        if (bar) bar.style.setProperty("--read", total > 0 ? Math.min(1, Math.max(0, (120 - rect.top) / total)) : 1);
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();

    var tocLinks = $$("[data-toc-link]");
    if (tocLinks.length && "IntersectionObserver" in window) {
      var heads = tocLinks.map(function (a) { return document.getElementById(a.getAttribute("data-toc-link")); }).filter(Boolean);
      var setActive = function (id) { tocLinks.forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("data-toc-link") === id); }); };
      var io = new IntersectionObserver(function () {
        var current = heads[0].id;
        heads.forEach(function (h) { if (h.getBoundingClientRect().top <= 130) current = h.id; });
        setActive(current);
      }, { rootMargin: "-100px 0px -60% 0px", threshold: [0, 1] });
      heads.forEach(function (h) { io.observe(h); });
      tocLinks.forEach(function (a) {
        a.addEventListener("click", function (e) {
          var el = document.getElementById(a.getAttribute("data-toc-link"));
          if (!el) return;
          e.preventDefault(); el.scrollIntoView({ behavior: "smooth", block: "start" });
          history.replaceState(null, "", "#" + el.id); setActive(el.id);
        });
      });
    }

    $$("[data-drawer-toggle]").forEach(function (b) { b.addEventListener("click", function () { document.body.classList.add("drawer-open"); }); });
    $$("[data-drawer-close]").forEach(function (b) { b.addEventListener("click", function () { document.body.classList.remove("drawer-open"); }); });
    var cur = $(".sidebar .is-current"), sideInner = $(".sidebar-inner");
    if (cur && sideInner && sideInner.scrollHeight > sideInner.clientHeight) sideInner.scrollTop = cur.offsetTop - sideInner.clientHeight / 2;
  }

  // ── DSA / System Design sheets: tick items, filter, per-difficulty counts ──
  if (PAGE === "sheet") {
    document.addEventListener("click", function (e) {
      var b = e.target.closest("[data-toggle-done]");
      if (!b) return;
      var row = b.closest("[data-lesson]"), id = row.getAttribute("data-lesson"), on = !BB.isDone(id);
      BB.setDone(id, on);
      var dom = BB.domain(BB.domainOfLesson(id));
      if (on) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); toast("Neuron wired in " + dom.name, dom.color); }
      paintSheet();
    });
    var filter = "all", hideDone = $("[data-hide-done]");
    var paintSheet = function () {
      var hide = hideDone && hideDone.checked;
      $$(".item[data-lesson]").forEach(function (li) {
        var lvl = li.getAttribute("data-level");
        li.hidden = (filter !== "all" && lvl !== filter) || (hide && BB.isDone(li.getAttribute("data-lesson")));
      });
      $$(".sheet-sub").forEach(function (sec) { sec.hidden = !$$(".item", sec).some(function (li) { return !li.hidden; }); });
      var levels = window.BB_LEVELS;
      if (levels) $$("[data-level-done]").forEach(function (el) {
        var k = el.getAttribute("data-level-done").charAt(0), n = 0;
        Object.keys(levels).forEach(function (id) { if (levels[id] === k && BB.isDone(id)) n++; });
        el.textContent = n;
      });
    };
    $$("[data-sheet-filter] button").forEach(function (b) {
      b.addEventListener("click", function () {
        filter = b.getAttribute("data-f");
        $$("[data-sheet-filter] button").forEach(function (x) { x.classList.toggle("is-active", x === b); });
        paintSheet();
      });
    });
    if (hideDone) {
      hideDone.checked = !!load("bb-sheet-hide-done", false);
      hideDone.addEventListener("change", function () { save("bb-sheet-hide-done", hideDone.checked); paintSheet(); });
    }
    BB.on(function (w) { if (w === "progress") paintSheet(); });
    paintSheet();
    if (location.hash) { var target = document.getElementById(location.hash.slice(1)); if (target) { target.hidden = false; target.classList.add("is-target"); } }
  }

  // ── search palette ─────────────────────────────────────────────
  var palette = null, input, results, items = [], activeIdx = 0, lastFocus = null, prepared = null, indexLoading = false;
  var SVG = function (p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>"; };
  var ICONS = {
    k: SVG('<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>'),
    t: SVG('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
    l: SVG('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>'),
    p: SVG('<path d="m13 2-9 12h8l-1 8 9-12h-8z"/>')
  };
  var GO = SVG('<path d="M9 10 4 15l5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>');
  function norm(s) { return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, ""); }
  function ensureIndex() {
    if (window.SEARCH_INDEX || indexLoading) return;
    indexLoading = true;
    var s = document.createElement("script");
    s.src = ROOT + "assets/search-index.js";
    s.onload = function () { prepared = null; if (palette && !palette.hidden) render(); };
    s.onerror = function () { indexLoading = false; };
    document.head.appendChild(s);
  }
  function prepare() {
    if (prepared) return prepared;
    prepared = (window.SEARCH_INDEX || []).map(function (r) {
      return { title: r[0], href: r[1], track: r[2], topic: r[3], kind: r[4], nt: norm(r[0]), hay: norm(r[0] + " " + r[2] + " " + r[3] + " " + r[5]) };
    });
    return prepared;
  }
  function highlight(title, terms) {
    var out = esc(title);
    terms.forEach(function (t) { if (t.length > 1) out = out.replace(new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"), "<mark>$1</mark>"); });
    return out;
  }
  function search(q) {
    var data = prepare(), terms = norm(q).trim().split(/\s+/).filter(Boolean);
    if (!terms.length) {
      var groups = [["Jump to", data.filter(function (r) { return r.kind === "p"; })], ["Tracks", data.filter(function (r) { return r.kind === "k"; })]];
      var lastL = load("bb-last", null), hit = lastL && data.find(function (r) { return r.href === lastL.id + "/index.html"; });
      if (hit) groups.unshift(["Continue", [hit]]);
      return { groups: groups, terms: [] };
    }
    var scored = [];
    data.forEach(function (r) {
      var s = 0;
      for (var j = 0; j < terms.length; j++) {
        var t = terms[j];
        if (r.hay.indexOf(t) === -1) return;
        var ti = r.nt.indexOf(t);
        if (ti === 0) s += 12; else if (ti > 0) s += r.nt.charAt(ti - 1) === " " ? 8 : 4;
      }
      s += r.kind === "p" ? 7 : r.kind === "k" ? 6 : r.kind === "t" ? 3 : 0;
      scored.push([s - r.title.length / 80, r]);
    });
    scored.sort(function (a, b) { return b[0] - a[0]; });
    var top = scored.slice(0, 40).map(function (x) { return x[1]; });
    return { groups: [["Pages", "p"], ["Tracks", "k"], ["Topics", "t"], ["Lessons", "l"]].map(function (g) {
      return [g[0], top.filter(function (r) { return r.kind === g[1]; })];
    }).filter(function (g) { return g[1].length; }), terms: terms };
  }
  function render() {
    var res = search(input.value), html = "";
    items = [];
    res.groups.forEach(function (g) {
      html += '<div class="palette-group">' + g[0] + "</div>";
      g[1].forEach(function (r) {
        var idx = items.length; items.push(r);
        var sub = r.kind === "l" ? r.track + " › " + r.topic : r.kind === "t" ? r.track : r.kind === "k" ? r.track || "Track" : "BLACKBOX";
        html += '<a class="palette-item" role="option" id="pi-' + idx + '" data-idx="' + idx + '" href="' + ROOT + r.href + '"><span class="pi-icon">' + ICONS[r.kind] +
          '</span><span class="pi-text"><span class="pi-title">' + highlight(r.title, res.terms) + '</span><span class="pi-sub">' + esc(sub) + '</span></span><span class="pi-go">' + GO + "</span></a>";
      });
    });
    if (!items.length) html = window.SEARCH_INDEX ? '<div class="palette-empty">Nothing matches “' + esc(input.value) + "”</div>" : '<div class="palette-empty">Loading index…</div>';
    results.innerHTML = html; results.scrollTop = 0; setActiveItem(0);
  }
  function setActiveItem(i) {
    if (!items.length) return;
    activeIdx = (i + items.length) % items.length;
    $$(".palette-item", results).forEach(function (el) { el.classList.toggle("is-active", +el.getAttribute("data-idx") === activeIdx); });
    var el = $("#pi-" + activeIdx, results);
    if (el) { el.scrollIntoView({ block: "nearest" }); input.setAttribute("aria-activedescendant", el.id); }
  }
  function buildPalette() {
    palette = document.createElement("div");
    palette.className = "palette"; palette.hidden = true;
    palette.setAttribute("role", "dialog"); palette.setAttribute("aria-modal", "true"); palette.setAttribute("aria-label", "Search");
    palette.innerHTML = '<div class="palette-backdrop"></div><div class="palette-box"><div class="palette-input">' + SVG('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>') +
      '<input type="search" placeholder="Search lessons, topics, tracks…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="palette-results"><kbd>Esc</kbd></div>' +
      '<div class="palette-results" id="palette-results" role="listbox"></div><div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div>';
    document.body.appendChild(palette);
    input = $("input", palette); results = $(".palette-results", palette);
    $(".palette-backdrop", palette).addEventListener("click", closeSearch);
    input.addEventListener("input", render);
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveItem(activeIdx + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActiveItem(activeIdx - 1); }
      else if (e.key === "Enter") { e.preventDefault(); var el = $("#pi-" + activeIdx, results); if (el) location.href = el.getAttribute("href"); }
    });
    results.addEventListener("mousemove", function (e) {
      var el = e.target.closest(".palette-item");
      if (el && +el.getAttribute("data-idx") !== activeIdx) setActiveItem(+el.getAttribute("data-idx"));
    });
  }
  function openSearch(q) {
    ensureIndex();
    if (!palette) buildPalette();
    lastFocus = document.activeElement;
    palette.hidden = false; document.body.style.overflow = "hidden";
    input.value = typeof q === "string" ? q : ""; render();
    setTimeout(function () { input.focus(); }, 10);
  }
  function closeSearch() {
    if (!palette || palette.hidden) return;
    palette.hidden = true; document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  BB.openSearch = openSearch;
  $$("[data-open-search]").forEach(function (b) { b.addEventListener("click", function () { openSearch(); }); b.addEventListener("pointerenter", ensureIndex, { once: true }); });

  // ── settings: theme, backup, restore, reset ────────────────────
  var DATA_KEYS = {
    progress: { label: "Progress & brain", desc: "Completed lessons, solved problems, learned concepts, neurons", keys: ["bb-done-at", "bb-last", "hc-done", "hc-last"] },
    focus: { label: "Focus history", desc: "Sessions, running timer and withered history", keys: ["bb-sessions", "bb-focus"] },
    tasks: { label: "Tasks & lists", desc: "All tasks, subtasks and custom lists", keys: ["bb-tasks", "bb-lists"] },
    habits: { label: "Habits", desc: "Custom habits and check-ins", keys: ["bb-habits"] },
    prefs: { label: "Preferences", desc: "Timer lengths, deep focus, views, theme", keys: ["bb-dur-focus", "bb-dur-short", "bb-dur-long", "bb-strict", "bb-focus-domain", "bb-tasks-view", "bb-tasks-list", "bb-term-hist", "bb-sheet-hide-done", "theme"] }
  };
  function allKeys() { var k = []; Object.keys(DATA_KEYS).forEach(function (g) { k = k.concat(DATA_KEYS[g].keys); }); return k; }
  function exportData() {
    var out = { app: "blackbox", version: 1, exported: new Date().toISOString(), data: {} };
    allKeys().forEach(function (k) { try { var v = localStorage.getItem(k); if (v != null) out.data[k] = v; } catch (e) {} });
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "blackbox-backup-" + BB.dayKey() + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast("Backup downloaded", "var(--ok)");
  }
  function importData(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var json = JSON.parse(r.result);
        if (!json || json.app !== "blackbox" || typeof json.data !== "object") throw new Error("Not a BLACKBOX backup");
        var known = allKeys();
        Object.keys(json.data).forEach(function (k) { if (known.indexOf(k) >= 0) localStorage.setItem(k, json.data[k]); });
        toast("Backup restored — reloading", "var(--ok)");
        setTimeout(function () { location.reload(); }, 700);
      } catch (e) { toast("Couldn’t restore: " + e.message, "var(--red)"); }
    };
    r.readAsText(file);
  }
  function resetGroups(groups) {
    groups.forEach(function (g) { DATA_KEYS[g].keys.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} }); });
    try { localStorage.setItem("bb-done-at", localStorage.getItem("bb-done-at") || "{}"); } catch (e) {}
  }
  BB.resetGroups = resetGroups;

  var settings = null;
  function openSettings() {
    if (!settings) {
      settings = document.createElement("div");
      settings.className = "modal"; settings.hidden = true;
      settings.setAttribute("role", "dialog"); settings.setAttribute("aria-modal", "true"); settings.setAttribute("aria-label", "Settings");
      settings.innerHTML = '<div class="modal-backdrop" data-close></div><div class="modal-box">' +
        '<div class="modal-head"><div><p class="mono-label">/ settings</p><h2>Settings &amp; data</h2></div><button class="icon-btn" data-close aria-label="Close">✕</button></div>' +
        '<section class="modal-sec"><h3>Appearance</h3><div class="seg" data-theme-seg><button data-t="light">Light</button><button data-t="dark">Dark</button><button data-t="system">System</button></div></section>' +
        '<section class="modal-sec"><h3>Account &amp; sync</h3><div class="sync-row"><span class="sync-status" data-sync-status></span><button class="btn btn-ghost sm" data-sync-now>Sync now</button></div>' +
        '<p class="modal-note" data-account-note></p>' +
        '<form class="pw-form" data-pw-form hidden><input type="password" name="current" placeholder="Current password" autocomplete="current-password" aria-label="Current password">' +
        '<input type="password" name="password" placeholder="New password (8+ characters)" autocomplete="new-password" aria-label="New password">' +
        '<button class="btn btn-ghost sm" type="submit">Change password</button></form></section>' +
        '<section class="modal-sec"><h3>Backup</h3><p class="modal-note">Export a JSON copy of everything, or restore one into this browser.</p>' +
        '<div class="modal-row"><button class="btn btn-ghost sm" data-export>Export backup</button><label class="btn btn-ghost sm">Import backup<input type="file" accept="application/json" data-import hidden></label></div></section>' +
        '<section class="modal-sec danger-zone"><h3>Reset</h3><p class="modal-note">Choose what to wipe. This can’t be undone (unless you exported a backup).</p><div class="reset-list">' +
        Object.keys(DATA_KEYS).map(function (g) {
          return '<label class="reset-item"><input type="checkbox" value="' + g + '"' + (g === "prefs" ? "" : " checked") + '><span><b>' + DATA_KEYS[g].label + "</b><em>" + DATA_KEYS[g].desc + "</em></span></label>";
        }).join("") + '</div><label class="field"><span class="mono-label">Type RESET to confirm</span><input type="text" data-reset-confirm autocomplete="off" placeholder="RESET"></label>' +
        '<button class="btn btn-red" data-reset disabled>Reset selected data</button></section></div>';
      document.body.appendChild(settings);
      $$("[data-close]", settings).forEach(function (b) { b.addEventListener("click", closeSettings); });
      $$("[data-t]", settings).forEach(function (b) {
        b.addEventListener("click", function () {
          var t = b.getAttribute("data-t");
          if (t === "system") { try { localStorage.removeItem("theme"); } catch (e) {} setTheme(matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark", false); }
          else setTheme(t, true);
          paintSeg();
        });
      });
      $("[data-export]", settings).addEventListener("click", exportData);
      var pw = $("[data-pw-form]", settings);
      pw.addEventListener("submit", function (e) {
        e.preventDefault();
        if (pw.password.value.length < 8) { toast("New password must be at least 8 characters", "var(--red)"); return; }
        BB.api("auth/password", { current: pw.current.value, password: pw.password.value }).then(function () {
          pw.reset(); toast("Password changed · other devices signed out", "var(--ok)");
        }).catch(function (err) { toast(err.message, "var(--red)"); });
      });
      $("[data-sync-now]", settings).addEventListener("click", function () { BB.syncNow().then(function () { toast(BB.sync.mode === "synced" ? "Synced" : "Server not reachable", BB.sync.mode === "synced" ? "var(--ok)" : "var(--red)"); }); });
      $("[data-import]", settings).addEventListener("change", function (e) { if (e.target.files[0]) importData(e.target.files[0]); });
      var confirmIn = $("[data-reset-confirm]", settings), resetBtn = $("[data-reset]", settings);
      var sync = function () {
        var any = $$(".reset-item input:checked", settings).length > 0;
        resetBtn.disabled = !(any && confirmIn.value.trim().toUpperCase() === "RESET");
      };
      confirmIn.addEventListener("input", sync);
      $$(".reset-item input", settings).forEach(function (c) { c.addEventListener("change", sync); });
      resetBtn.addEventListener("click", function () {
        var groups = $$(".reset-item input:checked", settings).map(function (c) { return c.value; });
        resetGroups(groups);
        toast("Reset complete — starting fresh", "var(--red)");
        setTimeout(function () { location.href = ROOT + "index.html"; }, 600);
      });
    }
    paintSeg();
    paintSync();
    var signedIn = !!BB.account() && BB.sync.mode !== "signedout" && BB.sync.mode !== "local";
    $("[data-pw-form]", settings).hidden = !signedIn;
    $("[data-account-note]", settings).innerHTML = BB.sync.mode === "local" ? "This copy has no BLACKBOX server, so everything stays in this browser."
      : signedIn ? "Signed in as <b>" + esc(BB.account()) + "</b>. Progress, tasks, habits and focus history are saved to your account and synced across devices."
      : 'Not signed in — your progress is only in this browser. <a href="' + ROOT + 'login/index.html">Sign in or create an account</a> to save it.';
    $("[data-reset-confirm]", settings).value = "";
    $("[data-reset]", settings).disabled = true;
    settings.hidden = false; document.body.style.overflow = "hidden";
  }
  function paintSeg() {
    var stored = null; try { stored = localStorage.getItem("theme"); } catch (e) {}
    $$("[data-t]", settings).forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-t") === (stored || "system")); });
  }
  function paintSync() {
    $$("[data-sync-status]").forEach(function (el) {
      var m = BB.sync.mode, ago = BB.sync.last ? Math.max(0, Math.round((Date.now() - BB.sync.last) / 1000)) : null;
      el.className = "sync-status s-" + m;
      el.innerHTML = "<i></i>" + (m === "synced" ? "Saved to " + esc(BB.account() || "server") + " · " + (ago < 5 ? "just now" : ago < 60 ? ago + "s ago" : Math.round(ago / 60) + "m ago")
        : m === "local" ? "This browser only — no sync server" : m === "signedout" ? 'Not signed in — <a href="' + ROOT + 'login/index.html">sign in</a> to save progress'
        : m === "error" ? "Server unreachable — will retry" : "Connecting…");
    });
  }
  BB.on(function (w) { if (w === "sync") paintSync(); });
  setInterval(paintSync, 5000);
  function closeSettings() { if (settings && !settings.hidden) { settings.hidden = true; document.body.style.overflow = ""; } }
  BB.openSettings = openSettings;
  $$("[data-open-settings]").forEach(function (b) { b.addEventListener("click", openSettings); });

  // Per-track reset (track pages)
  $$("[data-reset-prefix]").forEach(function (b) {
    b.addEventListener("click", function () {
      var prefix = b.getAttribute("data-reset-prefix");
      var ids = Object.keys(doneAt).filter(function (id) { return id.indexOf(prefix) === 0; });
      if (!ids.length) { toast("Nothing to reset in " + b.getAttribute("data-reset-label")); return; }
      if (!confirm("Reset " + ids.length + " completed lessons in " + b.getAttribute("data-reset-label") + "? Their neurons will go dark.")) return;
      ids.forEach(function (id) { delete doneAt[id]; });
      save("bb-done-at", doneAt);
      emit("progress");
      toast(b.getAttribute("data-reset-label") + " reset", "var(--red)");
    });
  });

  // ── keyboard ───────────────────────────────────────────────────
  document.addEventListener("keydown", function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || "") || e.target.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palette && !palette.hidden ? closeSearch() : openSearch(); return; }
    if (e.key === "Escape") { closeSearch(); closeSettings(); document.body.classList.remove("drawer-open"); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); openSearch(); }
    else if (e.key === "d" || e.key === "D") toggleTheme();
    else if ((e.key === "f" || e.key === "F") && PAGE !== "focus") location.href = ROOT + "focus/index.html";
    else if (e.key === "ArrowRight") { var n = $("[data-nav-next]"); if (n) location.href = n.href; }
    else if (e.key === "ArrowLeft") { var p = $("[data-nav-prev]"); if (p) location.href = p.href; }
  });

  // ── server sync ────────────────────────────────────────────────
  // localStorage stays the source of truth while you work (offline-first). Once you're signed
  // in, every bb-* key is mirrored to your account at /api/state with a timestamp; the newer
  // write wins on either side. Signed out, everything keeps working in this browser only.
  var SYNC_URL = ROOT + "api/state", ACCOUNT_KEY = "blackbox-account";
  var syncMeta = load("bb-sync-meta", {}), snapshot = {}, dirty = {}, pushTimer = 0, syncing = false, pulled = false;
  var account = null;
  try { account = localStorage.getItem(ACCOUNT_KEY); } catch (e) {}
  BB.sync = { mode: "connecting", last: 0, error: "" };
  BB.account = function () { return account; };
  var MERGE_BY_ID = { "bb-tasks": 1, "bb-sessions": 1, "bb-habits": 1, "bb-lists": 1 };
  function syncable(k) { return k && k.indexOf("bb-") === 0 && k !== "bb-sync-meta"; }
  function localKeys() {
    var out = [];
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (syncable(k)) out.push(k); } } catch (e) {}
    return out;
  }
  function raw(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function setSyncStatus(mode, err) {
    BB.sync.mode = mode; BB.sync.error = err || "";
    if (mode === "synced") BB.sync.last = Date.now();
    emit("sync");
  }
  // Keys that existed before this browser ever synced get t=1, so real server data wins —
  // except collections, which are unioned on that first contact so nothing is lost.
  localKeys().forEach(function (k) { snapshot[k] = raw(k); if (!syncMeta[k]) { syncMeta[k] = 1; dirty[k] = true; } });
  save("bb-sync-meta", syncMeta);

  // Another person's data must never leak into (or be pushed to) the account signing in.
  function wipeLocal() {
    localKeys().forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
    snapshot = {}; syncMeta = {}; dirty = {};
    save("bb-sync-meta", syncMeta);
    doneAt = {};
  }
  // Browsing signed out and then signing in: treat local data as first contact, so it is
  // unioned into the account instead of overwriting it with whatever is newest.
  function markFirstContact() {
    localKeys().forEach(function (k) { syncMeta[k] = 1; });
    save("bb-sync-meta", syncMeta);
  }
  function setAccount(user) {
    if (user === account) return;
    if (account && user && user !== account) { wipeLocal(); rehydrate(); }
    account = user || null;
    try { account ? localStorage.setItem(ACCOUNT_KEY, account) : localStorage.removeItem(ACCOUNT_KEY); } catch (e) {}
    emit("account");
  }

  function scan() {
    // Storage wiped outside the app (DevTools, "clear site data"): never propagate that as
    // deletions — forget local sync state and let the server restore everything.
    if (raw("bb-sync-meta") == null) {
      snapshot = {}; syncMeta = {}; dirty = {};
      localKeys().forEach(function (k) { snapshot[k] = raw(k); syncMeta[k] = 1; dirty[k] = true; });
      save("bb-sync-meta", syncMeta);
      pull();
      return;
    }
    var keys = {}, changed = false;
    localKeys().concat(Object.keys(snapshot)).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var cur = raw(k);
      if (cur !== (snapshot[k] === undefined ? null : snapshot[k])) {
        snapshot[k] = cur; syncMeta[k] = Date.now(); dirty[k] = true; changed = true;
      }
    });
    if (changed) { save("bb-sync-meta", syncMeta); schedulePush(); }
  }
  function unionMerge(k, localV, serverV) {
    try {
      var a = JSON.parse(localV), b = JSON.parse(serverV);
      if (k === "bb-done-at" && a && b && typeof a === "object" && !Array.isArray(a)) {
        Object.keys(a).forEach(function (id) { if (!(id in b)) b[id] = a[id]; });
        return JSON.stringify(b);
      }
      if (MERGE_BY_ID[k] && Array.isArray(a) && Array.isArray(b)) {
        var seen = {};
        b.forEach(function (x) { if (x && x.id) seen[x.id] = 1; });
        a.forEach(function (x) { if (x && x.id && !seen[x.id]) b.push(x); });
        return JSON.stringify(b);
      }
    } catch (e) {}
    return serverV;
  }
  function apply(state) {
    setAccount(state && state.user);
    var keys = (state && state.keys) || {}, changed = false;
    Object.keys(keys).forEach(function (k) {
      if (!syncable(k)) return;
      var srv = keys[k], mine = syncMeta[k] || 0;
      if (srv.t > mine) {
        var v = srv.v;
        if (mine === 1 && v != null && raw(k) != null && (k === "bb-done-at" || MERGE_BY_ID[k])) {
          v = unionMerge(k, raw(k), v);
          if (v !== srv.v) { syncMeta[k] = Date.now(); dirty[k] = true; } else syncMeta[k] = srv.t;
        } else { syncMeta[k] = srv.t; delete dirty[k]; }
        try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {}
        snapshot[k] = v == null ? null : v;
        changed = true;
      } else if (mine > srv.t) dirty[k] = true;
    });
    localKeys().forEach(function (k) { if (!keys[k]) dirty[k] = true; });
    save("bb-sync-meta", syncMeta);
    if (changed) rehydrate();
    if (Object.keys(dirty).length) schedulePush();
  }
  function rehydrate() {
    doneAt = load("bb-done-at", {});
    paintProgress(); syncLessonButtons(); paintPill();
    ["progress", "tasks", "habits", "focus"].forEach(function (w) { emit(w); });
    emit("session", {});
  }
  function api(url, method, body, keepalive) {
    return fetch(url, {
      method: method, keepalive: !!keepalive, cache: "no-store", credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 404 || r.status === 405 || r.status === 501) { var e = new Error("no server"); e.local = true; throw e; }
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && url === SYNC_URL) { var ea = new Error("signed out"); ea.auth = true; throw ea; }
        if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
        return j;
      });
    });
  }
  BB.api = function (path, body) { return api(ROOT + "api/" + path, body ? "POST" : "GET", body); };
  function failed(e) { setSyncStatus(e.local ? "local" : e.auth ? "signedout" : "error", e.message); }
  function payload() {
    var out = {};
    Object.keys(dirty).forEach(function (k) { out[k] = { v: raw(k), t: syncMeta[k] || Date.now() }; });
    return { keys: out };
  }
  function push(keepalive) {
    clearTimeout(pushTimer);
    // Never push before the first pull has told us whose account this is.
    if (!pulled || BB.sync.mode === "local" || BB.sync.mode === "signedout" || !Object.keys(dirty).length) return Promise.resolve();
    var body = payload(), sent = Object.keys(body.keys);
    if (keepalive && JSON.stringify(body).length > 60000) keepalive = false;   // keepalive bodies are size-capped
    return api(SYNC_URL, "PUT", body, keepalive).then(function (state) {
      sent.forEach(function (k) { if (syncMeta[k] <= body.keys[k].t) delete dirty[k]; });
      apply(state); setSyncStatus("synced");
    }).catch(failed);
  }
  function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(push, 800); }
  function pull() {
    if (syncing) return Promise.resolve();
    syncing = true;
    return api(SYNC_URL, "GET").then(function (state) { pulled = true; apply(state); setSyncStatus("synced"); })
      .catch(failed)
      .then(function () { syncing = false; });
  }
  BB.syncNow = function () { scan(); return pull().then(function () { return push(); }); };
  BB.signOut = function () {
    scan();
    return push().then(function () { return api(ROOT + "api/auth/logout", "POST", {}); }).catch(function () {}).then(function () {
      wipeLocal();
      try { localStorage.removeItem(ACCOUNT_KEY); } catch (e) {}
      location.href = ROOT + "login/index.html";
    });
  };
  // Called by the sign-in page before it redirects.
  BB.onSignedIn = function (user) {
    if (account && account !== user) wipeLocal();
    else if (!account) markFirstContact();
    account = user;
    try { localStorage.setItem(ACCOUNT_KEY, user); } catch (e) {}
  };
  if (location.protocol !== "file:") {
    pull();
    setInterval(scan, 1500);
    setInterval(function () { if (BB.sync.mode !== "local" && BB.sync.mode !== "signedout" && !document.hidden) pull(); }, 30000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden && BB.sync.mode !== "local") pull(); });
    window.addEventListener("pagehide", function () { scan(); push(true); });
  } else setSyncStatus("local");

  // ── account: header button, sign-in page ───────────────────────
  var acct = $("[data-account]");
  function paintAccount() {
    if (!acct) return;
    var m = BB.sync.mode, signedIn = !!account && m !== "signedout";
    acct.hidden = m === "local";
    acct.classList.toggle("is-in", signedIn);
    acct.classList.toggle("is-out", m === "signedout");
    $("[data-account-name]", acct).textContent = signedIn ? account : "Sign in";
    $("[data-account-user]", acct).textContent = account || "";
    var btn = $("[data-account-btn]", acct);
    btn.href = ROOT + "login/index.html" + (PAGE === "login" ? "" : "?next=" + encodeURIComponent(location.pathname + location.hash));
  }
  if (acct) {
    var menu = $("[data-account-menu]", acct);
    $("[data-account-btn]", acct).addEventListener("click", function (e) {
      if (!acct.classList.contains("is-in")) return;
      e.preventDefault(); menu.hidden = !menu.hidden;
    });
    document.addEventListener("click", function (e) { if (!acct.contains(e.target)) menu.hidden = true; });
    $("[data-sign-out]", acct).addEventListener("click", function () { menu.hidden = true; BB.signOut(); });
    $("[data-open-settings]", acct).addEventListener("click", function () { menu.hidden = true; });
    BB.on(function (w) { if (w === "sync" || w === "account") paintAccount(); });
    paintAccount();
  }

  if (PAGE === "login") {
    var form = $("[data-login-form]"), mode = "login", errEl = $("[data-login-error]"), submit = $("[data-login-submit]");
    var nextUrl = new URLSearchParams(location.search).get("next");
    if (!nextUrl || !/^\/(?![\/\\])/.test(nextUrl)) nextUrl = ROOT + "index.html";  // same-site paths only
    var setMode = function (m) {
      mode = m;
      $$("[data-login-tabs] button").forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-mode") === m); });
      $$("[data-register-only]").forEach(function (el) { el.hidden = m !== "register"; });
      form.password.setAttribute("autocomplete", m === "register" ? "new-password" : "current-password");
      submit.textContent = m === "register" ? "Create account" : "Sign in";
      errEl.hidden = true;
    };
    $$("[data-login-tabs] button").forEach(function (b) { b.addEventListener("click", function () { setMode(b.getAttribute("data-mode")); }); });
    var showErr = function (msg) { errEl.textContent = msg; errEl.hidden = false; };
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var u = form.username.value.trim().toLowerCase(), p = form.password.value;
      if (u.length < 3) return showErr("Username must be at least 3 characters");
      if (p.length < 8) return showErr("Password must be at least 8 characters");
      if (mode === "register" && p !== form.confirm.value) return showErr("Passwords don’t match");
      submit.disabled = true; errEl.hidden = true;
      BB.api("auth/" + mode, { username: u, password: p }).then(function (r) {
        BB.onSignedIn(r.user);
        toast(mode === "register" ? "Account created — welcome, " + r.user : "Welcome back, " + r.user, "var(--ok)");
        setTimeout(function () { location.href = nextUrl; }, 400);
      }).catch(function (err) {
        submit.disabled = false;
        showErr(err.local ? "This copy of BLACKBOX has no server, so accounts aren’t available." : err.message);
      });
    });
    BB.api("auth/me").then(function (r) {
      if (r.user) $("[data-login-note]").textContent = "You’re signed in as " + r.user + ". Signing in as someone else replaces this browser’s data with theirs.";
      if (!r.signup) $$("[data-login-tabs] button")[1].hidden = true;
    }).catch(function () {});
    setMode(location.hash === "#register" ? "register" : "login");
    setTimeout(function () { form.username.focus(); }, 50);
  }

  checkHidden();
  paintPill();
  paintProgress();
})();
