#!/usr/bin/env python3
"""BLACKBOX API — accounts plus per-user progress, tasks, habits and focus history.

Python standard library only. Data lives in one SQLite database (WAL mode), so many users and
browsers can read and write at once. The browser works offline from localStorage and syncs every
`bb-*` key here once you're signed in; each key carries a timestamp and the newer write wins.

Auth
    POST /api/auth/register        {username, password, email?}      -> {user, recoveryCodes}
    POST /api/auth/login           {username (or email), password}   -> {user}
    POST /api/auth/logout                                             -> {ok}
    GET  /api/auth/me                                                 -> {user, email, hasPassword, google, providers, signup}
    POST /api/auth/password        {current?, password}              -> {ok}   signs out other devices
    POST /api/auth/email           {email, password?}                 -> {ok}
    POST /api/auth/recovery-codes  {password?}                        -> {recoveryCodes}
    POST /api/auth/forgot          {login}                            -> {ok}   emails a reset link (if mail is set up)
    POST /api/auth/reset           {token, password}                  -> {user}
    POST /api/auth/recover         {username, code, password}         -> {user} one-time recovery code
    POST /api/auth/delete          {password? , confirm}              -> {ok}   deletes the account and its data
    GET  /api/auth/google/start    ?next=/path[&link=1]               -> 302 to Google
    GET  /api/auth/google/callback                                    -> 302 back to the site, signed in
State
    GET  /api/state                -> {keys: {key: {v, t}}, rev, user}
    PUT  /api/state  {keys: {...}} -> merged state (POST works too)
    GET  /api/health               -> "ok"

Security: salted PBKDF2-SHA256 passwords, random session tokens stored only as SHA-256 hashes in
HttpOnly SameSite=Lax cookies, JSON-only bodies plus an Origin check against CSRF, per-IP and
per-account rate limits, generic answers where a reply could reveal whether an account exists,
single-use expiring reset tokens and recovery codes, and Google sign-in via the OAuth 2.0
authorization-code flow with PKCE, state and nonce.

Configuration (environment)
    BLACKBOX_BASE_URL      public URL of the site, e.g. https://learn.example.com (needed for
                           email reset links and Google sign-in)
    BLACKBOX_SIGNUP=0      only the first account may register
    BLACKBOX_SECURE_COOKIES=1  force the Secure cookie flag (automatic behind HTTPS proxies)
    GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET     enable "Continue with Google"
    SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD / SMTP_FROM / SMTP_TLS (starttls|ssl|none)
                                                enable password-reset emails

Usage
    python3 server.py --data /data --port 8000                  # API only (Docker, behind nginx)
    python3 server.py --data ./.data --port 8765 --static dist  # API + site (local)
    python3 server.py --data /data reset-link USERNAME          # print a one-time reset link (admin)
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import smtplib
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY = 10 * 1024 * 1024
MAX_VALUE = 4 * 1024 * 1024
KEY_RE = re.compile(r"^bb-[a-z0-9-]{1,60}$")
USER_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{2,31}$")
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$")
PBKDF2_ITERS = 240_000
SESSION_DAYS = 30
RESET_MINUTES = 30
COOKIE, OAUTH_COOKIE = "bb_session", "bb_oauth"
# Keep in step with deploy/nginx.conf. No inline scripts anywhere, so script-src is 'self' only;
# inline style attributes carry per-program colours, hence 'unsafe-inline' for styles alone.
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; "
       "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'")
SITE_HEADERS = [("Content-Security-Policy", CSP), ("X-Content-Type-Options", "nosniff"), ("X-Frame-Options", "SAMEORIGIN"),
                ("Referrer-Policy", "strict-origin-when-cross-origin"), ("Permissions-Policy", "camera=(), microphone=(), geolocation=()")]
GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"


def now():
    return int(time.time())


def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def hash_password(password, salt=None, iters=PBKDF2_ITERS):
    salt = salt or secrets.token_hex(16)
    return salt, hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), iters).hex(), iters


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


# ───────────────────────────── rate limiting ─────────────────────────────

class Limiter:
    """Sliding-window counters in memory: limit(key, n, seconds) → True when the key is over."""
    def __init__(self):
        self.hits, self.lock = {}, threading.Lock()

    def hit(self, key, n, window):
        t = time.monotonic()
        with self.lock:
            q = [x for x in self.hits.get(key, []) if t - x < window]
            over = len(q) >= n
            if not over:
                q.append(t)
            self.hits[key] = q
            if len(self.hits) > 50_000:                       # keep memory bounded under attack
                for k in list(self.hits)[:10_000]:
                    del self.hits[k]
            return over

    def count(self, key, window):
        t = time.monotonic()
        with self.lock:
            return len([x for x in self.hits.get(key, []) if t - x < window])

    def clear(self, key):
        with self.lock:
            self.hits.pop(key, None)


# ───────────────────────────── storage ─────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, email TEXT UNIQUE, google_sub TEXT UNIQUE,
  pw_salt TEXT, pw_hash TEXT, pw_iters INTEGER, rev INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exp INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS state (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, v TEXT, t INTEGER NOT NULL,
  PRIMARY KEY (user_id, key));
CREATE TABLE IF NOT EXISTS reset_tokens (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS recovery_codes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, code TEXT NOT NULL, PRIMARY KEY (user_id, code));
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY, nonce TEXT NOT NULL, verifier TEXT NOT NULL, link_user INTEGER, next TEXT NOT NULL, exp INTEGER NOT NULL);
"""


