# BLACKBOX

*Where engineers figure things out.*

A learning site with four live programs — **DevOps & SRE** (built from the saved lesson pages in
`../learn`), **DSA** (Striver's A2Z sheet: 474 problems, 297 with solutions), **System Design** and
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

Requires Docker Desktop to be running.

```bash
cd learn-ui
docker compose up -d
```

Open http://localhost:8080. Stop with `docker compose down`.

Every `up` rebuilds the site, so new or edited lessons in `../learn` show up automatically.
Use a different port with `BLACKBOX_PORT=9000 docker compose up -d`.

Create an account from **Sign in** (top right). Each account's progress, tasks, habits and focus
history are saved by the `api` service into the `blackbox-data` Docker volume, so they survive
rebuilds, restarts and clearing your browser, and follow you to any device you sign in on.
`docker compose down` keeps the volume; only `docker compose down -v` deletes it.

- Signed out, everything still works but is saved in that browser only. The first time you sign in,
  that browser's progress is merged into your account.
- The first account created on a server adopts any progress saved before accounts existed.
- Passwords are stored as salted PBKDF2 hashes; sessions are HttpOnly cookies. Repeated wrong
  passwords are throttled. Change your password from Settings (it signs out your other devices).
- To stop strangers registering once you've made your account, set `BLACKBOX_SIGNUP=0` on the `api`
  service. If you serve it over HTTPS, nginx forwards the scheme and the cookie is marked `Secure`.

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

## The brain

Every program is a lobe. Lessons, solved problems and learned concepts light neurons in their lobe;
focus minutes wire the rest. The brain physically grows as more of it is wired.

On the Brain page, **click a lobe to go inside it** — its tracks/topics become the regions, click
again for subtopics, and at the bottom each patch of neurons is a single lesson or problem you can
tick off. Breadcrumbs, **Back out** or `Esc` go back up; the URL (`brain/index.html#dsa/t03`) links
straight to any level. The timeline under the brain charts your growth — drag it to see your brain
on any past day, or press ▶ to replay how it grew.

## Quickest way to see it (no Docker)

```bash
python3 run.py      # builds, starts the server and opens http://localhost:8765
```

## Develop without Docker

```bash
python3 build.py                                              # writes ./dist
python3 server/server.py --static dist --data .data --port 8765   # site + sync API
```

## Layout

| Path | What it is ? |
| --- | --- |
| `build.py` | Parses `../learn` and generates every page; `LOBES` are the brain's top-level regions |
| `data/dsa-a2z.json` | Striver's A2Z sheet (18 topics, 62 subtopics, 474 problems with links) |
| `data/system-design.json` | System Design curriculum (topics → concepts) |
| `mdx.py` | Dependency-free MDX → HTML converter for the Backend chapters |
| `assets/style.css` | Design system (dark + light themes) |
| `assets/app.js` | Core: progress, focus engine, tasks store, search, theme |
| `assets/brain.js` | Canvas 3D brain renderer (levels, dive transitions, growth) |
| `assets/views.js` | Home, Brain explorer, Focus, Tasks and Habits pages |
| `assets/mindmap.js` | Tracks page skill map (pan, zoom, expand topics) |
| `server/server.py` | Accounts + per-user progress sync API (Python stdlib, JSON file storage) |
| `Dockerfile`, `deploy/nginx.conf`, `docker-compose.yml` | `web` (nginx) + `api` services and the data volume |

`python3 build.py` also works without `../learn`: it then builds only DSA and System Design.

## Adding a new subject

- **More DevOps lessons:** save the pages into `../learn/<track-slug>/` (same structure as the others)
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
