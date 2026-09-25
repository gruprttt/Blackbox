#!/usr/bin/env python3
"""BLACKBOX state API — accounts plus per-user progress, tasks, habits and focus history.

The browser keeps working offline from localStorage and syncs every `bb-*` key here once
you're signed in. Each key carries a timestamp; on merge the newer write wins (deletes are
tombstones), so several browsers or devices converge on the same state.

    POST /api/auth/register  {"username", "password"}  -> {"user"}   (sets the session cookie)
    POST /api/auth/login     {"username", "password"}  -> {"user"}   (sets the session cookie)
    POST /api/auth/logout                              -> {"ok"}
    POST /api/auth/password  {"current", "password"}   -> {"ok"}     (signs out other devices)
    GET  /api/auth/me                                  -> {"user": str | null, "signup": bool}
    GET  /api/state   -> {"keys": {key: {"v": str | null, "t": ms}}, "rev": int, "user": str}
    PUT  /api/state   body {"keys": {...}}  -> merged state (POST works too)
    GET  /api/health  -> "ok"

/api/state answers 401 without a valid session. Passwords are stored as salted
PBKDF2-SHA256 hashes; sessions are random tokens kept (hashed) in sessions.json.

Data layout (under --data):
    users.json                   accounts
    sessions.json                active sessions
    users/<username>/state.json  that user's synced keys
    state.json                   pre-accounts data; the first account created adopts it

Usage:
    python3 server.py --data /data --port 8000                  # API only (Docker)
    python3 server.py --data ./.data --port 8765 --static dist  # API + site (local dev)
"""
import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY = 10 * 1024 * 1024
MAX_VALUE = 4 * 1024 * 1024
KEY_RE = re.compile(r"^bb-[a-z0-9-]{1,60}$")
USER_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{2,31}$")
PBKDF2_ITERS = 240_000
SESSION_DAYS = 30
COOKIE = "bb_session"
MAX_FAILS, FAIL_WINDOW = 8, 15 * 60  # per username+IP: this many bad passwords locks for the window


def write_json(path, data):
    """Atomic write: temp file + fsync + rename, so a crash never leaves half a file."""
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except (OSError, ValueError) as e:
        # Keep the unreadable file for inspection rather than silently overwriting it.
        os.replace(path, f"{path}.corrupt-{int(time.time())}")
        print(f"{path} unreadable ({e}); moved aside, starting fresh", flush=True)
        return default


class Store:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        data = read_json(path, {})
        self.state = {"keys": data["keys"], "rev": int(data.get("rev", 0))} if isinstance(data.get("keys"), dict) else {"keys": {}, "rev": 0}

    def snapshot(self, extra=None):
        with self.lock:
            return json.dumps(dict(self.state, **(extra or {})))

    def merge(self, incoming, extra=None):
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
                write_json(self.path, self.state)
            return json.dumps(dict(self.state, **(extra or {})))


def hash_password(password, salt=None, iters=PBKDF2_ITERS):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), iters).hex()
    return {"salt": salt, "hash": digest, "iters": iters}


