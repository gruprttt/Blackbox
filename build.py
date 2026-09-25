#!/usr/bin/env python3
"""Build BLACKBOX — a standalone learning site — from the saved HamChops /learn pages.

Usage:  python3 build.py [SOURCE_DIR] [OUT_DIR]
Defaults: SOURCE_DIR=../learn  OUT_DIR=./dist

Adding a new subject later (DSA, System Design, …): drop its saved pages into SOURCE_DIR,
then list the track folder under the right entry in DOMAINS (or add a new domain with an
`anchor` on the brain). Domains marked `soon` show up as dormant brain regions.
"""
import html
import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else (HERE.parent / "learn")
OUT = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else (HERE / "dist")
SITE = "BLACKBOX"
TAGLINE = "Where engineers figure things out."

# Each domain is one region of the brain. `anchor` is where that region sits on the brain
# (x: left→right, y: down→up, z: back→front); neurons are assigned to the nearest anchor.
DOMAINS = [
    dict(id="foundations", name="Thinking & Leadership", short="Thinking", color="#a78bfa", anchor=(0, .32, .9),
         blurb="Mental models, systems thinking and influence.",
         tracks=["the-foundation-systems-thinking", "organizational-design-influence"]),
    dict(id="code", name="Code & Craft", short="Code", color="#5b8cff", anchor=(-.62, .1, .45),
         blurb="Scripting, version control and interview craft.",
         tracks=["code-scripting-version-control", "algorithmic-interviews-career-strategy"]),
    dict(id="systems", name="Systems & Networks", short="Systems", color="#38bdf8", anchor=(.25, .62, .15),
         blurb="Kernels, hardware sympathy and the internet's plumbing.",
         tracks=["operating-systems-kernel-hardware-sympathy", "networking-internet-governance"]),
    dict(id="distributed", name="Distributed Systems", short="Distributed", color="#2dd4bf", anchor=(-.4, .5, -.35),
         blurb="Consensus, replication and algorithms at scale.",
         tracks=["distributed-systems-algorithms-at-scale"]),
    dict(id="infra", name="Cloud & Platform", short="Cloud", color="#a3e635", anchor=(.62, .15, .35),
         blurb="IaC, containers, AWS, delivery pipelines and cost.",
         tracks=["infrastructure-as-code-iac", "containerization-wasm-kubernetes", "aws-mastery-the-reference-implementation",
                 "ci-cd-release-engineering", "platform-engineering-strategy", "finops-greenops"]),
    dict(id="reliability", name="Reliability & Data", short="Reliability", color="#fb923c", anchor=(.62, -.2, -.25),
         blurb="Observability, incidents and database reliability.",
         tracks=["observability-sre", "incident-command-resilience", "database-reliability-engineering-dbre"]),
    dict(id="security", name="Cybersecurity", short="Security", color="#ff4d5e", anchor=(0, .15, -.95),
         blurb="DevSecOps today — offensive & defensive security next.",
         tracks=["security-engineering-devsecops"]),
    dict(id="ai", name="AI & Data", short="AI", color="#fbbf24", anchor=(-.62, -.2, -.2),
         blurb="AI infrastructure and DataOps — ML & LLMs next.",
         tracks=["ai-infrastructure-dataops"]),
    dict(id="dsa", name="Data Structures & Algorithms", short="DSA", color="#22d3ee", anchor=(0, -.45, -.7),
         blurb="Arrays to graphs, patterns to proofs.", tracks=[], soon=True),
    dict(id="system-design", name="System Design", short="Design", color="#f472b6", anchor=(.4, .45, -.45),
         blurb="Designing large-scale systems end to end.", tracks=[], soon=True),
]
DOMAIN_BY_ID = {d["id"]: d for d in DOMAINS}

# Skill map: the question each track answers, and which tracks unlock which.
QUESTIONS = {
    "the-foundation-systems-thinking": "How do good engineers actually think?",
    "operating-systems-kernel-hardware-sympathy": "What is the machine really doing?",
    "networking-internet-governance": "How does a packet get from here to there?",
    "code-scripting-version-control": "How do I automate my own work?",
    "infrastructure-as-code-iac": "How do I stop clicking around in consoles?",
    "containerization-wasm-kubernetes": "How do I package and run anything, anywhere?",
    "ci-cd-release-engineering": "How does code reach production safely?",
    "observability-sre": "How do I know it's healthy?",
    "distributed-systems-algorithms-at-scale": "What happens when one machine isn't enough?",
    "database-reliability-engineering-dbre": "How do I keep data safe and fast?",
    "ai-infrastructure-dataops": "How do I run data and AI in production?",
    "security-engineering-devsecops": "How do I keep attackers out?",
    "platform-engineering-strategy": "How do I build a platform people love?",
    "finops-greenops": "Why is the cloud bill so high?",
    "incident-command-resilience": "What do I do at 3 a.m.?",
    "organizational-design-influence": "How do I lead without authority?",
    "aws-mastery-the-reference-implementation": "How do I build all of this on AWS?",
    "algorithmic-interviews-career-strategy": "How do I land the role?",
}
MAP_EDGES = [
    ("the-foundation-systems-thinking", "operating-systems-kernel-hardware-sympathy"),
    ("the-foundation-systems-thinking", "networking-internet-governance"),
    ("the-foundation-systems-thinking", "code-scripting-version-control"),
    ("operating-systems-kernel-hardware-sympathy", "containerization-wasm-kubernetes"),
    ("networking-internet-governance", "containerization-wasm-kubernetes"),
    ("networking-internet-governance", "distributed-systems-algorithms-at-scale"),
    ("code-scripting-version-control", "infrastructure-as-code-iac"),
    ("code-scripting-version-control", "ci-cd-release-engineering"),
    ("containerization-wasm-kubernetes", "ci-cd-release-engineering"),
    ("containerization-wasm-kubernetes", "security-engineering-devsecops"),
    ("distributed-systems-algorithms-at-scale", "database-reliability-engineering-dbre"),
    ("distributed-systems-algorithms-at-scale", "ai-infrastructure-dataops"),
    ("ci-cd-release-engineering", "observability-sre"),
    ("ci-cd-release-engineering", "platform-engineering-strategy"),
    ("infrastructure-as-code-iac", "aws-mastery-the-reference-implementation"),
    ("security-engineering-devsecops", "aws-mastery-the-reference-implementation"),
    ("observability-sre", "incident-command-resilience"),
    ("database-reliability-engineering-dbre", "incident-command-resilience"),
    ("platform-engineering-strategy", "finops-greenops"),
    ("aws-mastery-the-reference-implementation", "finops-greenops"),
    ("incident-command-resilience", "organizational-design-influence"),
    ("platform-engineering-strategy", "organizational-design-influence"),
    ("organizational-design-influence", "algorithmic-interviews-career-strategy"),
]

TRACKS = []  # filled in main(); used by the header's Tracks dropdown

