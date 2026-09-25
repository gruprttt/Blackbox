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
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import mdx

HERE = Path(__file__).resolve().parent
SRC = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else (HERE.parent / "learn")
OUT = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else (HERE / "dist")
SITE = "BLACKBOX"

# Open-source content pulled in at build time (cloned into ./vendor, which git ignores).
# Set BLACKBOX_OFFLINE=1 to build without fetching; delete a folder under vendor/ to refresh it.
VENDOR = HERE / "vendor"
SOURCES = {
    "backend": dict(repo="https://github.com/DsThakurRawat/Backend-from-first-Principle",
                    site="https://backend-from-first-principle.vercel.app", author="@DsThakurRawat"),
    "a2z": dict(repo="https://github.com/ashutosh-mishr/AtoZ-DSA-Practice",
                site="https://dsapractice.indevs.in", author="@ashutosh-mishr"),
}


def vendor(name):
    """Path to a cloned source, cloning it on first use. None if it can't be had."""
    dest = VENDOR / name
    if dest.is_dir() and any(dest.iterdir()):
        return dest
    if os.environ.get("BLACKBOX_OFFLINE") == "1":
        return None
    print(f"fetching {SOURCES[name]['repo']} → vendor/{name} …", file=sys.stderr)
    try:
        VENDOR.mkdir(exist_ok=True)
        subprocess.run(["git", "clone", "--depth", "1", "--quiet", SOURCES[name]["repo"], str(dest)], check=True, timeout=300)
        return dest
    except (OSError, subprocess.SubprocessError) as e:
        print(f"note: couldn't fetch {name} ({e}); building without it", file=sys.stderr)
        shutil.rmtree(dest, ignore_errors=True)
        return None

TAGLINE = "Where engineers figure things out."

# The brain is split into lobes, one per program. `anchor` is where that lobe sits on the brain
# (x: left→right, y: down→up, z: back→front); neurons are assigned to the nearest anchor.
# Click a lobe on the Brain page to go inside it: its tracks/topics become the regions, and so on
# down to single lessons and problems. Lobes marked `soon` show up dormant.
LOBES = [
    dict(id="devops", name="DevOps & SRE", short="DevOps", color="#5b8cff", anchor=(.5, .3, .3), href="index.html#path",
         blurb="Linux, networking, IaC, Kubernetes, CI/CD, observability, databases and security."),
    dict(id="dsa", name="Data Structures & Algorithms", short="DSA", color="#22d3ee", anchor=(-.5, .22, .3), href="dsa/index.html",
         blurb="Striver's A2Z sheet — 474 problems from basics to DP."),
    dict(id="system-design", name="System Design", short="Design", color="#f472b6", anchor=(0, .5, -.4), href="system-design/index.html",
         blurb="Estimation, caching, storage, messaging and classic designs."),
    dict(id="backend", name="Backend Engineering", short="Backend", color="#34d399", anchor=(0, .12, .88), href="backend/index.html",
         blurb="Backend from First Principles — HTTP to AI agents, 26 chapters."),
    dict(id="cybersecurity", name="Cybersecurity", short="Security", color="#ff4d5e", anchor=(.45, -.2, -.5), soon=True,
         blurb="Offensive and defensive security beyond DevSecOps."),
    dict(id="ai-ml", name="AI & Machine Learning", short="AI/ML", color="#fbbf24", anchor=(-.45, -.2, -.5), soon=True,
         blurb="ML foundations, LLMs, training and serving."),
]
LOBE_BY_ID = {d["id"]: d for d in LOBES}
# Old per-area domain ids (focus history recorded before lobes existed) now belong to DevOps.
DOMAIN_ALIASES = {"foundations": "devops", "code": "devops", "systems": "devops", "distributed": "devops",
                  "infra": "devops", "reliability": "devops", "security": "devops", "ai": "devops", "design": "system-design", "be": "backend"}

# DevOps areas: colour and label for each track inside the DevOps lobe.
DOMAINS = [
    dict(id="foundations", name="Thinking & Leadership", short="Thinking", color="#a78bfa",
         tracks=["the-foundation-systems-thinking", "organizational-design-influence"]),
    dict(id="code", name="Code & Craft", short="Code", color="#5b8cff",
         tracks=["code-scripting-version-control", "algorithmic-interviews-career-strategy"]),
    dict(id="systems", name="Systems & Networks", short="Systems", color="#38bdf8",
         tracks=["operating-systems-kernel-hardware-sympathy", "networking-internet-governance"]),
    dict(id="distributed", name="Distributed Systems", short="Distributed", color="#2dd4bf",
         tracks=["distributed-systems-algorithms-at-scale"]),
    dict(id="infra", name="Cloud & Platform", short="Cloud", color="#a3e635",
         tracks=["infrastructure-as-code-iac", "containerization-wasm-kubernetes", "aws-mastery-the-reference-implementation",
                 "ci-cd-release-engineering", "platform-engineering-strategy", "finops-greenops"]),
    dict(id="reliability", name="Reliability & Data", short="Reliability", color="#fb923c",
         tracks=["observability-sre", "incident-command-resilience", "database-reliability-engineering-dbre"]),
    dict(id="security", name="Security Engineering", short="Security", color="#ff4d5e",
         tracks=["security-engineering-devsecops"]),
    dict(id="ai", name="AI & Data", short="AI", color="#fbbf24",
         tracks=["ai-infrastructure-dataops"]),
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
    dict(id="devops-sre", lobe="devops", name="DevOps & SRE", color="#5b8cff",
         blurb="Foundations to incident command: Linux, networking, IaC, Kubernetes, CI/CD, observability, databases, security and platform strategy."),
    dict(id="dsa", lobe="dsa", name="Data Structures & Algorithms", color="#22d3ee",
         blurb="Striver's A2Z sheet: 18 topics and 474 problems, from the basics through graphs and dynamic programming."),
    dict(id="system-design", lobe="system-design", name="System Design", color="#f472b6",
         blurb="Design large-scale systems end to end — estimation, caching, storage, messaging, failure modes and classic designs."),
    dict(id="backend", lobe="backend", name="Backend Engineering", color="#34d399",
         blurb="Backend from First Principles: HTTP, auth, APIs, databases, caching, queues, security, scaling and more — in Go, Python, JS/TS and Java."),
    dict(id="cybersecurity", lobe="cybersecurity", name="Cybersecurity", color="#ff4d5e", soon=True,
         blurb="Offensive and defensive security beyond DevSecOps: threat hunting, exploitation, hardening.",
         region_note="Wakes the Cybersecurity lobe"),
    dict(id="ai-ml", lobe="ai-ml", name="AI & Machine Learning", color="#fbbf24", soon=True,
         blurb="ML foundations, LLMs, training and serving — the systems behind modern AI.",
         region_note="Wakes the AI & ML lobe"),
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
    if not SRC.is_dir():
        print(f"note: no lesson source at {SRC} — building DSA and System Design only", file=sys.stderr)
        return tracks
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
        t["lobe"] = "devops"
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
    "code": svg('<path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16"/>'),
    "design": svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="8.5" y="14" width="7" height="7" rx="1.5"/><path d="M6.5 10v2h11v-2M12 12v2"/>'),
    "server": svg('<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6"/>'),
    "user": svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    "ext": svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
}