def token_id(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class Accounts:
    def __init__(self, data_dir, allow_signup=True):
        self.dir = data_dir
        self.allow_signup = allow_signup
        self.lock = threading.Lock()
        self.users_path = os.path.join(data_dir, "users.json")
        self.sessions_path = os.path.join(data_dir, "sessions.json")
        self.users = read_json(self.users_path, {})
        self.sessions = read_json(self.sessions_path, {})
        self.stores = {}
        self.fails = {}
        self._prune()

    def _prune(self):
        now = time.time()
        dead = [k for k, s in self.sessions.items() if s.get("exp", 0) < now or s.get("user") not in self.users]
        for k in dead:
            del self.sessions[k]
        if dead:
            write_json(self.sessions_path, self.sessions)

    def store(self, user):
        with self.lock:
            if user not in self.stores:
                self.stores[user] = Store(os.path.join(self.dir, "users", user, "state.json"))
            return self.stores[user]

    # ── throttling ──
    def locked(self, key):
        now = time.time()
        hits = [t for t in self.fails.get(key, []) if now - t < FAIL_WINDOW]
        self.fails[key] = hits
        return len(hits) >= MAX_FAILS

    def fail(self, key):
        self.fails.setdefault(key, []).append(time.time())

    # ── accounts ──
    def register(self, username, password):
        with self.lock:
            if not self.allow_signup and self.users:
                return None, "Sign-ups are closed on this server"
            if username in self.users:
                return None, "That username is taken"
            first = not self.users
            self.users[username] = dict(hash_password(password), created=int(time.time()))
            write_json(self.users_path, self.users)
        legacy = os.path.join(self.dir, "state.json")
        if first and os.path.exists(legacy):
            # Progress saved before accounts existed belongs to whoever sets the server up.
            dest = os.path.join(self.dir, "users", username, "state.json")
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            os.replace(legacy, dest)
            print(f"adopted pre-account state.json for {username}", flush=True)
        return self.new_session(username), None

    def verify(self, username, password):
        rec = self.users.get(username)
        if not rec:
            hash_password(password)  # same cost whether or not the user exists
            return False
        got = hash_password(password, rec["salt"], rec.get("iters", PBKDF2_ITERS))["hash"]
        return hmac.compare_digest(got, rec["hash"])

    def set_password(self, username, password, keep_token=None):
        with self.lock:
            self.users[username].update(hash_password(password))
            write_json(self.users_path, self.users)
            keep = token_id(keep_token) if keep_token else None
            for k in [k for k, s in self.sessions.items() if s["user"] == username and k != keep]:
                del self.sessions[k]
            write_json(self.sessions_path, self.sessions)

    def new_session(self, username):
        token = secrets.token_urlsafe(32)
        with self.lock:
            self.sessions[token_id(token)] = {"user": username, "exp": time.time() + SESSION_DAYS * 86400}
            write_json(self.sessions_path, self.sessions)
        return token

    def user_for(self, token):
        if not token:
            return None
        s = self.sessions.get(token_id(token))
        if not s or s["exp"] < time.time() or s["user"] not in self.users:
            return None
        return s["user"]

    def end_session(self, token):
        with self.lock:
            if self.sessions.pop(token_id(token), None):
                write_json(self.sessions_path, self.sessions)


class Handler(SimpleHTTPRequestHandler):
    accounts = None
    static = None
    secure_cookies = False
    server_version = "blackbox"
    sys_version = ""

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def _json(self, code, body, cookie=None):
        data = (body if isinstance(body, str) else json.dumps(body)).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        if cookie is not None:
            self.send_header("Set-Cookie", self._cookie(cookie))
        self.end_headers()
        self.wfile.write(data)

    def _cookie(self, token):
        secure = self.secure_cookies or self.headers.get("X-Forwarded-Proto", "") == "https"
        age = SESSION_DAYS * 86400 if token else 0
        return f"{COOKIE}={token}; Path=/; Max-Age={age}; HttpOnly; SameSite=Lax" + ("; Secure" if secure else "")

    def _token(self):
        for part in self.headers.get("Cookie", "").split(";"):
            name, _, value = part.strip().partition("=")
            if name == COOKIE:
                return value
        return None

    def _user(self):
        return self.accounts.user_for(self._token())

    def _client(self):
        # nginx appends the real peer address last; earlier entries are client-supplied.
        return self.headers.get("X-Forwarded-For", "").split(",")[-1].strip() or self.client_address[0]

    def _body(self):
        """Parse a JSON body. Requiring application/json blocks cross-site form posts (CSRF)."""
        if "application/json" not in self.headers.get("Content-Type", ""):
            raise ValueError("expected application/json")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            raise OverflowError
        body = json.loads(self.rfile.read(length) or b"{}")
        if not isinstance(body, dict):
            raise ValueError("expected a JSON object")
        return body

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            return self._json(200, '"ok"')
        if path == "/api/auth/me":
            return self._json(200, {"user": self._user(), "signup": self.accounts.allow_signup or not self.accounts.users})
        if path == "/api/state":
            user = self._user()
            if not user:
                return self._json(401, {"error": "sign in required"})
            return self._json(200, self.accounts.store(user).snapshot({"user": user}))
        if path.startswith("/api/"):
            return self._json(404, {"error": "not found"})
        if not self.static:
            return self._json(404, {"error": "static files are served by nginx"})
        return super().do_GET()

    def do_HEAD(self):
        if self.static and not self.path.startswith("/api/"):
            return super().do_HEAD()
        self.send_response(405)
        self.end_headers()

    def do_PUT(self):
        path = self.path.split("?", 1)[0]
        if path not in ("/api/state", "/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/auth/password"):
            return self._json(404, {"error": "not found"})
        try:
            body = self._body()
        except OverflowError:
            return self._json(413, {"error": "payload too large"})
        except ValueError as e:
            return self._json(400, {"error": str(e)})

        if path == "/api/state":
            user = self._user()
            if not user:
                return self._json(401, {"error": "sign in required"})
            keys = body.get("keys")
            if not isinstance(keys, dict):
                return self._json(400, {"error": "keys must be an object"})
            return self._json(200, self.accounts.store(user).merge(keys, {"user": user}))

        if path == "/api/auth/logout":
            token = self._token()
            if token:
                self.accounts.end_session(token)
            return self._json(200, {"ok": True}, cookie="")

        username = str(body.get("username", "")).strip().lower()
        password = body.get("password")
        if not isinstance(password, str) or len(password) > 256:
            return self._json(400, {"error": "Password is required"})

        if path == "/api/auth/password":
            user = self._user()
            if not user:
                return self._json(401, {"error": "sign in required"})
            throttle = f"{user}|{self._client()}"
            if self.accounts.locked(throttle):
                return self._json(429, {"error": "Too many attempts — try again in a few minutes"})
            if not self.accounts.verify(user, str(body.get("current", ""))):
                self.accounts.fail(throttle)
                return self._json(403, {"error": "Current password is wrong"})
            if len(password) < 8:
                return self._json(400, {"error": "New password must be at least 8 characters"})
            self.accounts.set_password(user, password, keep_token=self._token())
            return self._json(200, {"ok": True})

        if not USER_RE.match(username):
            return self._json(400, {"error": "Username: 3–32 characters, letters, numbers, . _ -"})

        if path == "/api/auth/register":
            if len(password) < 8:
                return self._json(400, {"error": "Password must be at least 8 characters"})
            token, err = self.accounts.register(username, password)
            if err:
                return self._json(409 if "taken" in err else 403, {"error": err})
            return self._json(200, {"user": username}, cookie=token)

        throttle = f"{username}|{self._client()}"
        if self.accounts.locked(throttle):
            return self._json(429, {"error": "Too many attempts — try again in a few minutes"})
        if not self.accounts.verify(username, password):
            self.accounts.fail(throttle)
            return self._json(401, {"error": "Wrong username or password"})
        self.accounts.fails.pop(throttle, None)
        return self._json(200, {"user": username}, cookie=self.accounts.new_session(username))

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
    ap.add_argument("--data", default="/data", help="directory for accounts and progress")
    ap.add_argument("--static", help="also serve this built site directory (local dev)")
    ap.add_argument("--no-signup", action="store_true", default=os.environ.get("BLACKBOX_SIGNUP", "1") == "0",
                    help="only the first account can be created (or set BLACKBOX_SIGNUP=0)")
    ap.add_argument("--secure-cookies", action="store_true", default=os.environ.get("BLACKBOX_SECURE_COOKIES") == "1",
                    help="mark the session cookie Secure (serve over HTTPS)")
    args = ap.parse_args()

    Handler.accounts = Accounts(args.data, allow_signup=not args.no_signup)
    Handler.static = os.path.abspath(args.static) if args.static else None
    Handler.secure_cookies = args.secure_cookies
    handler = partial(Handler, directory=Handler.static) if Handler.static else Handler
    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"blackbox api on :{args.port} · data={args.data} · signup={'on' if not args.no_signup else 'first account only'}"
          + (f" · static={args.static}" if args.static else ""), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
