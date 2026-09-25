# BLACKBOX

*Where engineers figure things out.*

A static learning site built from the saved lesson pages in `../learn`, with a learning path,
focus timer, tasks, habits and a 3D brain that grows as you learn.

## Study (one command)

Requires Docker Desktop to be running.

```bash
cd learn-ui
docker compose up -d
```

Open http://localhost:8080. Stop with `docker compose down`.

Every `up` rebuilds the site, so new or edited lessons in `../learn` show up automatically.
Use a different port with `BLACKBOX_PORT=9000 docker compose up -d`.

Your progress, tasks, habits and focus history are saved by the `api` service into the
`blackbox-data` Docker volume, so they survive rebuilds, restarts and clearing your browser.
`docker compose down` keeps the volume; only `docker compose down -v` deletes it.

## Develop without Docker

```bash
python3 build.py                                              # writes ./dist
python3 server/server.py --static dist --data .data --port 8765   # site + sync API
```

## Layout

| Path | What it is |
| --- | --- |
| `build.py` | Parses `../learn` and generates every page; `DOMAINS` maps tracks to brain regions |
| `assets/style.css` | Design system (dark + light themes) |
| `assets/app.js` | Core: progress, focus engine, tasks store, search, theme |
| `assets/brain.js` | Canvas 3D brain renderer |
| `assets/views.js` | Home, Brain, Focus, Tasks and Habits pages |
| `assets/mindmap.js` | Tracks page skill map (pan, zoom, expand topics) |
| `server/server.py` | Progress sync API (Python stdlib, JSON file storage) |
| `Dockerfile`, `deploy/nginx.conf`, `docker-compose.yml` | `web` (nginx) + `api` services and the data volume |

## Adding a new subject

1. Save its pages into `../learn/<track-slug>/` (same structure as the others).
2. Add the slug to a domain's `tracks` in `DOMAINS` in `build.py`, or add a new domain with its
   own `anchor` on the brain. Remove `soon=True` from DSA / System Design once they have tracks.
3. `docker compose up -d` (or `python3 build.py`).

Tracks are numbered in the order of their original chapter numbers.

The browser works offline from `localStorage` and syncs every change to the API; newer writes
win, so several browsers stay in step. Settings → Export/Import backup gives you a JSON copy.