class DB:
    def __init__(self, data_dir):
        os.makedirs(data_dir, exist_ok=True)
        self.dir = data_dir
        self.path = os.path.join(data_dir, "blackbox.db")
        self.local = threading.local()
        self.write_lock = threading.Lock()                     # one writer at a time; readers never block (WAL)
        with self.write_lock:
            self.conn().executescript(SCHEMA)                  # executescript manages its own transaction
        self.migrate_json()
        self.prune()

    def conn(self):
        c = getattr(self.local, "c", None)
        if c is None:
            c = sqlite3.connect(self.path, timeout=15, isolation_level=None, check_same_thread=False)
            c.row_factory = sqlite3.Row
            c.execute("PRAGMA journal_mode=WAL")
            c.execute("PRAGMA synchronous=NORMAL")
            c.execute("PRAGMA foreign_keys=ON")
            c.execute("PRAGMA busy_timeout=15000")
            self.local.c = c
        return c

    def q(self, sql, args=()):
        return self.conn().execute(sql, args)

    def one(self, sql, args=()):
        return self.q(sql, args).fetchone()

    class _Tx:
        def __init__(self, db):
            self.db = db

        def __enter__(self):
            self.db.write_lock.acquire()
            c = self.db.conn()
            c.execute("BEGIN IMMEDIATE")
            return c

        def __exit__(self, et, ev, tb):
            c = self.db.conn()
            try:
                c.execute("ROLLBACK" if et else "COMMIT")
            finally:
                self.db.write_lock.release()
            return False

    def tx(self):
        return DB._Tx(self)

    def prune(self):
        with self.tx() as c:
            c.execute("DELETE FROM sessions WHERE exp < ?", (now(),))
            c.execute("DELETE FROM reset_tokens WHERE exp < ?", (now(),))
            c.execute("DELETE FROM oauth_states WHERE exp < ?", (now(),))

    def migrate_json(self):
        """One-time import of the JSON files earlier versions wrote (users.json, sessions.json, users/*/state.json)."""
        users_path = os.path.join(self.dir, "users.json")
        if not os.path.exists(users_path) or self.one("SELECT 1 FROM users LIMIT 1"):
            return
        try:
            users = json.load(open(users_path, encoding="utf-8"))
            sessions = json.load(open(os.path.join(self.dir, "sessions.json"), encoding="utf-8")) if os.path.exists(os.path.join(self.dir, "sessions.json")) else {}
        except (OSError, ValueError) as e:
            print(f"migration skipped: {e}", flush=True)
            return
        with self.tx() as c:
            for name, rec in users.items():
                cur = c.execute("INSERT INTO users (username, pw_salt, pw_hash, pw_iters, created) VALUES (?,?,?,?,?)",
                                (name, rec["salt"], rec["hash"], rec.get("iters", PBKDF2_ITERS), rec.get("created", now())))
                uid = cur.lastrowid
                sp = os.path.join(self.dir, "users", name, "state.json")
                if os.path.exists(sp):
                    try:
                        st = json.load(open(sp, encoding="utf-8"))
                        for k, item in (st.get("keys") or {}).items():
                            c.execute("INSERT OR REPLACE INTO state (user_id, key, v, t) VALUES (?,?,?,?)", (uid, k, item.get("v"), int(item.get("t", 0))))
                        c.execute("UPDATE users SET rev=? WHERE id=?", (int(st.get("rev", 0)), uid))
                    except (OSError, ValueError):
                        pass
            for tok, s in sessions.items():
                row = c.execute("SELECT id FROM users WHERE username=?", (s.get("user"),)).fetchone()
                if row and s.get("exp", 0) > now():
                    c.execute("INSERT OR IGNORE INTO sessions (token, user_id, exp, created) VALUES (?,?,?,?)", (tok, row["id"], int(s["exp"]), now()))
        for f in ("users.json", "sessions.json"):
            p = os.path.join(self.dir, f)
            if os.path.exists(p):
                os.replace(p, p + ".migrated")
        print(f"migrated {len(users)} account(s) from JSON files to SQLite", flush=True)