# Programs are the top-level curricula. Each has its own numbered path of tracks.
# Tracks not listed in a later program belong to the first (live) one.
PROGRAMS = [
    dict(id="devops-sre", name="DevOps & SRE", color="#5b8cff",
         blurb="Foundations to incident command: Linux, networking, IaC, Kubernetes, CI/CD, observability, databases, security and platform strategy."),
    dict(id="system-design", name="System Design", color="#f472b6", soon=True,
         blurb="Design large-scale systems end to end — capacity math, failure modes and trade-offs.",
         region_note="Wires the System Design region"),
    dict(id="dsa", name="Data Structures & Algorithms", color="#22d3ee", soon=True,
         blurb="From arrays to graphs — patterns, complexity and interview-grade problem solving.",
         region_note="Wires the DSA region"),
    dict(id="cybersecurity", name="Cybersecurity", color="#ff4d5e", soon=True,
         blurb="Offensive and defensive security beyond DevSecOps: threat hunting, exploitation, hardening.",
         region_note="Expands the Cybersecurity region"),
    dict(id="ai-ml", name="AI & Machine Learning", color="#fbbf24", soon=True,
         blurb="ML foundations, LLMs, training and serving — the systems behind modern AI.",
         region_note="Expands the AI & Data region"),
]
TRACK_DOMAIN = {slug: d["id"] for d in DOMAINS for slug in d["tracks"]}


# ───────────────────────────── parsing ─────────────────────────────

def first(pattern, text, default=""):
    m = re.search(pattern, text, re.S)
    return m.group(1).strip() if m else default


