# BLACKBOX

*Where engineers figure things out.*

A learning site with four live programs — **DevOps & SRE** (built from your saved lesson pages in
`learn/`), **DSA** (Striver's A2Z sheet: 474 problems, 297 with solutions), **System Design** and
**Backend Engineering** (the full *Backend from First Principles* course) — plus a focus timer,
tasks, habits, accounts, and a 3D brain that grows as you learn.

## Open-source content it pulls in

The first build clones these into `vendor/` (git-ignored) and builds pages from them:

| Source | Used for |
| --- | --- |
| [DsThakurRawat/Backend-from-first-Principle](https://github.com/DsThakurRawat/Backend-from-first-Principle) ([site](https://backend-from-first-principle.vercel.app)) | All 26 Backend chapters: text, diagrams, callouts, multi-language code tabs |
| [ashutosh-mishr/AtoZ-DSA-Practice](https://github.com/ashutosh-mishr/AtoZ-DSA-Practice) ([site](https://dsapractice.indevs.in/roadmap)) | DSA solutions (problem statement, examples, C++ code) — originally from [Codensity30/Strivers-A2Z-DSA-Sheet](https://github.com/Codensity30/Strivers-A2Z-DSA-Sheet) |

Needs `git` and internet on the first build. To pick up their latest changes, delete the folder
under `vendor/` and rebuild. `BLACKBOX_OFFLINE=1 python3 build.py` builds without fetching (those
pages are then skipped). These repos don't state a licence — credit and links stay on every page;
ask the authors before hosting it publicly.

## Study (one command)

Requires Docker (Docker Desktop on Mac/Windows; Docker Engine + the compose plugin on Linux).

```bash
git clone git@github.com:gruprttt/Blackbox.git
cd Blackbox
docker compose up -d
```

Open http://localhost:8080. Stop with `docker compose down`.

The DevOps & SRE lessons live in `learn/` (one folder per track, each with an `index.html`), so a
fresh clone builds the full site. Add or update lessons by saving pages into `learn/<track-slug>/`
and committing them. Every `up` rebuilds the site, so new or edited lessons show up.
Use a different port with `BLACKBOX_PORT=9000 docker compose up -d`.

Create an account from **Sign in** (top right). Each account's progress, tasks, habits and focus
history are saved by the `api` service into the `blackbox-data` Docker volume, so they survive
rebuilds, restarts and clearing your browser, and follow you to any device you sign in on.
`docker compose down` keeps the volume; only `docker compose down -v` deletes it.

- Signed out, everything still works but is saved in that browser only. The first time you sign in,
  that browser's progress is merged into your account.
- The first account created on a server adopts any progress saved before accounts existed.
- Sign in with a username or email and password, or with **Google** (see below). Accounts, sessions
  and progress live in SQLite (`.data/blackbox.db`); old `users.json` data is migrated automatically.
- **Forgot password?** If your account has an email and SMTP is configured, you get a reset link
  (valid 30 minutes, single use). Without email, use one of the 8 **recovery codes** shown when you
  registered (Settings → Account can make new ones). An admin can also make a link:
  `python3 server/server.py --data .data reset-link USERNAME`. A reset signs out every device.
- Settings → Account: add/change email, change password, link Google, new recovery codes, delete account.
- To stop strangers registering once you've made your account, set `BLACKBOX_SIGNUP=0`.

### Configuration (`.env`)

Copy `.env.example` to `.env` (used by `run.py` and `docker compose`):

- `BLACKBOX_BASE_URL` — the public URL of the site (e.g. `https://learn.example.com`).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — turns on **Continue with Google**:
  1. Open https://console.cloud.google.com/apis/credentials (set up the OAuth consent screen first
     if asked: External, app name BLACKBOX, your email).
  2. *Create credentials → OAuth client ID → Web application*.
  3. Add the Authorized redirect URI `<BLACKBOX_BASE_URL>/api/auth/google/callback`
     (locally: `http://localhost:8765/api/auth/google/callback`).
  4. Paste the Client ID and secret into `.env` and restart. `run.py` creates `.env` for you and
     prints these steps while Google is still off.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_TLS` — for reset emails.
- `BLACKBOX_SECURE_COOKIES=1` when served over HTTPS (also enable the HSTS line in `deploy/nginx.conf`).

### Security & scaling

- Passwords: salted PBKDF2-SHA256. Session, reset and recovery tokens are stored only as hashes;
  sessions are `HttpOnly; SameSite=Lax` cookies (`Secure` over HTTPS) and expire after 30 days.
- Google sign-in uses the authorization-code flow with PKCE, `state` and `nonce`.
- Writes require a same-origin `Origin` header and a JSON body (CSRF); login, reset and recovery are
  rate-limited in the API and by nginx (`limit_req`); responses never reveal whether an account exists.
- Strict Content-Security-Policy (no inline scripts), `X-Frame-Options`, `nosniff`, `Referrer-Policy`.
- SQLite in WAL mode (many concurrent readers, one serialized writer) behind a threaded server and
  nginx, which serves all static files. Fine for thousands of users on one box; for more, run the
  API behind a shared database.

## DSA roadmap

`dsa/index.html` is laid out like the [DSA Practice](https://dsapractice.indevs.in/roadmap) roadmap:
a topic table with solved counts and progress, then each topic's subtopics as collapsible
sections. Every problem row has **Solved**, **Bookmark**, **Revision**, a **Pattern** hint (pattern,
time/space, approach where known), **LeetCode / GFG / TUF / YouTube** links and personal **Notes**.
Filter by status or difficulty; the Revision and Bookmarks tabs collect what you've marked.
Problems with a solution get a **Solution** page (`dsa/solution/p062/`) with the problem statement,
examples, approach and the C++ solution. All of it saves to your account.

## Backend

`backend/index.html` lists the 26 chapters. Each chapter page has the chapter list on the left, the
section list on the right, and the full text with diagrams, callouts, step diagrams and code in
Go / Python / JavaScript / TypeScript / Java tabs (your language choice is remembered). Tick each
section as you finish it — every section is a neuron in the Backend lobe.

## Tracks

The navbar has one **Tracks** item; hover it for every program (DevOps & SRE, DSA, System Design,
Backend) with your progress. The Tracks page is the hub: the program chips switch the content in
place — the DevOps skill map, the DSA roadmap (click a topic to see its problems right there), System
Design topics and Backend chapters (expand to tick off concepts/sections). Every program has a **Map / List**
switch: the map is a pannable skill map; click a card to see all of its sections (and every
problem, concept or lesson in them) in the side panel. You
only leave the page when you open a lesson, problem or chapter to learn it.

## Reading a chapter

Backend chapters and DevOps lessons open with a warp jump into deep space: a live-rendered black
hole (WebGL ray tracing — light bends around it, the golden accretion disk glows brighter on the side
spinning towards you, and stars are lensed near its shadow). You drift closer as you read, and the
disk flares when you finish. The text sits on dark glass so it stays readable. The renderer runs at a
fraction of screen resolution, caps at 30 fps, lowers its quality on slow machines, pauses in
background tabs, shows a still frame if your system asks for reduced motion, and falls back to a
drawn image without WebGL. When a
chapter or lesson is complete, a **Next chapter / Next lesson** button appears at the bottom and a
bar slides up offering the next one.

## The brain

Every program is a lobe. Lessons, solved problems and learned concepts light neurons in their lobe;
focus minutes wire the rest, and the brain physically grows as more of it is wired.

- **Click a lobe** to see what's inside it: its topics or chapters with your progress in each.
- *Open in Tracks* (or `Enter`) goes to that program on the Tracks page; `brain/#dsa` selects a lobe.
- The timeline under the brain charts your growth — drag it to see any past day, or press ▶ to replay it.

## Home

**Daily goal** (home page): your day counts when you finish *N items* (lessons, DSA problems, Backend
sections, System Design concepts) **or** focus *M minutes* — 3 items or 25 minutes by default, and you
can change it with *Change goal* (saved to your account). The card shows today's two rings, your
streak, how many of the last 30 days you hit the goal, your 7-day averages, and how many days you can
still skip without breaking your rhythm.

The same numbers are shown SRE-style, with a plain-language explainer on the card (*New to SLI / SLO?*):
**SLI** = the share of days you actually hit your goal, **SLO** = the share you aim for (80% by default,
editable), **error budget** = how many days you can miss before falling below your SLO.
Session-length percentiles (p50 / p95 / p99) are under *More stats*.

*Your path* on the home page lets you pick the program you're working on (DevOps & SRE by default,
or DSA, System Design, Backend). The path, the hero's Continue button and your progress follow the
program you pick, and the choice is saved to your account.

## Quickest way to see it (no Docker)

```bash
python3 run.py      # builds, starts the server and opens http://localhost:8765
python3 run.py --learn /path/to/learn   # only if it can't find your DevOps lessons by itself
```

## Develop without Docker

```bash
python3 build.py                                              # writes ./dist
python3 server/server.py --static dist --data .data --port 8765   # site + sync API
```

## Layout

| Path | What it is ? |
| --- | --- |
| `build.py` | Parses `learn/` and generates every page; `LOBES` are the brain's top-level regions |
| `data/dsa-a2z.json` | Striver's A2Z sheet (18 topics, 62 subtopics, 474 problems with links) |
| `data/system-design.json` | System Design curriculum (topics → concepts) |
| `mdx.py` | Dependency-free MDX → HTML converter for the Backend chapters |
| `assets/style.css` | Design system (dark theme) |
| `assets/app.js` | Core: progress, focus engine, tasks store, search |
| `assets/brain.js` | Canvas 3D brain renderer (levels, dive transitions, growth, zoom-in) |
| `assets/ambient.js` | Reading-page background: star field and neurons that light up as you read |
| `assets/views.js` | Home, Brain explorer, Focus, Tasks and Habits pages |
| `assets/mindmap.js` | Tracks page skill maps for every program (pan, zoom, expand topics) |
| `server/server.py` | Accounts, password reset, Google sign-in and progress sync API (Python stdlib, SQLite) |
| `Dockerfile`, `deploy/nginx.conf`, `deploy/api-proxy.inc`, `docker-compose.yml`, `.env.example` | `web` (nginx) + `api` services and the data volume |

`python3 build.py` also works without `learn/`: it then builds only DSA and System Design.

## Adding a new subject

- **More DevOps lessons:** save the pages into `learn/<track-slug>/` (same structure as the others)
  and add the slug to an area's `tracks` in `DOMAINS` in `build.py` (that sets its colour).
- **A new program / lobe:** add an entry to `LOBES` (with an `anchor` on the brain) and `PROGRAMS`
  in `build.py`. Lobes with no content yet show up dormant ("coming soon").
- **More System Design:** add topics or concepts to `data/system-design.json`. Keep existing ids
  stable — progress is stored by id (`sd/<topic>/<concept>`, `dsa/<topic>/<subtopic>/<problem>`).

Then `docker compose up -d` (or `python3 build.py`).

Tracks are numbered in the order of their original chapter numbers.

The browser works offline from `localStorage` and, when you're signed in, syncs every change to your
account; newer writes win, so several browsers stay in step. Settings → Export/Import backup gives
you a JSON copy.

DSA problem list: [Striver's A2Z DSA sheet](https://takeuforward.org/strivers-a2z-dsa-course/strivers-a2z-dsa-course-sheet-2),
via the dataset in [ashutosh-mishr/AtoZ-DSA-Practice](https://github.com/ashutosh-mishr/AtoZ-DSA-Practice/tree/main/database).
