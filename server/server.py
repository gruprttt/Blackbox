#!/usr/bin/env python3
"""BLACKBOX state API — persists your progress, tasks, habits and focus history.

The browser keeps working offline from localStorage and syncs every `bb-*` key here.
Each key carries a timestamp; on merge the newer write wins (deletes are tombstones),
so several browsers or devices converge on the same state.

    GET  /api/state   -> {"keys": {key: {"v": str | null, "t": ms}}, "rev": int}
    PUT  /api/state   body {"keys": {...}}  -> merged state (POST works too)
    GET  /api/health  -> "ok"

Usage:
    python3 server.py --data /data --port 8000                  # API only (Docker)
    python3 server.py --data ./.data --port 8765 --static dist  # API + site (local dev)
"""
import argparse
import json
import os
import re
import tempfile
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY = 10 * 1024 * 1024
MAX_VALUE = 4 * 1024 * 1024
KEY_RE = re.compile(r"^bb-[a-z0-9-]{1,60}$")


class Store:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.state = {"keys": {}, "rev": 0}
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data.get("keys"), dict):
                self.state = {"keys": data["keys"], "rev": int(data.get("rev", 0))}
        except FileNotFoundError:
            pass
        except (OSError, ValueError) as e:
            # Keep the unreadable file for inspection rather than silently overwriting it.
            os.replace(path, f"{path}.corrupt-{int(time.time())}")
            print(f"state file unreadable ({e}); moved aside, starting fresh", flush=True)

    def snapshot(self):
        with self.lock:
            return json.dumps(self.state)

    def merge(self, incoming):
        now = int(time.time() * 1000)
        changed = False
        with self.lock:
            keys = self.state["keys"]
            for k, item in incoming.items():
                if not KEY_RE.match(k) or not isinstance(item, dict):
                    continue
                v, t = item.get("v"), item.get("t")
                if not isinstance(t, (int, float)) or (v is not None and not isinstance(v, str)):
                    continue
                if isinstance(v, str) and len(v) > MAX_VALUE:
                    continue
                t = min(int(t), now + 60_000)  # don't let a skewed clock pin a key forever
                cur = keys.get(k)
                if cur is None or t > cur.get("t", 0):
                    keys[k] = {"v": v, "t": t}
                    changed = True
            if changed:
                self.state["rev"] += 1
                self._write()
            return json.dumps(self.state)

    def _write(self):
        d = os.path.dirname(self.path) or "."
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".state-", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(self.state, f, separators=(",", ":"))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self.path)


class Handler(SimpleHTTPRequestHandler):
    store = None
    static = None
    server_version = "blackbox"
    sys_version = ""

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def _json(self, code, body):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            return self._json(200, '"ok"')
        if path == "/api/state":
            return self._json(200, self.store.snapshot())
        if path.startswith("/api/"):
            return self._json(404, '{"error":"not found"}')
        if not self.static:
            return self._json(404, '{"error":"static files are served by nginx"}')
        return super().do_GET()

    def do_HEAD(self):
        if self.static and not self.path.startswith("/api/"):
            return super().do_HEAD()
        self.send_response(405)
        self.end_headers()

    def do_PUT(self):
        if self.path.split("?", 1)[0] != "/api/state":
            return self._json(404, '{"error":"not found"}')
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            return self._json(413, '{"error":"payload too large"}')
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            keys = body.get("keys")
            if not isinstance(keys, dict):
                raise ValueError("keys must be an object")
        except (ValueError, AttributeError) as e:
            return self._json(400, json.dumps({"error": str(e)}))
        return self._json(200, self.store.merge(keys))

    do_POST = do_PUT

    def send_error(self, code, message=None, explain=None):
        # Serve the site's own 404 page for missing static files.
        if code == 404 and self.static and os.path.exists(os.path.join(self.static, "404.html")):
            with open(os.path.join(self.static, "404.html"), "rb") as f:
                data = f.read()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().send_error(code, message, explain)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--data", default="/data", help="directory for state.json")
    ap.add_argument("--static", help="also serve this built site directory (local dev)")
    args = ap.parse_args()

    Handler.store = Store(os.path.join(args.data, "state.json"))
    Handler.static = os.path.abspath(args.static) if args.static else None
    handler = partial(Handler, directory=Handler.static) if Handler.static else Handler
    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"blackbox api on :{args.port} · data={args.data}" + (f" · static={args.static}" if args.static else ""), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