NAV = [("Learn", "index.html", "learn", ("home",)),
       ("Tracks", "tracks/index.html", "map", ("tracks", "track", "topic", "lesson")),
       ("DSA", "dsa/index.html", "code", ("dsa",)),
       ("Design", "system-design/index.html", "design", ("sd",)),
       ("Backend", "backend/index.html", "server", ("be", "be-chapter")),
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
TABBAR = ("Learn", "DSA", "Brain", "Focus", "Tasks")


def logo(size=""):
    return f'<span class="logo {size}"><span class="logo-box" aria-hidden="true"><i></i></span>BLACKBOX</span>'


def page(*, title, desc, root, body, kind):
    extra = ""
    if kind in ("home", "tracks"):
        extra = f'<script src="{root}assets/path.js" defer></script>\n'
    if kind == "tracks":
        extra += f'<script src="{root}assets/map-data.js" defer></script>\n<script src="{root}assets/views.js" defer></script>\n<script src="{root}assets/mindmap.js" defer></script>\n'
    if kind == "brain":
        extra += f'<script src="{root}assets/brain-tree.js" defer></script>\n'
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
              if kind in ("lesson", "be-chapter") else "")
    bar = '<div class="read-progress" aria-hidden="true"><span></span></div>' if kind in ("lesson", "be-chapter") else ""
    def item(label, href, icon, kinds):
        link = f'<a href="{root}{href}" title="{label}"{" aria-current=page class=is-active" if kind in kinds else ""}>{ICON[icon]}<span>{label}</span></a>'
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
      <div class="acct" data-account>
        <a class="acct-btn" href="{root}login/index.html" data-account-btn>{ICON["user"]}<span data-account-name>Sign in</span></a>
        <div class="acct-menu" data-account-menu hidden>
          <p class="mono-label">Signed in as</p><b data-account-user></b>
          <button data-open-settings>{ICON["gear"]}Settings &amp; password</button>
          <button data-sign-out>{ICON["left"]}Sign out</button>
        </div>
      </div>
    </div>
  </div>
  {bar}
</header>"""


def footer(root):
    domains = "".join(f'<li><a href="{root}{d["href"]}"><i style="--c:{d["color"]}"></i>{d["name"]}</a></li>'
                      for d in LOBES if not d.get("soon"))
    app = "".join(f'<li><a href="{root}{href}">{label}</a></li>' for label, href, _, _ in NAV[1:])
    return f"""<footer class="footer">
  <div class="wrap footer-top">
    <div class="footer-brand">
      <a href="{root}index.html">{logo("lg")}</a>
      <p class="tagline">{TAGLINE}</p>
      <p class="fine">Lesson content © HamChops. DSA problem list from Striver's A2Z sheet. Sign in and your progress, tasks and focus history are saved to your BLACKBOX account.</p>
      <p class="fine"><span class="sync-status" data-sync-status></span></p>
    </div>
    <div class="footer-cols">
      <div><h4>Programs</h4><ul>{domains}</ul></div>
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
        for label, href, icon, kinds in NAV if label in TABBAR
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


def devops_prefix(tracks):
    return "|".join(t["slug"] + "/" for t in tracks) or "devops-none/"