# ───────────────────────────── accounts ─────────────────────────────

class AuthError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code, self.msg = code, msg


class Service:
    def __init__(self, data_dir, allow_signup=True):
        self.db = DB(data_dir)
        self.allow_signup = allow_signup
        self.limit = Limiter()
        env = os.environ.get
        self.base_url = (env("BLACKBOX_BASE_URL") or "").rstrip("/")
        self.google = (env("GOOGLE_CLIENT_ID"), env("GOOGLE_CLIENT_SECRET")) if env("GOOGLE_CLIENT_ID") and env("GOOGLE_CLIENT_SECRET") else None
        self.smtp = dict(host=env("SMTP_HOST"), port=int(env("SMTP_PORT") or 587), user=env("SMTP_USER"), password=env("SMTP_PASSWORD"),
                         sender=env("SMTP_FROM") or env("SMTP_USER"), tls=(env("SMTP_TLS") or "starttls").lower()) if env("SMTP_HOST") else None
        self._legacy_state = os.path.join(data_dir, "state.json")

    def providers(self):
        return {"google": bool(self.google and self.base_url), "email": bool(self.smtp and self.base_url)}

    # users
    def user(self, uid):
        return self.db.one("SELECT * FROM users WHERE id=?", (uid,))

    def find(self, login):
        login = (login or "").strip().lower()
        if "@" in login:
            return self.db.one("SELECT * FROM users WHERE email=?", (login,))
        return self.db.one("SELECT * FROM users WHERE username=?", (login,))

    def check_password(self, row, password):
        if not row or not row["pw_hash"]:
            hash_password(password or "x")                     # same cost whether or not the account exists
            return False
        got = hash_password(password, row["pw_salt"], row["pw_iters"])[1]
        return hmac.compare_digest(got, row["pw_hash"])

    @staticmethod
    def valid_password(p):
        if not isinstance(p, str) or len(p) < 8:
            raise AuthError(400, "Password must be at least 8 characters")
        if len(p) > 256:
            raise AuthError(400, "Password is too long")

    def register(self, username, password, email=None):
        if not USER_RE.match(username):
            raise AuthError(400, "Username: 3–32 characters — letters, numbers, . _ -")
        self.valid_password(password)
        email = self.clean_email(email) if email else None
        with self.db.tx() as c:
            first = c.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
            if not self.allow_signup and not first:
                raise AuthError(403, "Sign-ups are closed on this server")
            if c.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
                raise AuthError(409, "That username is taken")
            if email and c.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
                raise AuthError(409, "That email is already used by another account")
            salt, h, it = hash_password(password)
            uid = c.execute("INSERT INTO users (username, email, pw_salt, pw_hash, pw_iters, created) VALUES (?,?,?,?,?,?)",
                            (username, email, salt, h, it, now())).lastrowid
            if first:
                self._adopt_legacy(c, uid)
        return uid, self.new_recovery_codes(uid)

    def _adopt_legacy(self, c, uid):
        """Progress saved before accounts existed belongs to whoever sets the server up."""
        if not os.path.exists(self._legacy_state):
            return
        try:
            st = json.load(open(self._legacy_state, encoding="utf-8"))
            for k, item in (st.get("keys") or {}).items():
                c.execute("INSERT OR REPLACE INTO state (user_id, key, v, t) VALUES (?,?,?,?)", (uid, k, item.get("v"), int(item.get("t", 0))))
            os.replace(self._legacy_state, self._legacy_state + ".adopted")
        except (OSError, ValueError) as e:
            print(f"legacy state not adopted: {e}", flush=True)

    @staticmethod
    def clean_email(email):
        email = (email or "").strip().lower()
        if not EMAIL_RE.match(email):
            raise AuthError(400, "That doesn't look like an email address")
        return email

    def set_password(self, uid, password, keep_token=None):
        self.valid_password(password)
        salt, h, it = hash_password(password)
        with self.db.tx() as c:
            c.execute("UPDATE users SET pw_salt=?, pw_hash=?, pw_iters=? WHERE id=?", (salt, h, it, uid))
            c.execute("DELETE FROM sessions WHERE user_id=? AND token != ?", (uid, sha(keep_token) if keep_token else ""))
            c.execute("DELETE FROM reset_tokens WHERE user_id=?", (uid,))

    def set_email(self, uid, email):
        email = self.clean_email(email)
        with self.db.tx() as c:
            row = c.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
            if row and row["id"] != uid:
                raise AuthError(409, "That email is already used by another account")
            c.execute("UPDATE users SET email=? WHERE id=?", (email, uid))

    def delete(self, uid):
        with self.db.tx() as c:
            c.execute("DELETE FROM users WHERE id=?", (uid,))       # cascades to sessions, state, tokens, codes

    # sessions
    def new_session(self, uid):
        token = secrets.token_urlsafe(32)
        with self.db.tx() as c:
            c.execute("INSERT INTO sessions (token, user_id, exp, created) VALUES (?,?,?,?)", (sha(token), uid, now() + SESSION_DAYS * 86400, now()))
        return token

    def session_user(self, token):
        if not token or len(token) > 200:
            return None
        row = self.db.one("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token=? AND s.exp > ?", (sha(token), now()))
        return row

    def end_session(self, token):
        with self.db.tx() as c:
            c.execute("DELETE FROM sessions WHERE token=?", (sha(token),))

    # recovery codes: 8 single-use codes, shown once, stored hashed
    def new_recovery_codes(self, uid):
        codes = ["-".join(secrets.token_hex(2) for _ in range(3)) for _ in range(8)]
        with self.db.tx() as c:
            c.execute("DELETE FROM recovery_codes WHERE user_id=?", (uid,))
            c.executemany("INSERT INTO recovery_codes (user_id, code) VALUES (?,?)", [(uid, sha(x)) for x in codes])
        return codes

    def use_recovery_code(self, uid, code):
        code = re.sub(r"[^0-9a-f]", "", (code or "").lower())
        code = "-".join(code[i:i + 4] for i in range(0, 12, 4)) if len(code) == 12 else "x"
        with self.db.tx() as c:
            cur = c.execute("DELETE FROM recovery_codes WHERE user_id=? AND code=?", (uid, sha(code)))
            return cur.rowcount == 1

    # reset links
    def reset_link(self, uid, base=None):
        token = secrets.token_urlsafe(32)
        with self.db.tx() as c:
            c.execute("DELETE FROM reset_tokens WHERE user_id=?", (uid,))
            c.execute("INSERT INTO reset_tokens (token, user_id, exp) VALUES (?,?,?)", (sha(token), uid, now() + RESET_MINUTES * 60))
        return f"{(base or self.base_url)}/login/index.html#reset={token}"

    def consume_reset(self, token):
        with self.db.tx() as c:
            row = c.execute("SELECT user_id FROM reset_tokens WHERE token=? AND exp > ?", (sha(token or ""), now())).fetchone()
            if row:
                c.execute("DELETE FROM reset_tokens WHERE token=?", (sha(token),))
            return row["user_id"] if row else None

    def send_reset_email(self, row):
        link = self.reset_link(row["id"])
        msg = EmailMessage()
        msg["Subject"], msg["From"], msg["To"] = "Reset your BLACKBOX password", self.smtp["sender"], row["email"]
        msg.set_content(f"Hi {row['username']},\n\nSomeone (hopefully you) asked to reset the password for your BLACKBOX account.\n"
                        f"Open this link within {RESET_MINUTES} minutes to choose a new one:\n\n{link}\n\n"
                        "If you didn't ask for this, you can ignore this email — your password hasn't changed.\n")

        def send():
            s = self.smtp
            try:
                if s["tls"] == "ssl":
                    server = smtplib.SMTP_SSL(s["host"], s["port"], timeout=20)
                else:
                    server = smtplib.SMTP(s["host"], s["port"], timeout=20)
                    if s["tls"] == "starttls":
                        server.starttls()
                if s["user"]:
                    server.login(s["user"], s["password"] or "")
                server.send_message(msg)
                server.quit()
            except (OSError, smtplib.SMTPException) as e:
                print(f"reset email to user {row['id']} failed: {e}", flush=True)
        threading.Thread(target=send, daemon=True).start()

    # state
    def snapshot(self, uid, username):
        rows = self.db.q("SELECT key, v, t FROM state WHERE user_id=?", (uid,)).fetchall()
        rev = self.db.one("SELECT rev FROM users WHERE id=?", (uid,))["rev"]
        return {"keys": {r["key"]: {"v": r["v"], "t": r["t"]} for r in rows}, "rev": rev, "user": username}

    def merge(self, uid, username, incoming):
        cap = int(time.time() * 1000) + 60_000                # a skewed clock can't pin a key forever
        rows = []
        for k, item in incoming.items():
            if not KEY_RE.match(k) or not isinstance(item, dict):
                continue
            v, t = item.get("v"), item.get("t")
            if not isinstance(t, (int, float)) or (v is not None and not isinstance(v, str)):
                continue
            if isinstance(v, str) and len(v) > MAX_VALUE:
                continue
            rows.append((uid, k, v, min(int(t), cap)))
        if rows:
            with self.db.tx() as c:
                changed = 0
                for r in rows:
                    changed += c.execute("INSERT INTO state (user_id, key, v, t) VALUES (?,?,?,?) "
                                         "ON CONFLICT(user_id, key) DO UPDATE SET v=excluded.v, t=excluded.t WHERE excluded.t > state.t", r).rowcount
                if changed:
                    c.execute("UPDATE users SET rev = rev + 1 WHERE id=?", (uid,))
        return self.snapshot(uid, username)

    # Google
    def google_start(self, link_user, next_path):
        state, nonce, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(48)
        with self.db.tx() as c:
            c.execute("INSERT INTO oauth_states (state, nonce, verifier, link_user, next, exp) VALUES (?,?,?,?,?,?)",
                      (state, nonce, verifier, link_user, next_path, now() + 600))
        challenge = b64url(hashlib.sha256(verifier.encode()).digest())
        q = urllib.parse.urlencode({"client_id": self.google[0], "redirect_uri": self.base_url + "/api/auth/google/callback",
                                    "response_type": "code", "scope": "openid email profile", "state": state, "nonce": nonce,
                                    "code_challenge": challenge, "code_challenge_method": "S256", "prompt": "select_account"})
        return state, f"{GOOGLE_AUTH}?{q}"

    def google_finish(self, state, code):
        with self.db.tx() as c:
            st = c.execute("SELECT * FROM oauth_states WHERE state=? AND exp > ?", (state, now())).fetchone()
            c.execute("DELETE FROM oauth_states WHERE state=?", (state,))
        if not st:
            raise AuthError(400, "Sign-in expired — please try again")
        body = urllib.parse.urlencode({"code": code, "client_id": self.google[0], "client_secret": self.google[1],
                                       "redirect_uri": self.base_url + "/api/auth/google/callback",
                                       "grant_type": "authorization_code", "code_verifier": st["verifier"]}).encode()
        try:
            req = urllib.request.Request(GOOGLE_TOKEN, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
            with urllib.request.urlopen(req, timeout=10) as r:
                tok = json.loads(r.read())
        except (urllib.error.URLError, ValueError, OSError) as e:
            print(f"google token exchange failed: {e}", flush=True)
            raise AuthError(502, "Couldn't reach Google — please try again")
        # The ID token came straight from Google's token endpoint over TLS, so (OpenID Connect Core
        # §3.1.3.7) TLS authenticates it; we still check issuer, audience, expiry and nonce.
        try:
            payload = tok["id_token"].split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        except (KeyError, IndexError, ValueError):
            raise AuthError(502, "Google sent an unexpected response")
        if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com") or claims.get("aud") != self.google[0] \
                or int(claims.get("exp", 0)) < now() or not hmac.compare_digest(str(claims.get("nonce", "")), st["nonce"]):
            raise AuthError(400, "Google sign-in couldn't be verified")
        sub = str(claims["sub"])
        email = (claims.get("email") or "").lower() if claims.get("email_verified") else ""
        with self.db.tx() as c:
            owner = c.execute("SELECT id FROM users WHERE google_sub=?", (sub,)).fetchone()
            if st["link_user"]:
                if owner and owner["id"] != st["link_user"]:
                    raise AuthError(409, "That Google account is already linked to another BLACKBOX account")
                c.execute("UPDATE users SET google_sub=? WHERE id=?", (sub, st["link_user"]))
                return st["link_user"], st["next"], "linked"
            if owner:
                return owner["id"], st["next"], "signed-in"
            base = re.sub(r"[^a-z0-9_.-]", "", (email.split("@")[0] if email else "learner").lower())[:24] or "learner"
            base = base if re.match(r"^[a-z0-9]", base) else "u" + base
            name, n = (base + "xx")[:max(3, len(base))], 1
            while c.execute("SELECT 1 FROM users WHERE username=?", (name,)).fetchone():
                n += 1
                name = f"{base}{n}"
            if not self.allow_signup and c.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
                raise AuthError(403, "Sign-ups are closed on this server")
            if email and c.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
                email = ""                                     # never attach someone else's email
            uid = c.execute("INSERT INTO users (username, email, google_sub, created) VALUES (?,?,?,?)",
                            (name, email or None, sub, now())).lastrowid
            return uid, st["next"], "created"


# ───────────────────────────── HTTP ─────────────────────────────

def safe_next(p):
    p = p or "/"
    return p if re.match(r"^/(?![/\\])[^\s]*$", p) else "/"


class Handler(SimpleHTTPRequestHandler):
    svc = None
    static = None
    secure_cookies = False
    server_version = "blackbox"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/") and not self.path.startswith("/api/health"):
            super().log_message(fmt, *args)

    # helpers
    def _secure(self):
        return self.secure_cookies or self.headers.get("X-Forwarded-Proto", "") == "https"

    def _cookie(self, name, value, age):
        return f"{name}={value}; Path=/; Max-Age={age}; HttpOnly; SameSite=Lax" + ("; Secure" if self._secure() else "")

    def _send(self, code, body=b"", ctype="application/json; charset=utf-8", cookies=(), headers=()):
        data = body if isinstance(body, bytes) else (body if isinstance(body, str) else json.dumps(body)).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Length", str(len(data)))
        for c in cookies:
            self.send_header("Set-Cookie", c)
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _json(self, code, body, cookie=None):
        self._send(code, body, cookies=[self._cookie(COOKIE, cookie, SESSION_DAYS * 86400 if cookie else 0)] if cookie is not None else ())

    def _redirect(self, url, cookies=()):
        self._send(302, b"", "text/plain", cookies, [("Location", url)])

    def _read_cookie(self, name):
        for part in self.headers.get("Cookie", "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == name:
                return v
        return None

    def _token(self):
        return self._read_cookie(COOKIE)

    def _me(self):
        return self.svc.session_user(self._token())

    def _client(self):
        # behind nginx the real peer is the last X-Forwarded-For entry; earlier ones are client-supplied
        return self.headers.get("X-Forwarded-For", "").split(",")[-1].strip() or self.client_address[0]

    def _same_origin(self):
        """Reject cross-site writes: browsers send Origin on POST/PUT, and it must match this host."""
        origin = self.headers.get("Origin")
        if not origin:
            return True
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host", "")
        return urllib.parse.urlparse(origin).netloc == host

    def _body(self):
        if "application/json" not in self.headers.get("Content-Type", ""):
            raise AuthError(415, "expected application/json")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            raise AuthError(413, "payload too large")
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            raise AuthError(400, "invalid JSON")
        if not isinstance(body, dict):
            raise AuthError(400, "expected a JSON object")
        return body

    def end_headers(self):
        if not self.path.startswith("/api/"):                 # the site itself (local use; nginx sets the same in Docker)
            self.send_header("Cache-Control", "no-cache")
            for k, v in SITE_HEADERS:
                self.send_header(k, v)
        super().end_headers()

    # routes
    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        path, qs = url.path, urllib.parse.parse_qs(url.query)
        try:
            if path == "/api/health":
                return self._send(200, '"ok"')
            if path == "/api/auth/me":
                u = self._me()
                return self._json(200, {"user": u["username"] if u else None, "email": u["email"] if u else None,
                                        "hasPassword": bool(u and u["pw_hash"]), "google": bool(u and u["google_sub"]),
                                        "providers": self.svc.providers(), "signup": self.svc.allow_signup})
            if path == "/api/state":
                u = self._me()
                if not u:
                    return self._json(401, {"error": "sign in required"})
                return self._json(200, self.svc.snapshot(u["id"], u["username"]))
            if path == "/api/auth/google/start":
                if not self.svc.providers()["google"]:
                    return self._redirect("/login/index.html#error=Google+sign-in+isn%27t+set+up+on+this+server")
                if self.svc.limit.hit("oauth|" + self._client(), 30, 600):
                    return self._redirect("/login/index.html#error=Too+many+attempts")
                u = self._me() if qs.get("link") == ["1"] else None
                state, url2 = self.svc.google_start(u["id"] if u else None, safe_next((qs.get("next") or ["/"])[0]))
                return self._redirect(url2, [self._cookie(OAUTH_COOKIE, state, 600)])
            if path == "/api/auth/google/callback":
                clear = self._cookie(OAUTH_COOKIE, "", 0)
                state, code = (qs.get("state") or [""])[0], (qs.get("code") or [""])[0]
                if qs.get("error") or not code or not state or not hmac.compare_digest(state, self._read_cookie(OAUTH_COOKIE) or ""):
                    return self._redirect("/login/index.html#error=Google+sign-in+was+cancelled+or+expired", [clear])
                try:
                    uid, nxt, how = self.svc.google_finish(state, code)
                except AuthError as e:
                    return self._redirect("/login/index.html#error=" + urllib.parse.quote(e.msg), [clear])
                cookies = [clear]
                if how != "linked":
                    cookies.append(self._cookie(COOKIE, self.svc.new_session(uid), SESSION_DAYS * 86400))
                return self._redirect(nxt + ("#google=linked" if how == "linked" else ""), cookies)
        except AuthError as e:
            return self._json(e.code, {"error": e.msg})
        if path.startswith("/api/"):
            return self._json(404, {"error": "not found"})
        if not self.static:
            return self._json(404, {"error": "static files are served by nginx"})
        return super().do_GET()

    def do_HEAD(self):
        if self.static and not self.path.startswith("/api/"):
            return super().do_HEAD()
        self.send_response(405)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_PUT(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            if not path.startswith("/api/"):
                raise AuthError(405, "method not allowed")
            if not self._same_origin():
                raise AuthError(403, "cross-site request refused")
            body = self._body()
            return self.route_write(path, body)
        except AuthError as e:
            return self._json(e.code, {"error": e.msg})

    do_POST = do_PUT

    def route_write(self, path, body):
        svc, ip = self.svc, self._client()
        if path == "/api/state":
            u = self._me()
            if not u:
                raise AuthError(401, "sign in required")
            keys = body.get("keys")
            if not isinstance(keys, dict):
                raise AuthError(400, "keys must be an object")
            return self._json(200, svc.merge(u["id"], u["username"], keys))

        if not path.startswith("/api/auth/"):
            raise AuthError(404, "not found")
        if svc.limit.hit("auth|" + ip, 40, 60):                 # every auth endpoint: 40 requests/min per IP
            raise AuthError(429, "Too many requests — slow down a little")
        action = path[len("/api/auth/"):]
        text = lambda k: body.get(k) if isinstance(body.get(k), str) else ""

        if action == "logout":
            if self._token():
                svc.end_session(self._token())
            return self._json(200, {"ok": True}, cookie="")

        if action == "register":
            if svc.limit.hit("register|" + ip, 10, 3600):
                raise AuthError(429, "Too many new accounts from here — try again later")
            uid, codes = svc.register(text("username").strip().lower(), text("password"), text("email") or None)
            return self._json(200, {"user": svc.user(uid)["username"], "recoveryCodes": codes}, cookie=svc.new_session(uid))

        if action == "login":
            login = text("login") or text("username")
            key = f"login|{login.strip().lower()}|{ip}"
            if svc.limit.count(key, 900) >= 8 or svc.limit.count("loginfail|" + login.strip().lower(), 900) >= 30:
                raise AuthError(429, "Too many attempts — try again in 15 minutes, or reset your password")
            row = svc.find(login)
            if not svc.check_password(row, text("password")):
                svc.limit.hit(key, 1000, 900); svc.limit.hit("loginfail|" + login.strip().lower(), 1000, 900)
                raise AuthError(401, "Wrong username or password")
            svc.limit.clear(key)
            return self._json(200, {"user": row["username"]}, cookie=svc.new_session(row["id"]))

        if action == "forgot":
            login = text("login").strip().lower()
            if svc.limit.hit("forgot|" + ip, 5, 3600) or svc.limit.hit("forgot|" + login, 3, 3600):
                raise AuthError(429, "Too many reset requests — try again later")
            row = svc.find(login)
            if row and row["email"] and svc.providers()["email"]:
                svc.send_reset_email(row)
            # same answer whether or not the account exists, so this can't be used to probe for accounts
            return self._json(200, {"ok": True, "email": svc.providers()["email"]})

        if action == "reset":
            if svc.limit.hit("reset|" + ip, 10, 3600):
                raise AuthError(429, "Too many attempts — try again later")
            uid = svc.consume_reset(text("token"))
            if not uid:
                raise AuthError(400, "This reset link is invalid or has expired — ask for a new one")
            svc.set_password(uid, text("password"))
            return self._json(200, {"user": svc.user(uid)["username"]}, cookie=svc.new_session(uid))

        if action == "recover":
            name = text("username").strip().lower()
            if svc.limit.hit("recover|" + ip, 10, 3600) or svc.limit.hit("recover|" + name, 5, 3600):
                raise AuthError(429, "Too many attempts — try again later")
            svc.valid_password(text("password"))
            row = svc.find(name)
            if not row or not svc.use_recovery_code(row["id"], text("code")):
                raise AuthError(400, "That username and recovery code don't match")
            svc.set_password(row["id"], text("password"))
            return self._json(200, {"user": row["username"]}, cookie=svc.new_session(row["id"]))

        # everything below needs a signed-in user
        u = self._me()
        if not u:
            raise AuthError(401, "sign in required")
        needs_pw = bool(u["pw_hash"])

        def confirm_password():
            key = f"confirm|{u['id']}"
            if svc.limit.count(key, 900) >= 8:
                raise AuthError(429, "Too many attempts — try again in 15 minutes")
            if needs_pw and not svc.check_password(u, text("current") or text("password")):
                svc.limit.hit(key, 1000, 900)
                raise AuthError(403, "Your current password is wrong")

        if action == "password":
            if needs_pw and not svc.check_password(u, text("current")):
                svc.limit.hit(f"confirm|{u['id']}", 1000, 900)
                raise AuthError(403, "Your current password is wrong")
            svc.set_password(u["id"], text("password"), keep_token=self._token())
            return self._json(200, {"ok": True})
        if action == "email":
            confirm_password()
            svc.set_email(u["id"], text("email"))
            return self._json(200, {"ok": True})
        if action == "recovery-codes":
            confirm_password()
            return self._json(200, {"recoveryCodes": svc.new_recovery_codes(u["id"])})
        if action == "delete":
            confirm_password()
            if text("confirm").strip().lower() != u["username"]:
                raise AuthError(400, "Type your username to confirm")
            svc.delete(u["id"])
            return self._json(200, {"ok": True}, cookie="")
        raise AuthError(404, "not found")

    def send_error(self, code, message=None, explain=None):
        if code == 404 and self.static and os.path.exists(os.path.join(self.static, "404.html")):
            with open(os.path.join(self.static, "404.html"), "rb") as f:
                return self._send(404, f.read(), "text/html; charset=utf-8")
        super().send_error(code, message, explain)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--data", default="/data", help="directory for the database")
    ap.add_argument("--static", help="also serve this built site directory (local use)")
    ap.add_argument("--no-signup", action="store_true", default=os.environ.get("BLACKBOX_SIGNUP", "1") == "0",
                    help="only the first account can be created (or set BLACKBOX_SIGNUP=0)")
    ap.add_argument("--secure-cookies", action="store_true", default=os.environ.get("BLACKBOX_SECURE_COOKIES") == "1",
                    help="always mark the session cookie Secure")
    ap.add_argument("command", nargs="*", help="admin: reset-link USERNAME")
    args = ap.parse_args()

    svc = Service(args.data, allow_signup=not args.no_signup)
    if args.command:
        if args.command[0] == "reset-link" and len(args.command) == 2:
            row = svc.find(args.command[1])
            if not row:
                sys.exit(f"no such user: {args.command[1]}")
            print(svc.reset_link(row["id"], svc.base_url or f"http://localhost:{args.port}"))
            print(f"(valid for {RESET_MINUTES} minutes, single use)")
            return
        sys.exit("unknown command — try: reset-link USERNAME")

    Handler.svc = svc
    Handler.static = os.path.abspath(args.static) if args.static else None
    Handler.secure_cookies = args.secure_cookies
    handler = partial(Handler, directory=Handler.static) if Handler.static else Handler
    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    httpd.daemon_threads = True
    httpd.request_queue_size = 256

    def housekeeping():
        while True:
            time.sleep(3600)
            try:
                svc.db.prune()
            except sqlite3.Error as e:
                print(f"prune failed: {e}", flush=True)
    threading.Thread(target=housekeeping, daemon=True).start()
    p = svc.providers()
    print(f"blackbox api on :{args.port} · data={args.data} · signup={'on' if svc.allow_signup else 'first account only'}"
          f" · google={'on' if p['google'] else 'off'} · reset-email={'on' if p['email'] else 'off'}"
          + (f" · static={args.static}" if args.static else ""), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