def strip_tags(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", strip_tags(s).lower()).strip("-")
    return s or "section"


def parse_track(track_dir):
    src = (track_dir / "index.html").read_text(encoding="utf-8")
    chapter = int(first(r"chapters/(\d+)\.svg", src, "99"))
    title = first(r"<h1[^>]*>(.*?)</h1>", src)
    topics = []
    for m in re.finditer(
        r'<a href="[^"]*/learn/[^/]+/([^/"]+)/"\s*class="group block.*?<h3[^>]*>(.*?)</h3>', src, re.S
    ):
        slug, ttitle = m.group(1), m.group(2).strip()
        if (track_dir / slug).is_dir():
            topics.append({"slug": slug, "title": ttitle, "lessons": []})
    listed = {t["slug"] for t in topics}
    for d in sorted(p for p in track_dir.iterdir() if p.is_dir() and p.name not in listed):
        topics.append({"slug": d.name, "title": d.name.replace("-", " ").title(), "lessons": []})
    return {"slug": track_dir.name, "title": title, "chapter": chapter, "topics": topics}


def rewrite_links(body):
    def fix(m):
        url = m.group(1)
        if url.startswith(("http://", "https://")) and "hamchops.com/learn/" not in url:
            return f'href="{url}" target="_blank" rel="noopener"'
        lm = re.match(r"(?:https://hamchops\.com)?/learn/(.+?)/?$", url)
        if lm:
            return f'href="{{ROOT}}{lm.group(1)}/index.html"'
        return m.group(0)

    return re.sub(r'href="([^"]*)"', fix, body)


def parse_lesson(path):
    src = path.read_text(encoding="utf-8")
    body = first(r'<div class="lesson-content">(.*?)<!-- Report Issue Button -->', src)
    body = re.sub(r"</div>\s*$", "", body)
    body = re.sub(r'<div class="table-scroll-hint"[^>]*>.*?</div>', "", body, flags=re.S)
    body = rewrite_links(body)

    toc, seen = [], set()

    def add_id(m):
        text = m.group(2)
        base = slugify(text)
        sid, n = base, 2
        while sid in seen:
            sid, n = f"{base}-{n}", n + 1
        seen.add(sid)
        toc.append((sid, strip_tags(text)))
        return f'<h3{m.group(1)} id="{sid}">{text}</h3>'

    body = re.sub(r"<h3([^>]*)>(.*?)</h3>", add_id, body, flags=re.S)

    return {
        "slug": path.parent.name,
        "title": first(r"<h1 class=\"text-2xl[^\"]*\">(.*?)</h1>", src),
        "kind": first(r'rounded-full bg-white/20 font-medium">\s*([A-Z_ ]+)', src, "LESSON").title(),
        "minutes": int(first(r"(\d+) min read", src, "3")),
        "updated": first(r"Updated ([A-Z][a-z]{2} \d{1,2}, \d{4})", src),
        "pos": int(first(r"\((\d+)/\d+\)</li>", src, "999")),
        "body": body,
        "toc": toc,
    }


def load():
    tracks = []
    for d in sorted(p for p in SRC.iterdir() if p.is_dir() and (p / "index.html").exists()):
        track = parse_track(d)
        for topic in track["topics"]:
            for lp in (d / topic["slug"]).glob("*/index.html"):
                topic["lessons"].append(parse_lesson(lp))
            topic["lessons"].sort(key=lambda l: (l["pos"], l["slug"]))
        track["topics"] = [t for t in track["topics"] if t["lessons"]]
        tracks.append(track)
    tracks.sort(key=lambda t: t["chapter"])
    for i, t in enumerate(tracks):
        t["index"] = i + 1
        t["num"] = f"{i + 1:02d}"
        t["prev"] = tracks[i - 1] if i > 0 else None
        t["next"] = tracks[i + 1] if i + 1 < len(tracks) else None
        t["domain"] = DOMAIN_BY_ID[TRACK_DOMAIN.get(t["slug"], "foundations")]
        t["color"] = t["domain"]["color"]
        t["n_lessons"] = sum(len(tp["lessons"]) for tp in t["topics"])
        t["minutes"] = sum(l["minutes"] for tp in t["topics"] for l in tp["lessons"])
    for t in tracks:
        t["of"] = len(tracks)
    return tracks


# ───────────────────────────── rendering helpers ─────────────────────────────

def svg(body, fill=False, sw=2):
    paint = 'fill="currentColor"' if fill else f'fill="none" stroke="currentColor" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"'
    return f'<svg viewBox="0 0 24 24" {paint} aria-hidden="true">{body}</svg>'


ICON = {
    "search": svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    "sun": svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>').replace("<svg ", '<svg class="i-sun" '),
    "moon": svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>').replace("<svg ", '<svg class="i-moon" '),
    "menu": svg('<path d="M4 6h16M4 12h16M4 18h10"/>'),
    "chev": svg('<path d="m9 6 6 6-6 6"/>'),
    "left": svg('<path d="M19 12H5M11 18l-6-6 6-6"/>'),
    "right": svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    "check": svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', sw=2.5),
    "clock": svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    "play": svg('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>', fill=True),
    "book": svg('<path d="M4 19.5V5a2 2 0 0 1 2-2h14v15H6.5A2.5 2.5 0 0 0 4 20.5 2.5 2.5 0 0 0 6.5 23H20"/>'),
    "learn": svg('<path d="M2 8.5 12 4l10 4.5-10 4.5z"/><path d="M6 10.5v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/>'),
    "brain": svg('<path d="M9.5 3A2.5 2.5 0 0 0 7 5.5v.3A3 3 0 0 0 4.5 9a3 3 0 0 0 .6 1.8A3 3 0 0 0 4 13.5 3 3 0 0 0 6 16.3V17a3 3 0 0 0 5.5 1.7V4.4A2.5 2.5 0 0 0 9.5 3z"/><path d="M14.5 3A2.5 2.5 0 0 1 17 5.5v.3A3 3 0 0 1 19.5 9a3 3 0 0 1-.6 1.8 3 3 0 0 1 1.1 2.7 3 3 0 0 1-2 2.8V17a3 3 0 0 1-5.5 1.7"/>'),
    "focus": svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2h5M12 2v3"/>'),
    "tasks": svg('<rect x="3" y="4" width="18" height="17" rx="3"/><path d="m7.5 12.5 2.5 2.5 5-5"/>'),
    "habits": svg('<path d="M12 3c1 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2-4.6.3 1.6 1 2.6 2 3.1C11 9 11.5 6 12 3z"/>'),
    "map": svg('<path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>'),
    "gear": svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    "plus": svg('<path d="M12 5v14M5 12h14"/>'),
}

NAV = [("Learn", "index.html", "learn", ("home",)),
       ("Tracks", "tracks/index.html", "map", ("tracks", "track", "topic", "lesson")),
       ("Brain", "brain/index.html", "brain", ("brain",)),
       ("Focus", "focus/index.html", "focus", ("focus",)),
       ("Tasks", "tasks/index.html", "tasks", ("tasks",)),
       ("Habits", "habits/index.html", "habits", ("habits",))]

THEME_BOOT = (
    "<script>(function(){var t;try{t=localStorage.getItem('theme')}catch(e){}"
    "if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}"
    "document.documentElement.setAttribute('data-theme',t)})()</script>"
)

APP_PAGES = ("home", "brain", "focus", "tasks", "habits")


def logo(size=""):
    return f'<span class="logo {size}"><span class="logo-box" aria-hidden="true"><i></i></span>BLACKBOX</span>'


def page(*, title, desc, root, body, kind):
    extra = ""
    if kind in ("home", "tracks"):
        extra = f'<script src="{root}assets/path.js" defer></script>\n'
    if kind == "tracks":
        extra += f'<script src="{root}assets/map-data.js" defer></script>\n<script src="{root}assets/views.js" defer></script>\n<script src="{root}assets/mindmap.js" defer></script>\n'
    if kind in APP_PAGES:
        extra += f'<script src="{root}assets/brain.js" defer></script>\n<script src="{root}assets/views.js" defer></script>\n'
    return f"""<!DOCTYPE html>
<html lang="en" data-root="{root}" data-page="{kind}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{html.escape(desc)}">
<meta name="color-scheme" content="dark light">
{THEME_BOOT}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300..800&family=Geist+Mono:wght@400..700&display=swap">
<link rel="icon" href="{root}assets/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#07080c" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f4f5f8" media="(prefers-color-scheme: light)">
<link rel="stylesheet" href="{root}assets/style.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
{header(root, kind)}
{body}
{footer(root)}
{tabbar(root, kind)}
<script src="{root}assets/data.js"></script>
<script src="{root}assets/app.js" defer></script>
{extra}</body>
</html>
"""


def header(root, kind):
    drawer = (f'<button class="icon-btn drawer-btn" data-drawer-toggle aria-label="Open lesson list">{ICON["menu"]}</button>'
              if kind == "lesson" else "")
    bar = '<div class="read-progress" aria-hidden="true"><span></span></div>' if kind == "lesson" else ""
    def item(label, href, icon, kinds):
        link = f'<a href="{root}{href}"{" aria-current=page class=is-active" if kind in kinds else ""}>{ICON[icon]}<span>{label}</span></a>'
        if label != "Tracks" or not TRACKS:
            return link
        rows = "".join(
            f'<a class="nd-item" href="{root}{t["slug"]}/index.html" style="--c:{t["color"]}"><span class="nd-num">{t["num"]}</span>'
            f'<span class="nd-title">{strip_tags(t["title"])}</span><span class="nd-bar" data-nd-track="{t["slug"]}/" data-nd-total="{t["n_lessons"]}"><span></span></span></a>'
            for t in TRACKS)
        return (f'<div class="nav-drop">{link}<div class="nd-panel" role="menu"><div class="nd-head"><span class="mono-label">/ {PROGRAMS[0]["name"]} · {len(TRACKS)} tracks</span>'
                f'<a href="{root}tracks/index.html">Open skill map {ICON["right"]}</a></div><div class="nd-grid">{rows}</div></div></div>')
    nav = "".join(item(*n) for n in NAV)
    return f"""<header class="topbar">
  <div class="topbar-inner">
    {drawer}
    <a class="brand" href="{root}index.html" aria-label="{SITE} home">{logo()}</a>
    <nav class="topnav" aria-label="Main">{nav}</nav>
    <div class="topbar-actions">
      <a class="focus-pill" href="{root}focus/index.html" data-focus-pill hidden><span class="rec"></span><b data-focus-pill-time>25:00</b><span data-focus-pill-label>Focus</span></a>
      <button class="search-trigger" data-open-search aria-label="Search">{ICON["search"]}<span>Search</span><kbd data-mod-key>⌘K</kbd></button>
      <button class="icon-btn" data-open-settings aria-label="Settings" title="Settings &amp; data">{ICON["gear"]}</button>
      <button class="icon-btn theme-toggle" data-theme-toggle aria-label="Toggle dark mode" title="Toggle theme (D)">{ICON["sun"]}{ICON["moon"]}</button>
    </div>
  </div>
  {bar}
</header>"""


def footer(root):
    domains = "".join(f'<li><a href="{root}index.html#path"><i style="--c:{d["color"]}"></i>{d["name"]}</a></li>'
                      for d in DOMAINS if not d.get("soon"))
    app = "".join(f'<li><a href="{root}{href}">{label}</a></li>' for label, href, _, _ in NAV[1:])
    return f"""<footer class="footer">
  <div class="wrap footer-top">
    <div class="footer-brand">
      <a href="{root}index.html">{logo("lg")}</a>
      <p class="tagline">{TAGLINE}</p>
      <p class="fine">Lesson content © HamChops. Progress, tasks and focus history are saved to your BLACKBOX server.</p>
      <p class="fine"><span class="sync-status" data-sync-status></span></p>
    </div>
    <div class="footer-cols">
      <div><h4>Domains</h4><ul>{domains}</ul></div>
      <div><h4>Toolkit</h4><ul>{app}</ul></div>
      <div class="kbd-hints"><h4>Shortcuts</h4><ul>
        <li><kbd>⌘</kbd><kbd>K</kbd> Search</li><li><kbd>←</kbd><kbd>→</kbd> Prev / next</li>
        <li><kbd>D</kbd> Theme</li><li><kbd>F</kbd> Focus page</li></ul></div>
    </div>
  </div>
</footer>"""


def tabbar(root, kind):
    items = "".join(
        f'<a href="{root}{href}"{" class=is-active" if kind in kinds else ""}>{ICON[icon]}<span>{label}</span></a>'
        for label, href, icon, kinds in NAV
    )
    return f'<nav class="tabbar" aria-label="Quick navigation">{items}</nav>'


def crumbs(root, items):
    parts = [f'<a href="{root}{href}">{label}</a>' if href else f'<span aria-current="page">{label}</span>' for label, href in items]
    return '<nav class="crumbs" aria-label="Breadcrumb">' + '<i aria-hidden="true">/</i>'.join(parts) + "</nav>"


def progress(prefix, total, label=True):
    txt = f'<span class="progress-text"><b data-progress-count>0</b>/{total}</span>' if label else ""
    return (f'<div class="progress" data-progress-prefix="{prefix}" data-progress-total="{total}">'
            f'<div class="progress-bar"><span></span></div>{txt}</div>')


def lesson_id(track, topic, lesson):
    return f"{track['slug']}/{topic['slug']}/{lesson['slug']}"


def fmt_minutes(m):
    return f"{m} min" if m < 60 else f"{m // 60}h {m % 60:02d}m"


def lesson_rows(root, track, topic, current=None):
    rows = []
    for i, l in enumerate(topic["lessons"], 1):
        lid = lesson_id(track, topic, l)
        cur = ' aria-current="page" class="is-current"' if current is l else ""
        rows.append(f'<li data-lesson="{lid}"{cur}><a href="{root}{lid}/index.html">'
                    f'<span class="lnum"><b>{i}</b>{ICON["check"]}</span><span class="ltitle">{l["title"]}</span>'
                    f'<span class="lmin">{l["minutes"]}m</span></a></li>')
    return "".join(rows)


# ───────────────────────────── pages ─────────────────────────────

def track_card(t, root=""):
    return f"""<a class="track-card" href="{root}{t['slug']}/index.html" style="--c:{t['color']}">
  <div class="tc-top"><span class="tc-num">{t['num']}</span><span class="tc-go">{ICON['right']}</span></div>
  <h4>{t['title']}</h4>
  <p class="tc-meta">{len(t['topics'])} topics · {t['n_lessons']} lessons · {fmt_minutes(t['minutes'])}</p>
  {progress(t['slug'] + '/', t['n_lessons'])}
</a>"""


def console(kind, title, inner, foot=""):
    """A monitor-style window: chrome bar + always-dark screen (looks intentional in both themes)."""
    return f"""<div class="console console-{kind}">
  <div class="console-bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="console-title">{title}</span><span class="live-tag"><span class="rec live"></span>live</span></div>
  <div class="console-screen">{inner}</div>{foot}
</div>"""


def path_steps(tracks, root=""):
    steps = []
    for i, t in enumerate(tracks):
        steps.append(f"""<li class="path-step" data-path-track="{t['slug']}" data-path-total="{t['n_lessons']}" style="--c:{t['color']}">
  <div class="path-rail" aria-hidden="true"><span class="path-node">{t['num']}</span></div>
  <a class="path-card" href="{root}{t['slug']}/index.html">
    <div class="path-main">
      <div class="path-kicker"><i class="path-dot" data-path-dot></i><span class="mono-label">Track {t['num']}</span><span class="domain-tag"><i></i>{t['domain']['name']}</span><span class="path-state" data-path-state></span></div>
      <h3>{t['title']}</h3>
      <p class="tc-meta">{len(t['topics'])} topics · {t['n_lessons']} lessons · {fmt_minutes(t['minutes'])}</p>
    </div>
    <div class="path-side">
      <div class="path-tele"><span class="pt-spark" data-path-spark></span><span class="pt-seen mono-label" data-path-seen>never active</span></div>
      {progress(t['slug'] + '/', t['n_lessons'])}<span class="path-cta" data-path-cta>Start {ICON['right']}</span>
    </div>
  </a>
</li>""")
    return "".join(steps)


def render_home(tracks):
    root = ""
    prog = PROGRAMS[0]
    n_lessons = sum(t["n_lessons"] for t in tracks)
    first = tracks[0]["topics"][0]["lessons"][0]
    first_href = f"{lesson_id(tracks[0], tracks[0]['topics'][0], first)}/index.html"
    steps = path_steps(tracks)
    programs = []
    for i, pg in enumerate(PROGRAMS, 1):
        if pg.get("soon"):
            programs.append(f"""<div class="program soon" style="--c:{pg['color']}">
  <div class="program-top"><span class="mono-label">Program {i:02d}</span><span class="badge">Coming soon</span></div>
  <h3>{pg['name']}</h3><p>{pg['blurb']}</p>
  <p class="program-meta mono-label">{pg['region_note']}</p>
</div>""")
        else:
            programs.append(f"""<a class="program live" href="#path" style="--c:{pg['color']}">
  <div class="program-top"><span class="mono-label">Program {i:02d}</span><span class="badge live-badge"><span class="rec live"></span>Live</span></div>
  <h3>{pg['name']}</h3><p>{pg['blurb']}</p>
  <p class="program-meta mono-label">{len(tracks)} tracks · {n_lessons:,} lessons · {fmt_minutes(sum(t['minutes'] for t in tracks))}</p>
  {progress('', n_lessons)}
</a>""")
    brain_inner = f"""<canvas data-brain="hero" aria-label="Your knowledge brain"></canvas>
      <div class="brain-hud">
        <span><b data-stat="neurons">0</b> neurons</span><span><b data-stat="synapses">0</b> synapses</span>
        <a href="brain/index.html">Explore {ICON['right']}</a>
      </div>
      <p class="brain-caption mono-label" data-brain-caption>Finish lessons and focus sessions to wire new neurons.</p>
      <div class="brain-tooltip" data-brain-tooltip hidden></div>"""
    brain_foot = '<div class="console-foot" data-hero-telemetry></div>'
    body = f"""<main id="main">
<section class="hero">
  <div class="hero-bg" aria-hidden="true"></div>
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="kicker"><span class="rec live"></span>{prog['name']} · {n_lessons:,} lessons · {len(tracks)} tracks</p>
      <h1>Where engineers<br><span class="grad">figure things out.</span></h1>
      <p class="lede">Deep, bite-sized lessons on systems, infrastructure and reliability — with focus sessions, tasks, habits and a brain that visibly rewires itself as you learn.</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="{first_href}" data-continue-link data-path-next>{ICON['play']}<span data-continue-label>Start learning</span></a>
        <a class="btn btn-ghost" href="focus/index.html"><span class="rec"></span>Start a focus session</a>
      </div>
      <div class="continue-card" data-continue hidden>
        <span class="mono-label">Pick up where you left off</span>
        <a data-continue-href href="#"><span><strong data-continue-title></strong><em data-continue-sub></em></span>{ICON['right']}</a>
      </div>
    </div>
    {console("brain", "cortex@blackbox:~ — neural map", brain_inner, brain_foot)}
  </div>
</section>

<section class="wrap mission" aria-label="Mission control">
  <div class="section-title"><div><span class="mono-label">/ mission control</span><h2>Your learning, in production</h2>
    <p class="section-sub">Live telemetry from your own study data — SLOs, error budget, region health and an event log. Nothing here is simulated.</p></div></div>
  <div class="tele-banner" data-banner>
    <div class="tb-head">
      <div class="tb-title"><p class="tb-label">/ live telemetry</p>
        <p class="tb-sub">cortex · local · last 60 days <span class="tb-chip" data-tb-focus><i></i>focus idle</span></p></div>
      <div class="tb-metrics" data-tb-metrics></div>
    </div>
    <div class="tb-body">
      <div class="tb-chart">
        <canvas data-tb-chart aria-label="Learning activity over the last 60 days"></canvas>
        <div class="tb-legend"><span><i class="lg-bar"></i>lessons / day</span><span><i class="lg-area"></i>7-day avg</span><span><i class="lg-line"></i>focus min</span><span><i class="lg-dot"></i>sessions</span><span><i class="lg-sig"></i>cortex signal</span></div>
      </div>
      <div class="tb-log"><p class="tb-label">/ log tail</p><ol class="log" data-log></ol></div>
    </div>
    <div class="tb-regions" data-region-health></div>
  </div>
  <div class="mission-grid">
    <div class="panel tele" data-telemetry></div>
    <div class="term" data-terminal>
      <div class="console-bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="console-title">you@blackbox:~</span><span class="live-tag">zsh</span></div>
      <div class="term-body" data-term-body tabindex="0">
        <div class="term-out" data-term-out></div>
        <form class="term-line" data-term-form><span class="term-prompt">you@blackbox:~$</span><label class="term-field"><span class="term-mirror" data-term-mirror aria-hidden="true"><span class="term-cursor"> </span></span><input data-term-input aria-label="Terminal command" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send"></label></form>
      </div>
      <div class="term-hints"><span><kbd>Tab</kbd> complete</span><span><kbd>↑</kbd> history</span><span>try <code>help</code> · <code>next</code> · <code>path</code></span></div>
    </div>
  </div>
</section>

<section class="wrap programs-sec" id="programs">
  <div class="section-title"><div><span class="mono-label">/ programs</span><h2>One program live. More on the way.</h2>
    <p class="section-sub">Each program is its own numbered path. DevOps &amp; SRE is live; the others will light up new regions of your brain when they land.</p></div></div>
  <div class="program-grid">{''.join(programs)}</div>
</section>

<section class="wrap library" id="path">
  <div class="section-title"><div><span class="mono-label">/ program 01 · {prog['name']}</span><h2>{len(tracks)} tracks, in order</h2>
    <p class="section-sub">Work from Track 01 to Track {len(tracks):02d}. Next and Previous carry you straight into the next track.</p></div>
    <div class="overall">{progress('', n_lessons)}</div></div>
  <div class="path-status" data-path-status></div>
  <ol class="path">{steps}</ol>
</section>

<section class="wrap dash" aria-label="Today">
  <div class="section-title"><div><span class="mono-label">/ today</span><h2>Plan the day</h2>
    <p class="section-sub">What's due and which habits are still open.</p></div></div>
  <div class="dash-grid">
    <div class="panel" data-home-tasks></div>
    <div class="panel" data-home-habits></div>
  </div>
</section>
</main>"""
    return page(title=f"{SITE} — {TAGLINE}", desc=TAGLINE, root=root, body=body, kind="home")


def banner(root, track, crumbs_html, kicker, title, meta, actions):
    return f"""<section class="wrap page-top">
  <div class="banner blackbox" style="--c:{track['color']}">
    <div class="banner-glow" aria-hidden="true"></div>
    {crumbs_html}
    <div class="banner-row">
      <span class="num-tile">{track['num']}</span>
      <div class="banner-text">
        <p class="kicker"><span class="dot"></span>{kicker}</p>
        <h1>{title}</h1>
        <p class="meta">{meta}</p>
      </div>
    </div>
    <div class="banner-actions">{actions}</div>
  </div>
</section>"""


def track_pager(root, track):
    p, n = track["prev"], track["next"]
    out = '<div class="pager">'
    out += (f'<a class="pager-card prev" href="{root}{p["slug"]}/index.html"><span>{ICON["left"]} Track {p["num"]}</span><strong>{p["title"]}</strong></a>' if p else "<span></span>")
    out += (f'<a class="pager-card next" href="{root}{n["slug"]}/index.html"><span>Track {n["num"]} {ICON["right"]}</span><strong>{n["title"]}</strong></a>' if n else "<span></span>")
    return out + "</div>"


def render_track(track):
    root = "../"
    items = []
    for i, tp in enumerate(track["topics"], 1):
        pre = f"{track['slug']}/{tp['slug']}/"
        items.append(f"""<details class="topic-card" data-topic="{pre}">
  <summary>
    <span class="topic-num">{i:02d}</span>
    <span class="topic-main"><span class="topic-title">{tp['title']}</span>
      <span class="meta">{len(tp['lessons'])} lessons · {fmt_minutes(sum(l['minutes'] for l in tp['lessons']))}</span></span>
    {progress(pre, len(tp['lessons']))}
    <span class="chev">{ICON['chev']}</span>
  </summary>
  <ol class="lesson-list">{lesson_rows(root, track, tp)}</ol>
  <a class="topic-open" href="{tp['slug']}/index.html">Open topic {ICON['right']}</a>
</details>""")
    first = f"{lesson_id(track, track['topics'][0], track['topics'][0]['lessons'][0])}/index.html"
    actions = (f'<a class="btn btn-primary" href="{root}{first}" data-resume="{track["slug"]}/">{ICON["play"]}<span>Start track</span></a>'
               f'<button class="btn btn-ghost on-dark" data-focus-domain="{track["domain"]["id"]}"><span class="rec"></span>Focus on this</button>'
               f'<div class="banner-progress">{progress(track["slug"] + "/", track["n_lessons"])}</div>')
    body = f"""<main id="main" style="--c:{track['color']}">
{banner(root, track, crumbs(root, [(PROGRAMS[0]['name'], 'index.html#path'), (f"Track {track['num']}", None)]),
        f"{PROGRAMS[0]['name']} · Track {track['num']} of {track['of']:02d}", track['title'],
        f"{len(track['topics'])} topics · {track['n_lessons']} lessons · {fmt_minutes(track['minutes'])} of reading", actions)}
<section class="wrap section">
  <div class="topic-tools"><h2>Topics</h2><div><button class="link-btn danger" data-reset-prefix="{track['slug']}/" data-reset-label="Track {track['num']}">Reset track</button><button class="link-btn" data-expand-all>Expand all</button></div></div>
  <div class="topic-list">{''.join(items)}</div>
  {track_pager(root, track)}
</section>
</main>"""
    return page(title=f"{strip_tags(track['title'])} · {SITE}", desc=f"Learn {strip_tags(track['title'])}.", root=root, body=body, kind="track")


def render_topic(track, ti, topic):
    root = "../../"
    pre = f"{track['slug']}/{topic['slug']}/"
    prev_t = track["topics"][ti - 1] if ti > 0 else None
    next_t = track["topics"][ti + 1] if ti + 1 < len(track["topics"]) else None
    nav = '<div class="pager">'
    nav += (f'<a class="pager-card prev" href="../{prev_t["slug"]}/index.html"><span>{ICON["left"]} Previous topic</span><strong>{prev_t["title"]}</strong></a>' if prev_t else "<span></span>")
    nav += (f'<a class="pager-card next" href="../{next_t["slug"]}/index.html"><span>Next topic {ICON["right"]}</span><strong>{next_t["title"]}</strong></a>' if next_t else "<span></span>")
    nav += "</div>"
    actions = (f'<a class="btn btn-primary" href="{root}{lesson_id(track, topic, topic["lessons"][0])}/index.html" data-resume="{pre}">{ICON["play"]}<span>Start topic</span></a>'
               f'<div class="banner-progress">{progress(pre, len(topic["lessons"]))}</div>')
    body = f"""<main id="main" style="--c:{track['color']}">
{banner(root, track, crumbs(root, [(PROGRAMS[0]['name'], 'index.html#path'), (f"Track {track['num']}", track['slug'] + '/index.html'), (topic['title'], None)]),
        f"Topic {ti + 1} of {len(track['topics'])}", topic['title'],
        f"{len(topic['lessons'])} lessons · {fmt_minutes(sum(l['minutes'] for l in topic['lessons']))}", actions)}
<section class="wrap narrow section">
  <ol class="lesson-list big">{lesson_rows(root, track, topic)}</ol>
  {nav}
</section>
</main>"""
    return page(title=f"{strip_tags(topic['title'])} · {SITE}", desc=strip_tags(topic["title"]), root=root, body=body, kind="topic")


def render_lesson(track, ti, topic, li, lesson, prev, nxt, flat_index, total):
    root = "../../../"
    lid = lesson_id(track, topic, lesson)
    if len(lesson["toc"]) > 1:
        toc = ('<aside class="toc" aria-label="On this page"><p class="mono-label">On this page</p><nav>'
               + "".join(f'<a href="#{sid}" data-toc-link="{sid}">{html.escape(t)}</a>' for sid, t in lesson["toc"])
               + "</nav></aside>")
    else:
        toc = '<aside class="toc" aria-hidden="true"></aside>'

    def pager_card(ref, cls, label, icon_left):
        if not ref:
            return "<span></span>"
        t, tp, l = ref
        if t is not track:
            sub = f"Track {t['num']} · {strip_tags(t['title'])}"
            label = f"{'Previous' if icon_left else 'Next'} track"
        else:
            sub = tp["title"] if tp is not topic else f"Lesson {tp['lessons'].index(l) + 1} of {len(tp['lessons'])}"
        arrow = f'{ICON["left"]} {label}' if icon_left else f'{label} {ICON["right"]}'
        return (f'<a class="pager-card {cls}" href="{root}{lesson_id(t, tp, l)}/index.html" data-nav-{cls}>'
                f'<span>{arrow}</span><strong>{l["title"]}</strong><em>{sub}</em></a>')

    other_topics = "".join(
        f'<li{" class=is-current" if tp is topic else ""}><a href="{root}{track["slug"]}/{tp["slug"]}/index.html">'
        f'<span>{i:02d}</span>{tp["title"]}</a></li>' for i, tp in enumerate(track["topics"], 1))
    content = lesson["body"].replace("{ROOT}", root)
    updated = f'<span>Updated {lesson["updated"]}</span>' if lesson["updated"] else ""
    body = f"""<div class="drawer-backdrop" data-drawer-close></div>
<div class="lesson-layout" style="--c:{track['color']}">
  <aside class="sidebar" id="sidebar" aria-label="Lessons in this topic">
    <div class="sidebar-inner">
      <a class="side-track" href="{root}{track['slug']}/index.html"><span class="num-tile sm">{track['num']}</span><span><em class="mono-label">Track {track['num']} of {track['of']:02d}</em>{track['title']}</span></a>
      <div class="side-topic">
        <p class="mono-label">Topic {ti + 1} / {len(track['topics'])}</p>
        <a class="side-topic-title" href="{root}{track['slug']}/{topic['slug']}/index.html">{topic['title']}</a>
        {progress(f"{track['slug']}/{topic['slug']}/", len(topic['lessons']))}
      </div>
      <ol class="lesson-list side">{lesson_rows(root, track, topic, lesson)}</ol>
      <details class="side-more"><summary>All topics in this track {ICON['chev']}</summary><ol>{other_topics}</ol></details>
    </div>
  </aside>
  <main id="main" class="lesson-main">
    {crumbs(root, [(track['title'], track['slug'] + '/index.html'), (topic['title'], f"{track['slug']}/{topic['slug']}/index.html")])}
    <article class="lesson" data-lesson-id="{lid}" data-domain="{track['domain']['id']}" data-lesson-title="{html.escape(strip_tags(lesson['title']))}" data-lesson-sub="{html.escape(strip_tags(topic['title']))}">
      <header class="lesson-head">
        <div class="lesson-meta">
          <span class="chip">{lesson['kind']}</span>
          <span>{ICON['clock']}{lesson['minutes']} min read</span>
          <span>Lesson {li + 1} of {len(topic['lessons'])}</span>
          {updated}
        </div>
        <h1>{lesson['title']}</h1>
        <div class="lesson-actions">
          <button class="chip-btn" data-focus-lesson><span class="rec"></span>Focus 25 min</button>
          <button class="chip-btn" data-add-task><span class="when-todo">{ICON['plus']}Add to tasks</span><span class="when-done">{ICON['check']}In your tasks</span></button>
          <span class="domain-tag" style="--c:{track['color']}"><i></i>{track['domain']['name']}</span>
        </div>
      </header>
      <div class="prose">{content}</div>
      <div class="lesson-foot">
        <button class="btn btn-complete" data-complete>
          <span class="when-todo">{ICON['check']}Mark as complete</span>
          <span class="when-done">{ICON['check']}Completed</span>
        </button>
        <span class="lesson-count mono-label">Track {track['num']} · lesson {flat_index + 1} / {total}</span>
      </div>
      <div class="pager">
        {pager_card(prev, 'prev', 'Previous', True)}
        {pager_card(nxt, 'next', 'Next', False)}
      </div>
    </article>
  </main>
  {toc}
</div>"""
    return page(title=f"{strip_tags(lesson['title'])} · {SITE}", desc=f"{strip_tags(lesson['title'])} — {strip_tags(topic['title'])}",
                root=root, body=body, kind="lesson")


def render_tracks(tracks):
    root = "../"
    n_lessons = sum(t["n_lessons"] for t in tracks)
    progs = "".join(
        f'<button class="prog-chip{" is-active" if not pg.get("soon") else ""}" {"disabled" if pg.get("soon") else ""} style="--c:{pg["color"]}">'
        f'<i></i>{pg["name"]}{" <em>soon</em>" if pg.get("soon") else ""}</button>' for pg in PROGRAMS)
    body = f"""<main id="main" class="app app-tracks">
<section class="wrap tracks-head">
  <div class="section-title"><div><span class="mono-label">/ tracks · program 01</span><h1>{PROGRAMS[0]['name']} skill map</h1>
    <p class="section-sub">{len(tracks)} tracks, {n_lessons:,} lessons. Branches show what unlocks what — press + on a track to reveal its topics, click anything to open it.</p></div>
    <div class="seg" data-tracks-view><button data-v="map" class="is-active">{ICON['map']}Map</button><button data-v="list">{ICON['book']}List</button></div></div>
  <div class="prog-chips">{progs}</div>
</section>
<section class="wrap-wide map-wrap" data-view-pane="map">
  <div class="mindmap" data-mindmap tabindex="0" aria-label="Skill map. Drag to pan, scroll or pinch to zoom.">
    <svg class="mm-edges" data-mm-edges aria-hidden="true"></svg>
    <div class="mm-layer" data-mm-layer></div>
    <div class="mm-tools">
      <button class="icon-btn" data-mm="in" aria-label="Zoom in">{ICON['plus']}</button>
      <button class="icon-btn" data-mm="out" aria-label="Zoom out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg></button>
      <button class="icon-btn" data-mm="fit" aria-label="Fit map"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
      <button class="icon-btn" data-mm="here" aria-label="Go to my current track"><span class="rec"></span></button>
    </div>
    <div class="mm-legend mono-label"><span><i class="s-done"></i>completed</span><span><i class="s-cur"></i>you are here</span><span><i class="s-start"></i>started</span><span><i class="s-new"></i>not started</span></div>
    <aside class="mm-panel" data-mm-panel hidden></aside>
  </div>
</section>
<section class="wrap library" data-view-pane="list" hidden>
  <div class="path-status" data-path-status></div>
  <ol class="path">{path_steps(tracks, root)}</ol>
</section>
</main>"""
    return page(title=f"Tracks · {SITE}", desc="Skill map of every track.", root=root, body=body, kind="tracks")


def render_404():
    return page(title=f"Not found · {SITE}", desc="Page not found", root="/", kind="notfound", body=f"""<main id="main" class="wrap notfound">
  <p class="mono-label">404 · signal lost</p>
  <h1>This neuron isn't wired yet.</h1>
  <p class="lede">The page you're looking for doesn't exist. Head back to the path and keep going.</p>
  <div class="hero-actions"><a class="btn btn-primary" href="/index.html#path">Back to the path</a><button class="btn btn-ghost" data-open-search>{ICON['search']}Search</button></div>
</main>""")


def app_page(kind, title, desc, inner):
    root = "../"
    return page(title=f"{title} · {SITE}", desc=desc, root=root, kind=kind, body=f'<main id="main" class="app app-{kind}">{inner}</main>')


def render_brain():
    return app_page("brain", "Your brain", "Your knowledge, visualised as a growing neural network.", """
<div class="brain-page">
  <section class="console console-stage">
   <div class="console-bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="console-title">cortex@blackbox:~ — neural map</span><span class="live-tag"><span class="rec live"></span>live</span></div>
   <div class="console-screen brain-stage">
    <canvas data-brain="full" aria-label="Interactive 3D brain"></canvas>
    <div class="stage-top">
      <p class="mono-label">Neural map</p>
      <h1>Your brain</h1>
      <p class="stage-sub">Every lesson you finish and every focus minute wires new neurons into the region it belongs to.</p>
    </div>
    <dl class="stage-stats">
      <div><dt>Neurons</dt><dd data-stat="neurons">0</dd></div>
      <div><dt>Synapses</dt><dd data-stat="synapses">0</dd></div>
      <div><dt>Regions active</dt><dd data-stat="regions">0</dd></div>
    </dl>
    <p class="stage-tip mono-label">Drag to rotate · scroll to zoom · click a region</p>
    <div class="brain-tooltip" data-brain-tooltip hidden></div>
   </div>
  </section>
  <aside class="region-panel" data-region-list aria-label="Brain regions"></aside>
</div>""")


def render_focus():
    return app_page("focus", "Focus", "A focus timer that grows neurons while you work.", """
<div class="wrap focus-page">
  <div class="focus-grid">
    <section class="panel focus-card" data-focus-root>
      <div class="seg" role="tablist" data-focus-modes>
        <button data-mode="focus" class="is-active">Focus</button><button data-mode="short">Short break</button><button data-mode="long">Long break</button>
      </div>
      <div class="ring-wrap">
        <svg class="ring" viewBox="0 0 260 260" aria-hidden="true">
          <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--blue)"/><stop offset="1" stop-color="var(--red)"/></linearGradient></defs>
          <circle cx="130" cy="130" r="116" class="ring-track"/>
          <circle cx="130" cy="130" r="116" class="ring-fill" data-ring/>
        </svg>
        <div class="ring-center">
          <span class="mono-label" data-focus-status>Ready</span>
          <b class="ring-time" data-focus-time>25:00</b>
          <span class="ring-sub" data-focus-sub>+0 neurons</span>
        </div>
      </div>
      <div class="dur-chips" data-durations></div>
      <label class="field"><span class="mono-label">Focusing on</span><select data-focus-domain-select></select></label>
      <label class="field"><span class="mono-label">Linked task</span><select data-focus-task-select></select></label>
      <label class="switch"><input type="checkbox" data-strict><span class="switch-ui"></span><span><b>Deep focus</b><em>Leave this site for more than 10 seconds and your new neurons wither.</em></span></label>
      <div class="focus-actions" data-focus-actions></div>
    </section>
    <section class="console console-focus">
      <div class="console-bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="console-title">cortex@blackbox:~ — growth monitor</span><span class="live-tag"><span class="rec live"></span>live</span></div>
      <div class="console-screen focus-brain">
        <canvas data-brain="focus" aria-label="Brain growing during focus"></canvas>
        <div class="focus-brain-hud"><span class="mono-label" data-grow-label>Idle — start a session to grow neurons</span></div>
        <div class="brain-tooltip" data-brain-tooltip hidden></div>
      </div>
    </section>
  </div>
  <div class="focus-stats">
    <div class="stat-row" data-focus-stats></div>
    <div class="dash-grid">
      <div class="panel"><div class="panel-head"><h3>This week</h3><span class="mono-label" data-week-total></span></div><div class="bars" data-week-bars></div></div>
      <div class="panel"><div class="panel-head"><h3>Recent sessions</h3></div><ul class="session-list" data-session-list></ul></div>
    </div>
  </div>
</div>""")


def render_tasks():
    return app_page("tasks", "Tasks", "Lists, priorities, a matrix and a week planner.", """
<div class="tasks-app" data-tasks-root>
  <aside class="tasks-side" data-tasks-side></aside>
  <section class="tasks-main">
    <header class="tasks-head">
      <div><p class="mono-label" data-list-kicker>Smart list</p><h1 data-list-title>Today</h1></div>
      <div class="seg" data-views><button data-view="list" class="is-active">List</button><button data-view="matrix">Matrix</button><button data-view="week">Week</button></div>
    </header>
    <form class="quick-add" data-quick-add autocomplete="off">
      <span class="qa-plus">+</span>
      <input name="q" placeholder="Add a task — try “Read Raft paper tomorrow !high #reading”" aria-label="Add a task">
      <div class="qa-chips" data-qa-chips></div>
    </form>
    <div class="tasks-view" data-tasks-view></div>
  </section>
  <aside class="task-detail" data-task-detail hidden></aside>
</div>""")


def render_habits():
    return app_page("habits", "Habits", "Streaks, habits and your learning heatmap.", """
<div class="wrap habits-page">
  <header class="page-head"><div><p class="mono-label">Consistency</p><h1>Habits &amp; streaks</h1></div></header>
  <div class="stat-row" data-habit-stats></div>
  <section class="panel"><div class="panel-head"><h3>Activity</h3><span class="mono-label">Last 26 weeks · lessons + focus</span></div><div class="heatmap-wrap" data-heatmap></div></section>
  <section class="panel"><div class="panel-head"><h3>Daily habits</h3><span class="mono-label" data-week-range></span></div>
    <div class="habit-list" data-habit-list></div>
    <form class="habit-add" data-habit-add><input name="name" placeholder="New habit — e.g. “Review flashcards”" aria-label="New habit" maxlength="60"><button class="btn btn-primary sm" type="submit">Add habit</button></form>
  </section>
</div>""")


# ───────────────────────────── build ─────────────────────────────

def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def main():
    if not SRC.is_dir():
        sys.exit(f"source not found: {SRC}")
    tracks = load()
    TRACKS[:] = tracks
    if OUT.exists():
        shutil.rmtree(OUT)
    shutil.copytree(HERE / "assets", OUT / "assets")

    path = [(t, tp, l) for t in tracks for tp in t["topics"] for l in tp["lessons"]]
    write(OUT / "assets" / "path.js", "window.BB_PATH=" + json.dumps(
        [[t["slug"], [f"{tp['slug']}/{l['slug']}" for tp in t["topics"] for l in tp["lessons"]]] for t in tracks],
        separators=(",", ":")) + ";")
    write(OUT / "404.html", render_404())
    index = [["Your brain", "brain/index.html", "", "", "p", "neurons map regions progress"],
             ["Skill map · all tracks", "tracks/index.html", "", "", "p", "tracks roadmap mind map path"],
             ["Focus timer", "focus/index.html", "", "", "p", "pomodoro timer deep focus"],
             ["Tasks", "tasks/index.html", "", "", "p", "todo list matrix week planner"],
             ["Habits & streaks", "habits/index.html", "", "", "p", "heatmap streak"]]
    write(OUT / "index.html", render_home(tracks))
    write(OUT / "brain" / "index.html", render_brain())
    write(OUT / "tracks" / "index.html", render_tracks(tracks))
    idx = {t["slug"]: i for i, t in enumerate(tracks)}
    write(OUT / "assets" / "map-data.js", "window.BB_MAP=" + json.dumps({
        "tracks": [dict(slug=t["slug"], num=t["num"], title=strip_tags(t["title"]), q=QUESTIONS.get(t["slug"], ""), color=t["color"],
                        domain=t["domain"]["name"], minutes=t["minutes"],
                        topics=[dict(slug=tp["slug"], title=strip_tags(tp["title"]),
                                     lessons=[[l["slug"], strip_tags(l["title"]), l["minutes"]] for l in tp["lessons"]]) for tp in t["topics"]])
                   for t in tracks],
        "edges": [[idx[a], idx[b]] for a, b in MAP_EDGES if a in idx and b in idx],
    }, ensure_ascii=False, separators=(",", ":")) + ";")
    write(OUT / "focus" / "index.html", render_focus())
    write(OUT / "tasks" / "index.html", render_tasks())
    write(OUT / "habits" / "index.html", render_habits())
    for t in tracks:
        tt = strip_tags(t["title"])
        index.append([tt, f"{t['slug']}/index.html", t["domain"]["name"], "", "k", ""])
        write(OUT / t["slug"] / "index.html", render_track(t))
        flat = [(t, tp, l) for tp in t["topics"] for l in tp["lessons"]]
        g0 = next(i for i, x in enumerate(path) if x[2] is flat[0][2])
        for ti, tp in enumerate(t["topics"]):
            index.append([strip_tags(tp["title"]), f"{t['slug']}/{tp['slug']}/index.html", tt, "", "t", ""])
            write(OUT / t["slug"] / tp["slug"] / "index.html", render_topic(t, ti, tp))
        for fi, (_, tp, l) in enumerate(flat):
            gi = g0 + fi
            prev = path[gi - 1] if gi > 0 else None
            nxt = path[gi + 1] if gi + 1 < len(path) else None
            lid = lesson_id(t, tp, l)
            write(OUT / lid / "index.html",
                  render_lesson(t, t["topics"].index(tp), tp, tp["lessons"].index(l), l, prev, nxt, fi, len(flat)))
            index.append([strip_tags(l["title"]), f"{lid}/index.html", tt, strip_tags(tp["title"]), "l",
                          " ".join(h for _, h in l["toc"])])

    data = {
        "domains": [dict(id=d["id"], name=d["name"], short=d["short"], color=d["color"], anchor=d["anchor"],
                         blurb=d["blurb"], soon=bool(d.get("soon")),
                         total=sum(t["n_lessons"] for t in tracks if t["domain"] is d)) for d in DOMAINS],
        "tracks": {t["slug"]: dict(t=strip_tags(t["title"]), d=t["domain"]["id"], n=t["n_lessons"], num=t["num"]) for t in tracks},
        "total": sum(t["n_lessons"] for t in tracks),
    }
    write(OUT / "assets" / "data.js", "window.BB_DATA=" + json.dumps(data, separators=(",", ":")) + ";")
    write(OUT / "assets" / "search-index.js",
          "window.SEARCH_INDEX=" + json.dumps(index, ensure_ascii=False, separators=(",", ":")) + ";")

    n_lessons = sum(1 for r in index if r[4] == "l")
    print(f"built {len(tracks)} tracks, {sum(len(t['topics']) for t in tracks)} topics, {n_lessons} lessons → {OUT}")


if __name__ == "__main__":
    main()