def render_home(tracks, sheets):
    root = ""
    prog = PROGRAMS[0]
    n_lessons = sum(t["n_lessons"] for t in tracks)
    if tracks:
        first = tracks[0]["topics"][0]["lessons"][0]
        first_href = f"{lesson_id(tracks[0], tracks[0]['topics'][0], first)}/index.html"
    else:
        first_href = "dsa/index.html"
    steps = path_steps(tracks)
    programs = []
    for i, pg in enumerate(PROGRAMS, 1):
        sheet = sheets.get(pg["lobe"])
        if sheet:
            programs.append(f"""<a class="program live" href="{sheet['href']}" style="--c:{pg['color']}">
  <div class="program-top"><span class="mono-label">Program {i:02d}</span><span class="badge live-badge"><span class="rec live"></span>Live</span></div>
  <h3>{pg['name']}</h3><p>{pg['blurb']}</p>
  <p class="program-meta mono-label">{sheet['meta']}</p>
  {progress(sheet['prefix'], sheet['total'])}
</a>""")
        elif pg.get("soon") or not tracks:
            programs.append(f"""<div class="program soon" style="--c:{pg['color']}">
  <div class="program-top"><span class="mono-label">Program {i:02d}</span><span class="badge">Coming soon</span></div>
  <h3>{pg['name']}</h3><p>{pg['blurb']}</p>
  <p class="program-meta mono-label">{pg.get('region_note', 'Add lessons to wake this lobe')}</p>
</div>""")
        else:
            programs.append(f"""<a class="program live" href="#path" style="--c:{pg['color']}">
  <div class="program-top"><span class="mono-label">Program {i:02d}</span><span class="badge live-badge"><span class="rec live"></span>Live</span></div>
  <h3>{pg['name']}</h3><p>{pg['blurb']}</p>
  <p class="program-meta mono-label">{len(tracks)} tracks · {n_lessons:,} lessons · {fmt_minutes(sum(t['minutes'] for t in tracks))}</p>
  {progress(devops_prefix(tracks), n_lessons)}
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
      <p class="kicker"><span class="rec live"></span>{1 + len(sheets) if tracks else len(sheets)} programs live · {n_lessons + sum(sh['total'] for sh in sheets.values()):,} lessons, problems &amp; concepts</p>
      <h1>Where engineers<br><span class="grad">figure things out.</span></h1>
      <p class="lede">DevOps &amp; SRE lessons, Striver's A2Z DSA sheet and a System Design track — with focus sessions, tasks, habits and a brain that visibly grows as you learn.</p>
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
  <div class="section-title"><div><span class="mono-label">/ programs</span><h2>Every program is a lobe of your brain.</h2>
    <p class="section-sub">DevOps &amp; SRE, DSA and System Design are live — each one wires its own lobe. Open the Brain and click a lobe to go inside it.</p></div></div>
  <div class="program-grid">{''.join(programs)}</div>
</section>

<section class="wrap library" id="path">
  <div class="section-title"><div><span class="mono-label">/ program 01 · {prog['name']}</span><h2>{len(tracks)} tracks, in order</h2>
    <p class="section-sub">Work from Track 01 to Track {len(tracks):02d}. Next and Previous carry you straight into the next track.</p></div>
    <div class="overall">{progress(devops_prefix(tracks), n_lessons)}</div></div>
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
               f'<button class="btn btn-ghost on-dark" data-focus-domain="{track["lobe"]}"><span class="rec"></span>Focus on this</button>'
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
    <article class="lesson" data-lesson-id="{lid}" data-domain="{track['lobe']}" data-lesson-title="{html.escape(strip_tags(lesson['title']))}" data-lesson-sub="{html.escape(strip_tags(topic['title']))}">
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
    def chip(i, pg):
        if pg.get("soon"):
            return f'<button class="prog-chip" disabled style="--c:{pg["color"]}"><i></i>{pg["name"]} <em>soon</em></button>'
        if i == 0:
            return f'<button class="prog-chip is-active" style="--c:{pg["color"]}"><i></i>{pg["name"]}</button>'
        return f'<a class="prog-chip" href="{root}{LOBE_BY_ID[pg["lobe"]]["href"]}" style="--c:{pg["color"]}"><i></i>{pg["name"]}</a>'
    progs = "".join(chip(i, pg) for i, pg in enumerate(PROGRAMS))
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
    return app_page("brain", "Your brain", "Your knowledge, visualised as a growing neural network.", f"""
<div class="brain-page">
  <section class="console console-stage">
   <div class="console-bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="console-title" data-brain-path>cortex@blackbox:~ — neural map</span><span class="live-tag"><span class="rec live"></span>live</span></div>
   <div class="console-screen brain-stage" data-brain-stage>
    <canvas data-brain="full" aria-label="Interactive 3D brain"></canvas>
    <div class="stage-top">
      <nav class="brain-crumbs" data-brain-crumbs aria-label="Brain level"></nav>
      <h1 data-level-title>Your brain</h1>
      <p class="stage-sub" data-level-sub>Every lesson you finish, problem you solve and focus minute wires new neurons. Click a lobe to go inside it.</p>
    </div>
    <dl class="stage-stats">
      <div><dt>Neurons</dt><dd data-stat="neurons">0</dd></div>
      <div><dt>Synapses</dt><dd data-stat="synapses">0</dd></div>
      <div><dt data-regions-label>Lobes active</dt><dd data-stat="regions">0</dd></div>
    </dl>
    <button class="stage-up" data-brain-up hidden>{ICON['left']}<span>Back out</span></button>
    <p class="stage-tip mono-label">Drag to rotate · scroll to zoom · click to go inside</p>
    <div class="stage-time mono-label" data-time-label hidden></div>
    <div class="brain-tooltip" data-brain-tooltip hidden></div>
   </div>
   <div class="timeline" data-timeline>
     <button class="icon-btn" data-time-play aria-label="Replay how your brain grew">{ICON['play']}</button>
     <div class="tl-track">
       <canvas data-growth-chart aria-hidden="true"></canvas>
       <input type="range" min="0" max="100" value="100" step="1" data-time-range aria-label="Time travel through your brain's growth">
     </div>
     <div class="tl-meta"><span class="mono-label">Growth</span><b data-time-date>Today</b><span data-time-delta></span></div>
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


# ───────────────────────────── DSA & System Design sheets ─────────────────────────────

DIFF_CLASS = {"Easy": "d-easy", "Medium": "d-med", "Hard": "d-hard"}
LINK_LABELS = [("lc", "LeetCode"), ("gfg", "GFG"), ("article", "TUF"), ("yt", "YouTube")]
LINK_TONE = {"LeetCode": "lk-lc", "GFG": "lk-gfg", "TUF": "lk-tuf", "YouTube": "lk-yt"}


def load_sheets():
    """Normalise both sheets to: topics → subs → items, each item with a stable progress id."""
    sheets = {}
    dsa_path, sd_path = HERE / "data" / "dsa-a2z.json", HERE / "data" / "system-design.json"
    if dsa_path.exists():
        raw = json.loads(dsa_path.read_text(encoding="utf-8"))
        topics = []
        for t in raw["topics"]:
            short, _, note = t["name"].partition("[")
            topic = dict(id=t["id"], slug=f"{t['id']}-{slugify(short)}", name=short.strip(), note=note.rstrip("]").strip(), subs=[])
            for sub in t["subtopics"]:
                items = []
                for pr in sub["problems"]:
                    meta = " · ".join(x for x in (pr.get("pattern"), pr.get("time") and f"{pr['time']} time",
                                                  pr.get("space") and f"{pr['space']} space") if x)
                    items.append(dict(id=f"dsa/{t['id']}/{sub['id']}/{pr['id']}", anchor=pr["id"], name=pr["name"], level=pr["level"],
                                      meta=meta, links=[(label, pr[k]) for k, label in LINK_LABELS if pr.get(k)],
                                      hint={k: pr[k] for k in ("pattern", "time", "space", "approach", "brute") if pr.get(k)}))
                topic["subs"].append(dict(id=f"dsa/{t['id']}/{sub['id']}", anchor=f"{t['id']}-{sub['id']}", name=sub["name"], items=items))
            topics.append(topic)
        src = vendor("a2z")
        sol_path = src / "database" / "data" / "solutions.json" if src else None
        if sol_path and sol_path.exists():
            sols = {x["problem_id"].lower(): x for x in json.loads(sol_path.read_text(encoding="utf-8"))["solutions"] if x.get("code")}
            for t in topics:
                for sb in t["subs"]:
                    for it in sb["items"]:
                        x = sols.get(it["anchor"])
                        if x:
                            it["solution"] = dict(statement=(x.get("problem_statement") or "").strip(), examples=(x.get("examples") or "").strip(),
                                                  approach=(x.get("optimal_approach") or "").strip(), code=x["code"].rstrip(),
                                                  lang=(x.get("code_language") or "C++"), file=x.get("source_file", ""))
        sheets["dsa"] = dict(lobe="dsa", dir="dsa", prefix="dsa/", name="DSA · Striver's A2Z sheet", short="DSA", color=LOBE_BY_ID["dsa"]["color"],
                             noun="problem", done_label="Solved", todo_label="Mark solved", topics=topics,
                             lede="Every problem from Striver's A2Z DSA sheet, in order — 18 topics from language basics through graphs, "
                                  "dynamic programming and tries. Tick a problem when you've solved it and it wires a neuron in your DSA lobe.")
    if sd_path.exists():
        raw = json.loads(sd_path.read_text(encoding="utf-8"))
        topics = []
        for t in raw["topics"]:
            items = [dict(id=f"sd/{t['id']}/{c['id']}", anchor=c["id"], name=c["name"], desc=c["desc"]) for c in t["concepts"]]
            topics.append(dict(id=t["id"], slug=t["id"], name=t["name"], note="", subs=[dict(id=f"sd/{t['id']}", anchor="", name="", items=items)]))
        sheets["system-design"] = dict(lobe="system-design", dir="system-design", prefix="sd/", name="System Design", short="Design",
                                       color=LOBE_BY_ID["system-design"]["color"], noun="concept", done_label="Learned", todo_label="Mark learned",
                                       topics=topics,
                                       lede="From estimation and caching to consensus and classic interview designs. Work through each concept, "
                                            "mark it learned and watch your System Design lobe light up.")
    for sh in sheets.values():
        for i, t in enumerate(sh["topics"]):
            t["num"] = f"{i + 1:02d}"
            t["prefix"] = f"{sh['prefix']}{t['id']}/"
            t["total"] = sum(len(sb["items"]) for sb in t["subs"])
        sh["total"] = sum(t["total"] for t in sh["topics"])
        sh["href"] = f"{sh['dir']}/index.html"
        sh["meta"] = f"{len(sh['topics'])} topics · {sh['total']:,} {sh['noun']}s"
    return sheets


def sheet_banner(root, sh, num, crumb_items, kicker, title, meta, actions):
    return banner(root, dict(color=sh["color"], num=num), crumbs(root, crumb_items), kicker, title, meta, actions)


def item_row(sh, it):
    if sh["lobe"] == "dsa":
        links = "".join(f'<a href="{html.escape(url)}" target="_blank" rel="noopener">{label}</a>' for label, url in it["links"])
        body = (f'<span class="it-main"><a class="it-title" href="#{it["anchor"]}">{html.escape(it["name"])}</a>'
                + (f'<span class="it-meta">{html.escape(it["meta"])}</span>' if it["meta"] else "") + "</span>"
                f'<span class="diff {DIFF_CLASS.get(it["level"], "")}">{it["level"]}</span>'
                f'<span class="it-links">{links}</span>')
        level = f' data-level="{it["level"]}"'
    else:
        body = (f'<span class="it-main"><a class="it-title" href="#{it["anchor"]}">{html.escape(it["name"])}</a>'
                f'<span class="it-desc">{html.escape(it["desc"])}</span></span>')
        level = ""
    return (f'<li class="item" id="{it["anchor"]}" data-lesson="{it["id"]}"{level}>'
            f'<button class="it-check" type="button" data-toggle-done aria-label="{sh["todo_label"]}: {html.escape(it["name"])}">{ICON["check"]}</button>'
            f"{body}</li>")


STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>'
REV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>'
INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>'


def dsa_row(it, n, sol_prefix="../solution/"):
    """One problem, laid out like the dsapractice roadmap: solved, bookmark, revision, pattern, practice links, notes."""
    name = html.escape(it["name"])
    links = "".join(f'<a class="lk {LINK_TONE[label]}" href="{html.escape(url)}" target="_blank" rel="noopener">{label}</a>'
                    for label, url in it["links"])
    h = it["hint"]
    pop = (f'<p class="mono-label">Pattern / hint</p><b>{html.escape(h.get("pattern", "No pattern added yet."))}</b>'
           + (f'<div class="pp-cx"><span><em>Time</em>{html.escape(h.get("time", "—"))}</span><span><em>Space</em>{html.escape(h.get("space", "—"))}</span></div>'
              if h.get("time") or h.get("space") else "")
           + (f'<p class="mono-label">Brute force</p><p>{html.escape(h["brute"])}</p>' if h.get("brute") else "")
           + (f'<p class="mono-label">Approach</p><p>{html.escape(h["approach"])}</p>' if h.get("approach") else ""))
    return (f'<tr class="prob" id="{it["anchor"]}" data-lesson="{it["id"]}" data-level="{it["level"]}">'
            f'<td class="pn">{n}</td><td class="pt"><a href="#{it["anchor"]}">{name}</a></td>'
            f'<td><span class="diff {DIFF_CLASS.get(it["level"], "")}">{it["level"]}</span></td>'
            f'<td class="c"><button class="it-check" type="button" data-toggle-done aria-label="Solved: {name}">{ICON["check"]}</button></td>'
            f'<td class="c"><button class="mk mk-b" type="button" data-mark="b" aria-label="Bookmark: {name}" title="Bookmark">{STAR}</button></td>'
            f'<td class="c"><button class="mk mk-r" type="button" data-mark="r" aria-label="Revision: {name}" title="Add to revision">{REV}</button></td>'
            f'<td class="c pat"><button class="mk" type="button" data-pattern aria-label="Pattern and hint: {name}" title="Pattern &amp; hint">{INFO}</button>'
            f'<div class="pat-pop" hidden>{pop}</div></td>'
            f'<td><div class="links">{links}'
            + (f'<a class="lk lk-sol" href="{sol_prefix}{it["anchor"]}/index.html">Solution</a>' if it.get("solution") else "")
            + '<button class="lk lk-note" type="button" data-note>Notes</button></div></td></tr>')


PROB_HEAD = ('<thead><tr><th class="pn">#</th><th>Problem</th><th>Difficulty</th><th class="c">Solved</th><th class="c">Bookmark</th>'
             '<th class="c">Revision</th><th class="c">Pattern</th><th>Practice</th></tr></thead>')


def render_dsa_index(sh):
    root = "../"
    rows = "".join(f"""<tr data-progress-prefix="{t['prefix']}" data-progress-total="{t['total']}">
  <td class="pn">{int(t['num'])}</td>
  <td><a class="rt-name" href="{t['slug']}/index.html">{html.escape(t['name'])}</a>{f'<span class="rt-note">{html.escape(t["note"])}</span>' if t['note'] else ''}</td>
  <td class="r">{t['total']}</td><td class="r"><b data-progress-count>0</b></td>
  <td><div class="rt-bar"><div class="progress-bar"><span></span></div><em data-progress-pct>0%</em></div></td>
  <td class="r"><a class="lk lk-open" href="{t['slug']}/index.html">View problems</a></td>
</tr>""" for t in sh["topics"])
    counts = {}
    for t in sh["topics"]:
        for sb in t["subs"]:
            for it in sb["items"]:
                counts[it["level"]] = counts.get(it["level"], 0) + 1
    levels = ('<div class="level-stats">' + "".join(
        f'<div class="stat {DIFF_CLASS[k]}"><span class="mono-label">{k}</span><b><span data-level-done="{k}">0</span><small>/ {counts.get(k, 0)}</small></b></div>'
        for k in ("Easy", "Medium", "Hard")) + "</div>"
        + "<script>window.BB_LEVELS=" + json.dumps({it["id"]: it["level"][0] for t in sh["topics"] for sb in t["subs"] for it in sb["items"]},
                                                    separators=(",", ":")) + ";</script>")
    actions = (f'<a class="btn btn-primary" href="{sh["topics"][0]["slug"]}/index.html">{ICON["play"]}<span>Start</span></a>'
               f'<button class="btn btn-ghost on-dark" data-focus-domain="dsa"><span class="rec"></span>Focus on this</button>'
               f'<a class="btn btn-ghost on-dark" href="{root}brain/index.html#dsa">{ICON["brain"]}See it in your brain</a>'
               f'<div class="banner-progress">{progress(sh["prefix"], sh["total"])}</div>')
    body = f"""<main id="main" style="--c:{sh['color']}">
{sheet_banner(root, sh, "DSA", [('Learn', 'index.html#programs'), ('DSA Roadmap', None)], f"Roadmap · {len(sh['topics'])} topics · {sh['total']} problems", "DSA Roadmap", sh['lede'], actions)}
<section class="wrap section">
  {levels}
  <div class="seg dsa-tabs" data-dsa-tabs><button data-tab="roadmap" class="is-active">Roadmap</button><button data-tab="r">Revision <b data-mark-count="r">0</b></button><button data-tab="b">Bookmarks <b data-mark-count="b">0</b></button></div>
  <div data-tab-pane="roadmap">
    <div class="table-wrap"><table class="rt">
      <thead><tr><th class="pn">#</th><th>Topic</th><th class="r">Problems</th><th class="r">Solved</th><th>Progress</th><th class="r">Open</th></tr></thead>
      <tbody>{rows}</tbody></table></div>
    <div class="topic-tools"><span></span><button class="link-btn danger" data-reset-prefix="{sh['prefix']}" data-reset-label="DSA">Reset DSA progress</button></div>
  </div>
  <div data-tab-pane="collection" hidden>
    <p class="coll-sub" data-coll-sub></p>
    <div class="table-wrap"><table class="pt-table">{PROB_HEAD}<tbody data-coll-body></tbody></table></div>
  </div>
</section>
</main>"""
    return page(title=f"DSA Roadmap · {SITE}", desc=sh["lede"], root=root, body=body, kind="dsa")


def render_dsa_topic(sh, ti):
    root = "../../"
    t = sh["topics"][ti]
    prev_t = sh["topics"][ti - 1] if ti > 0 else None
    next_t = sh["topics"][ti + 1] if ti + 1 < len(sh["topics"]) else None
    nav = '<div class="pager">'
    nav += (f'<a class="pager-card prev" href="../{prev_t["slug"]}/index.html" data-nav-prev><span>{ICON["left"]} Previous topic</span><strong>{html.escape(prev_t["name"])}</strong></a>' if prev_t else "<span></span>")
    nav += (f'<a class="pager-card next" href="../{next_t["slug"]}/index.html" data-nav-next><span>Next topic {ICON["right"]}</span><strong>{html.escape(next_t["name"])}</strong></a>' if next_t else "<span></span>")
    nav += "</div>"
    subs = []
    for sb in t["subs"]:
        rows = "".join(dsa_row(it, i) for i, it in enumerate(sb["items"], 1))
        subs.append(f"""<details class="sheet-sub dsa-sub" id="{sb['anchor']}">
  <summary><span class="chev">{ICON['chev']}</span><h2>{html.escape(sb['name'])}</h2>
    <span class="ds-prog" data-progress-prefix="{sb['id']}/" data-progress-total="{len(sb['items'])}"><span class="ds-lab"><span><b data-progress-count>0</b>/{len(sb['items'])} solved</span><em data-progress-pct>0%</em></span><span class="progress-bar"><span></span></span></span>
    <span class="ds-n">{len(sb['items'])} problems</span></summary>
  <div class="table-wrap"><table class="pt-table">{PROB_HEAD}<tbody>{rows}</tbody></table></div>
</details>""")
    actions = (f'<a class="btn btn-primary" href="#{t["subs"][0]["items"][0]["anchor"]}" data-resume="{t["prefix"]}">{ICON["play"]}<span>Start topic</span></a>'
               f'<button class="btn btn-ghost on-dark" data-focus-domain="dsa"><span class="rec"></span>Focus on this</button>'
               f'<a class="btn btn-ghost on-dark" href="{root}brain/index.html#{sh["prefix"]}{t["id"]}">{ICON["brain"]}In your brain</a>'
               f'<div class="banner-progress">{progress(t["prefix"], t["total"])}</div>')
    body = f"""<main id="main" style="--c:{sh['color']}">
{sheet_banner(root, sh, t['num'], [('DSA Roadmap', 'dsa/index.html'), (html.escape(t['name']), None)],
              f"DSA · Topic {t['num']} of {len(sh['topics']):02d}" + (f" · {html.escape(t['note'])}" if t['note'] else ""),
              html.escape(t['name']), f"{t['total']} problems in {len(t['subs'])} section{'s' if len(t['subs']) > 1 else ''}", actions)}
<section class="wrap section sheet">
  <div class="filter-bar"><p data-filter-count>Showing {t['total']} of {t['total']} problems</p>
    <div><select data-status-filter aria-label="Problem status"><option value="all">All problems</option><option value="solved">Solved</option><option value="unsolved">Unsolved</option></select>
    <select data-level-filter aria-label="Difficulty"><option value="all">Difficulty</option><option>Easy</option><option>Medium</option><option>Hard</option></select>
    <button class="lk" type="button" data-expand-subs>Expand all</button></div></div>
  <div class="dsa-subs">{''.join(subs)}</div>
  {nav}
</section>
</main>"""
    return page(title=f"{t['name']} · DSA · {SITE}", desc=f"{t['name']} — DSA roadmap", root=root, body=body, kind="dsa")


def render_sheet_index(sh):
    root = "../"
    cards = "".join(f"""<a class="track-card" href="{t['slug']}/index.html" style="--c:{sh['color']}">
  <div class="tc-top"><span class="tc-num">{t['num']}</span><span class="tc-go">{ICON['right']}</span></div>
  <h4>{html.escape(t['name'])}</h4>
  <p class="tc-meta">{html.escape(t['note']) + ' · ' if t['note'] else ''}{t['total']} {sh['noun']}s</p>
  {progress(t['prefix'], t['total'])}
</a>""" for t in sh["topics"])
    levels = ""
    if sh["lobe"] == "dsa":
        counts = {}
        for t in sh["topics"]:
            for sb in t["subs"]:
                for it in sb["items"]:
                    counts[it["level"]] = counts.get(it["level"], 0) + 1
        levels = '<div class="level-stats">' + "".join(
            f'<div class="stat {DIFF_CLASS[k]}"><span class="mono-label">{k}</span><b><span data-level-done="{k}">0</span><small>/ {counts.get(k, 0)}</small></b></div>'
            for k in ("Easy", "Medium", "Hard")) + "</div>"
        levels += "<script>window.BB_LEVELS=" + json.dumps({it["id"]: it["level"][0] for t in sh["topics"] for sb in t["subs"] for it in sb["items"]},
                                                          separators=(",", ":")) + ";</script>"
    first = sh["topics"][0]
    actions = (f'<a class="btn btn-primary" href="{first["slug"]}/index.html" data-sheet-next="{sh["prefix"]}">{ICON["play"]}<span>Start</span></a>'
               f'<button class="btn btn-ghost on-dark" data-focus-domain="{sh["lobe"]}"><span class="rec"></span>Focus on this</button>'
               f'<a class="btn btn-ghost on-dark" href="{root}brain/index.html#{sh["lobe"]}">{ICON["brain"]}See it in your brain</a>'
               f'<div class="banner-progress">{progress(sh["prefix"], sh["total"])}</div>')
    body = f"""<main id="main" style="--c:{sh['color']}">
{sheet_banner(root, sh, sh['short'][:3].upper() if sh['lobe'] == 'dsa' else 'SD', [('Learn', 'index.html#programs'), (sh['name'], None)],
              f"Program · {len(sh['topics'])} topics", sh['name'], sh['lede'], actions)}
<section class="wrap section">
  {levels}
  <div class="topic-tools"><h2>Topics</h2><div><button class="link-btn danger" data-reset-prefix="{sh['prefix']}" data-reset-label="{sh['short']}">Reset progress</button></div></div>
  <div class="track-grid">{cards}</div>
</section>
</main>"""
    return page(title=f"{sh['name']} · {SITE}", desc=sh["lede"], root=root, body=body, kind="sd")


def render_sheet_topic(sh, ti):
    root = "../../"
    t = sh["topics"][ti]
    prev_t = sh["topics"][ti - 1] if ti > 0 else None
    next_t = sh["topics"][ti + 1] if ti + 1 < len(sh["topics"]) else None
    nav = '<div class="pager">'
    nav += (f'<a class="pager-card prev" href="../{prev_t["slug"]}/index.html" data-nav-prev><span>{ICON["left"]} Previous topic</span><strong>{html.escape(prev_t["name"])}</strong></a>' if prev_t else "<span></span>")
    nav += (f'<a class="pager-card next" href="../{next_t["slug"]}/index.html" data-nav-next><span>Next topic {ICON["right"]}</span><strong>{html.escape(next_t["name"])}</strong></a>' if next_t else "<span></span>")
    nav += "</div>"
    subs = []
    for sb in t["subs"]:
        head = (f'<header class="sub-head" id="{sb["anchor"]}"><h2>{html.escape(sb["name"])}</h2>{progress(sb["id"] + "/", len(sb["items"]))}</header>'
                if sb["name"] else "")
        subs.append(f'<section class="sheet-sub">{head}<ol class="item-list">{"".join(item_row(sh, it) for it in sb["items"])}</ol></section>')
    filters = ""
    if sh["lobe"] == "dsa":
        filters = ('<div class="seg" data-sheet-filter><button data-f="all" class="is-active">All</button><button data-f="Easy">Easy</button>'
                   '<button data-f="Medium">Medium</button><button data-f="Hard">Hard</button></div>')
    actions = (f'<a class="btn btn-primary" href="#{t["subs"][0]["items"][0]["anchor"]}" data-resume="{t["prefix"]}">{ICON["play"]}<span>Start topic</span></a>'
               f'<button class="btn btn-ghost on-dark" data-focus-domain="{sh["lobe"]}"><span class="rec"></span>Focus on this</button>'
               f'<a class="btn btn-ghost on-dark" href="{root}brain/index.html#{sh["prefix"]}{t["id"]}">{ICON["brain"]}In your brain</a>'
               f'<div class="banner-progress">{progress(t["prefix"], t["total"])}</div>')
    body = f"""<main id="main" style="--c:{sh['color']}">
{sheet_banner(root, sh, t['num'], [(sh['name'], sh['dir'] + '/index.html'), (f"Topic {t['num']}", None)],
              f"{sh['short']} · Topic {t['num']} of {len(sh['topics']):02d}" + (f" · {html.escape(t['note'])}" if t['note'] else ""),
              html.escape(t['name']), f"{t['total']} {sh['noun']}s" + (f" in {len(t['subs'])} sections" if len(t['subs']) > 1 else ""), actions)}
<section class="wrap section sheet">
  <div class="sheet-tools">{filters}<label class="switch sm"><input type="checkbox" data-hide-done><span class="switch-ui"></span><span><b>Hide {sh['done_label'].lower()}</b></span></label></div>
  {''.join(subs)}
  {nav}
</section>
</main>"""
    return page(title=f"{t['name']} · {sh['short']} · {SITE}", desc=f"{t['name']} — {sh['name']}", root=root, body=body, kind="sd")


def render_dsa_solution(sh, t, sb, it, prev, nxt):
    root = "../../../"
    sol, h = it["solution"], it["hint"]
    name = html.escape(it["name"])
    links = "".join(f'<a class="lk {LINK_TONE[label]}" href="{html.escape(url)}" target="_blank" rel="noopener">{label}</a>' for label, url in it["links"])
    approach = sol["approach"] or h.get("approach", "")
    cx = "".join(f'<span><em>{k}</em>{html.escape(h[v])}</span>' for k, v in (("Time", "time"), ("Space", "space")) if h.get(v))
    blocks = []
    if sol["statement"]:
        blocks.append(f'<section class="sol-sec"><h2>Problem</h2><p>{html.escape(sol["statement"])}</p></section>')
    if sol["examples"]:
        blocks.append(f'<section class="sol-sec"><h2>Examples</h2><pre class="sol-ex">{html.escape(sol["examples"])}</pre></section>')
    if h.get("pattern") or approach or h.get("brute") or cx:
        blocks.append('<section class="sol-sec"><h2>Approach</h2>'
                      + (f'<p><b>Pattern:</b> {html.escape(h["pattern"])}</p>' if h.get("pattern") else "")
                      + (f'<p><b>Brute force:</b> {html.escape(h["brute"])}</p>' if h.get("brute") else "")
                      + (f'<p><b>Optimal:</b> {html.escape(approach)}</p>' if approach else "")
                      + (f'<div class="pp-cx">{cx}</div>' if cx else "") + "</section>")
    lang = {"C++": "cpp", "Java": "java", "Python": "python"}.get(sol["lang"], "cpp")
    blocks.append(f'<section class="sol-sec"><h2>Solution <em>{html.escape(sol["lang"])}</em></h2>'
                  f'<div class="prose be-prose">{mdx.code_block(lang, sol["file"].split("/")[-1] if sol["file"] else "", sol["code"])}</div></section>')

    def pcard(x, cls, label):
        if not x:
            return "<span></span>"
        arrow = f'{ICON["left"]} {label}' if cls == "prev" else f'{label} {ICON["right"]}'
        return f'<a class="pager-card {cls}" href="../{x["anchor"]}/index.html" data-nav-{cls}><span>{arrow}</span><strong>{html.escape(x["name"])}</strong></a>'
    body = f"""<main id="main" style="--c:{sh['color']}">
<section class="wrap narrow section sol-page sheet">
  {crumbs(root, [('DSA Roadmap', 'dsa/index.html'), (html.escape(t['name']), f"dsa/{t['slug']}/index.html#{sb['anchor']}"), (name, None)])}
  <div class="sol-head prob" data-lesson="{it['id']}" data-level="{it['level']}">
    <p class="mono-label">{html.escape(t['name'])} · {html.escape(sb['name'])}</p>
    <h1 class="pt"><a href="#">{name}</a></h1>
    <div class="sol-meta"><span class="diff {DIFF_CLASS.get(it['level'], '')}">{it['level']}</span>
      <button class="it-check" type="button" data-toggle-done aria-label="Solved: {name}">{ICON['check']}</button><span class="mono-label">Solved</span>
      <button class="mk mk-b" type="button" data-mark="b" aria-label="Bookmark" title="Bookmark">{STAR}</button>
      <button class="mk mk-r" type="button" data-mark="r" aria-label="Add to revision" title="Add to revision">{REV}</button>
      <div class="links">{links}<button class="lk lk-note" type="button" data-note>Notes</button></div></div>
  </div>
  {''.join(blocks)}
  <p class="credit">Solution from <a href="https://github.com/Codensity30/Strivers-A2Z-DSA-Sheet" target="_blank" rel="noopener">Codensity30/Strivers-A2Z-DSA-Sheet</a>, mapped by <a href="{SOURCES['a2z']['repo']}" target="_blank" rel="noopener">AtoZ-DSA-Practice</a>.</p>
  <div class="pager">{pcard(prev, 'prev', 'Previous solution')}{pcard(nxt, 'next', 'Next solution')}</div>
</section>
</main>"""
    return page(title=f"{it['name']} · Solution · {SITE}", desc=f"{it['name']} — solution and approach", root=root, body=body, kind="dsa")


# ───────────────────────────── Backend from First Principles ─────────────────────────────

def load_backend():
    src = vendor("backend")
    folder = src / "src" / "content" / "chapters" if src else None
    if not folder or not folder.is_dir():
        return None
    chapters = []
    for f in sorted(folder.glob("*.mdx")):
        meta, body, sections = mdx.render(f)
        if meta.get("draft"):
            continue
        slug = re.sub(r"^\d+-", "", f.stem)
        # wrap each ## section so it can be ticked off on its own
        parts = re.split(r'(?=<h2 id=")', body)
        out, secs = [parts[0]], []
        for part in parts[1:]:
            sid = re.match(r'<h2 id="([^"]+)"', part).group(1)
            title = next((t for i, t in sections if i == sid), sid)
            lid = f"be/{slug}/{sid}"
            secs.append(dict(id=lid, anchor=sid, title=title))
            part = part.replace("</h2>", f'<button class="sec-check" type="button" data-toggle-done aria-label="Mark section done">{ICON["check"]}</button></h2>', 1)
            out.append(f'<section class="be-sec" data-lesson="{lid}">{part}'
                       f'<div class="sec-foot"><button class="chip-btn" type="button" data-toggle-done><span class="when-todo">{ICON["check"]}Mark “{html.escape(title)}” done</span>'
                       f'<span class="when-done">{ICON["check"]}Section done</span></button></div></section>')
        chapters.append(dict(order=meta.get("order", len(chapters) + 1), slug=slug, title=meta.get("title", slug), nav=meta.get("navTitle") or meta.get("title", slug),
                             summary=meta.get("summary", ""), reading=meta.get("readingTime", ""), keywords=meta.get("keywords", []),
                             html="".join(out), sections=secs))
    chapters.sort(key=lambda c: c["order"])
    for i, c in enumerate(chapters):
        c["num"] = f"{i + 1:02d}"
        c["prefix"] = f"be/{c['slug']}/"
    return dict(lobe="backend", prefix="be/", name="Backend from First Principles", color=LOBE_BY_ID["backend"]["color"], chapters=chapters,
                total=sum(len(c["sections"]) for c in chapters), href="backend/index.html")


def render_backend_index(be):
    root = "../"
    cards = "".join(f"""<a class="track-card be-card" href="{c['slug']}/index.html" style="--c:{be['color']}">
  <div class="tc-top"><span class="tc-num">{c['num']}</span><span class="mono-label">{html.escape(c['reading'])}</span><span class="tc-go">{ICON['right']}</span></div>
  <h4>{html.escape(c['title'])}</h4>
  <p class="be-sum">{html.escape(c['summary'])}</p>
  {progress(c['prefix'], max(1, len(c['sections'])))}
</a>""" for c in be["chapters"])
    first = be["chapters"][0]
    actions = (f'<a class="btn btn-primary" href="{first["slug"]}/index.html" data-be-next>{ICON["play"]}<span>Start with chapter 01</span></a>'
               f'<button class="btn btn-ghost on-dark" data-focus-domain="backend"><span class="rec"></span>Focus on this</button>'
               f'<a class="btn btn-ghost on-dark" href="{root}brain/index.html#backend">{ICON["brain"]}See it in your brain</a>'
               f'<div class="banner-progress">{progress(be["prefix"], be["total"])}</div>')
    lede = ("A first-principles series on backend engineering — what each piece does, why it exists and how it works underneath, "
            "with implementations in Go, Python, JavaScript, TypeScript and Java. Tick off each section as you finish it.")
    body = f"""<main id="main" style="--c:{be['color']}">
{banner(root, dict(color=be['color'], num='BE'), crumbs(root, [('Learn', 'index.html#programs'), ('Backend', None)]),
        f"Program · {len(be['chapters'])} chapters · {be['total']} sections", be['name'], lede, actions)}
<section class="wrap section">
  <div class="topic-tools"><h2>Chapters</h2><div><button class="link-btn danger" data-reset-prefix="be/" data-reset-label="Backend">Reset progress</button></div></div>
  <div class="track-grid">{cards}</div>
  <p class="credit">Content: <a href="{SOURCES['backend']['site']}" target="_blank" rel="noopener">Backend from First Principles</a> by
    <a href="https://github.com/DsThakurRawat" target="_blank" rel="noopener">{SOURCES['backend']['author']}</a>
    (<a href="{SOURCES['backend']['repo']}" target="_blank" rel="noopener">source</a>), fetched when this site is built.</p>
</section>
</main>"""
    return page(title=f"Backend · {SITE}", desc=lede, root=root, body=body, kind="be")


def render_backend_chapter(be, ci):
    root = "../../"
    c = be["chapters"][ci]
    prev_c = be["chapters"][ci - 1] if ci > 0 else None
    next_c = be["chapters"][ci + 1] if ci + 1 < len(be["chapters"]) else None
    side = "".join(f'<li{" class=is-current" if x is c else ""}><a href="../{x["slug"]}/index.html"><span>{x["num"]}</span>{html.escape(x["nav"])}</a></li>'
                   for x in be["chapters"])
    toc = ('<aside class="toc be-toc" aria-label="Sections"><p class="mono-label">Sections</p><nav>'
           + "".join(f'<a href="#{x["anchor"]}" data-toc-link="{x["anchor"]}" data-lesson="{x["id"]}"><i>{ICON["check"]}</i>{html.escape(x["title"])}</a>' for x in c["sections"])
           + "</nav></aside>")

    def pcard(x, cls):
        if not x:
            return "<span></span>"
        arrow = f'{ICON["left"]} Chapter {x["num"]}' if cls == "prev" else f'Chapter {x["num"]} {ICON["right"]}'
        return f'<a class="pager-card {cls}" href="../{x["slug"]}/index.html" data-nav-{cls}><span>{arrow}</span><strong>{html.escape(x["title"])}</strong></a>'
    body = f"""<div class="drawer-backdrop" data-drawer-close></div>
<div class="lesson-layout be-layout" style="--c:{be['color']}">
  <aside class="sidebar" id="sidebar" aria-label="Chapters">
    <div class="sidebar-inner">
      <a class="side-track" href="../index.html"><span class="num-tile sm">BE</span><span><em class="mono-label">Backend</em>From First Principles</span></a>
      <div class="side-topic"><p class="mono-label">Chapter {c['num']} / {len(be['chapters']):02d}</p>{progress(c['prefix'], max(1, len(c['sections'])))}</div>
      <ol class="be-chapters">{side}</ol>
    </div>
  </aside>
  <main id="main" class="lesson-main">
    {crumbs(root, [('Backend', 'backend/index.html'), (f"Chapter {c['num']}", None)])}
    <article class="lesson be-chapter" data-be-chapter="{c['prefix']}">
      <header class="lesson-head">
        <div class="lesson-meta"><span class="chip">Chapter {c['num']}</span><span>{ICON['clock']}{html.escape(c['reading'])}</span><span>{len(c['sections'])} sections</span></div>
        <h1>{html.escape(c['title'])}</h1>
        <p class="be-lede">{html.escape(c['summary'])}</p>
        <div class="lesson-actions">
          <button class="chip-btn" data-focus-domain="backend"><span class="rec"></span>Focus 25 min</button>
          <span class="domain-tag" style="--c:{be['color']}"><i></i>Backend Engineering</span>
        </div>
      </header>
      <div class="prose be-prose">{c['html']}</div>
      <div class="lesson-foot">
        <button class="btn btn-complete" data-be-complete><span class="when-todo">{ICON['check']}Mark whole chapter complete</span><span class="when-done">{ICON['check']}Chapter complete</span></button>
        <span class="lesson-count mono-label">{progress(c['prefix'], max(1, len(c['sections'])))}</span>
      </div>
      <p class="credit">From <a href="{SOURCES['backend']['site']}" target="_blank" rel="noopener">Backend from First Principles</a> by {SOURCES['backend']['author']} ·
        <a href="{SOURCES['backend']['repo']}" target="_blank" rel="noopener">source</a></p>
      <div class="pager">{pcard(prev_c, 'prev')}{pcard(next_c, 'next')}</div>
    </article>
  </main>
  {toc}
</div>"""
    return page(title=f"{c['title']} · Backend · {SITE}", desc=c["summary"], root=root, body=body, kind="be-chapter")


def render_login():
    root = "../"
    body = f"""<main id="main" class="login-page">
  <div class="login-card panel" data-login>
    <a class="brand" href="{root}index.html">{logo("lg")}</a>
    <p class="login-sub">Sign in to save your progress, tasks, habits and your growing brain — on every device.</p>
    <div class="seg" data-login-tabs><button data-mode="login" class="is-active" type="button">Sign in</button><button data-mode="register" type="button">Create account</button></div>
    <form data-login-form autocomplete="on" novalidate>
      <label class="field"><span class="mono-label">Username</span><input name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required minlength="3" maxlength="32"></label>
      <label class="field"><span class="mono-label">Password</span><input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="256"></label>
      <label class="field" data-register-only hidden><span class="mono-label">Confirm password</span><input name="confirm" type="password" autocomplete="new-password" maxlength="256"></label>
      <p class="login-error" data-login-error role="alert" hidden></p>
      <button class="btn btn-primary" type="submit" data-login-submit>Sign in</button>
    </form>
    <p class="login-note" data-login-note>Progress already in this browser is added to your account the first time you sign in.</p>
  </div>
</main>"""
    return page(title=f"Sign in · {SITE}", desc="Sign in to BLACKBOX", root=root, body=body, kind="login")


def brain_tree(tracks, sheets, be=None):
    """Nested regions for the Brain page. Inner nodes: {id, n (name), c (colour), h (href), k (children), soon};
    leaves: [progress id, name, href, tag]. Every node's progress is the share of its leaves that are done."""
    lobes = []
    for lobe in LOBES:
        node = dict(id=lobe["id"], n=lobe["name"], c=lobe["color"], h=lobe.get("href", ""), b=lobe["blurb"], k=[])
        if lobe["id"] == "devops":
            for t in tracks:
                node["k"].append(dict(id=t["slug"], n=f"{t['num']} · {strip_tags(t['title'])}", c=t["color"], h=f"{t['slug']}/index.html", k=[
                    dict(id=f"{t['slug']}/{tp['slug']}", n=strip_tags(tp["title"]), h=f"{t['slug']}/{tp['slug']}/index.html",
                         k=[[lesson_id(t, tp, l), strip_tags(l["title"]), f"{lesson_id(t, tp, l)}/index.html", f"{l['minutes']}m"] for l in tp["lessons"]])
                    for tp in t["topics"]]))
        elif lobe["id"] == "backend" and be:
            for c in be["chapters"]:
                node["k"].append(dict(id=c["prefix"].rstrip("/"), n=f"{c['num']} · {c['title']}", h=f"backend/{c['slug']}/index.html",
                                      k=[[x["id"], x["title"], f"backend/{c['slug']}/index.html#{x['anchor']}", ""] for x in c["sections"]]))
        elif lobe["id"] in sheets:
            sh = sheets[lobe["id"]]
            for t in sh["topics"]:
                base = f"{sh['dir']}/{t['slug']}/index.html"
                leaves = lambda sb: [[it["id"], it["name"], f"{base}#{it['anchor']}", it.get("level", "")] for it in sb["items"]]
                kids = ([dict(id=sb["id"], n=sb["name"], h=f"{base}#{sb['anchor']}", k=leaves(sb)) for sb in t["subs"]]
                        if len(t["subs"]) > 1 else leaves(t["subs"][0]))
                node["k"].append(dict(id=t["prefix"].rstrip("/"), n=f"{t['num']} · {t['name']}", h=base, k=kids))
        if not node["k"]:
            node["soon"] = True
        lobes.append(node)
    return dict(id="", n="Your brain", k=lobes)


# ───────────────────────────── build ─────────────────────────────

def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def main():
    tracks = load()
    sheets = load_sheets()
    be = load_backend()
    if not tracks and not sheets and not be:
        sys.exit(f"nothing to build: no lessons in {SRC} and no data/ sheets")
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
    index.append(["Sign in", "login/index.html", "", "", "p", "login account register password"])
    home_programs = dict(sheets)
    if be:
        home_programs["backend"] = dict(href=be["href"], prefix=be["prefix"], total=be["total"],
                                        meta=f"{len(be['chapters'])} chapters · {be['total']} sections")
        write(OUT / "backend" / "index.html", render_backend_index(be))
        index.append(["Backend from First Principles", "backend/index.html", "", "", "k", "backend server api chapters"])
        for ci, c in enumerate(be["chapters"]):
            href = f"backend/{c['slug']}/index.html"
            write(OUT / "backend" / c["slug"] / "index.html", render_backend_chapter(be, ci))
            index.append([c["title"], href, "Backend", "", "t", " ".join(map(str, c["keywords"]))])
            for x in c["sections"]:
                index.append([x["title"], f"{href}#{x['anchor']}", "Backend", c["title"], "l", ""])
    write(OUT / "index.html", render_home(tracks, home_programs))
    write(OUT / "login" / "index.html", render_login())
    for sh in sheets.values():
        index.append([sh["name"], sh["href"], "", "", "k", "sheet practice " + sh["noun"]])
        dsa = sh["lobe"] == "dsa"
        write(OUT / sh["dir"] / "index.html", render_dsa_index(sh) if dsa else render_sheet_index(sh))
        for ti, t in enumerate(sh["topics"]):
            href = f"{sh['dir']}/{t['slug']}/index.html"
            index.append([t["name"], href, sh["name"], "", "t", t["note"]])
            write(OUT / sh["dir"] / t["slug"] / "index.html", render_dsa_topic(sh, ti) if dsa else render_sheet_topic(sh, ti))
            if dsa:
                solved = [(sb, it) for sb in t["subs"] for it in sb["items"] if it.get("solution")]
                for k, (sb, it) in enumerate(solved):
                    write(OUT / "dsa" / "solution" / it["anchor"] / "index.html",
                          render_dsa_solution(sh, t, sb, it, solved[k - 1][1] if k else None, solved[k + 1][1] if k + 1 < len(solved) else None))
            for sb in t["subs"]:
                for it in sb["items"]:
                    index.append([it["name"], f"{href}#{it['anchor']}", sh["short"] + " · " + t["name"], sb["name"] or t["name"], "l",
                                  " ".join(x for x in (it.get("level"), it.get("meta"), it.get("desc")) if x)])
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

    tree = brain_tree(tracks, sheets, be)
    if "dsa" in sheets:
        write(OUT / "assets" / "dsa-rows.js", "window.BB_DSA_ROWS=" + json.dumps(
            {it["id"]: [f"{t['slug']}/index.html", t["name"], dsa_row(it, 0, "solution/")] for t in sheets["dsa"]["topics"] for sb in t["subs"] for it in sb["items"]},
            ensure_ascii=False, separators=(",", ":")) + ";")

    def count(node):
        return sum(count(k) if isinstance(k, dict) else 1 for k in node.get("k", []))
    lobe_totals = {n["id"]: count(n) for n in tree["k"]}
    tracks_map = {t["slug"]: dict(t=strip_tags(t["title"]), d="devops", n=t["n_lessons"], num=t["num"]) for t in tracks}
    for sh in sheets.values():
        tracks_map[sh["prefix"].rstrip("/")] = dict(t=sh["name"], d=sh["lobe"], n=sh["total"], num="")
    if be:
        tracks_map["be"] = dict(t=be["name"], d="backend", n=be["total"], num="")
    data = {
        "domains": [dict(id=d["id"], name=d["name"], short=d["short"], color=d["color"], anchor=d["anchor"], href=d.get("href", ""),
                         blurb=d["blurb"], soon=not lobe_totals.get(d["id"]), total=lobe_totals.get(d["id"], 0)) for d in LOBES],
        "aliases": DOMAIN_ALIASES,
        "tracks": tracks_map,
        "total": sum(lobe_totals.values()),
        "pathTotal": sum(t["n_lessons"] for t in tracks),
    }
    write(OUT / "assets" / "brain-tree.js", "window.BB_TREE=" + json.dumps(tree, ensure_ascii=False, separators=(",", ":")) + ";")
    write(OUT / "assets" / "data.js", "window.BB_DATA=" + json.dumps(data, separators=(",", ":")) + ";")
    write(OUT / "assets" / "search-index.js",
          "window.SEARCH_INDEX=" + json.dumps(index, ensure_ascii=False, separators=(",", ":")) + ";")

    print(f"built {len(tracks)} tracks, {sum(t['n_lessons'] for t in tracks)} lessons, "
          + ", ".join(f"{sh['total']} {sh['short']} {sh['noun']}s" for sh in sheets.values())
          + (f", {sum(1 for t in sheets['dsa']['topics'] for sb in t['subs'] for it in sb['items'] if it.get('solution'))} DSA solutions" if "dsa" in sheets else "")
          + (f", {len(be['chapters'])} backend chapters" if be else "") + f" → {OUT}")


if __name__ == "__main__":
    main()
