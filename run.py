#!/usr/bin/env python3
"""One command to see BLACKBOX on your machine: builds the site, starts the server, opens the browser.

    python3 run.py                         # http://localhost:8765
    python3 run.py --learn ~/path/to/learn  # where your saved DevOps & SRE lessons are
    python3 run.py --port 9000

Needs only Python 3. Your accounts and progress are kept in ./.data. Press Ctrl+C to stop.
"""
import argparse
import os
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--port", type=int, default=8765)
ap.add_argument("--learn", help="folder with your saved DevOps & SRE lessons (one sub-folder per track)")
ap.add_argument("--no-browser", action="store_true")
args = ap.parse_args()


def is_learn(p):
    """A lessons folder: sub-folders (one per track) that each have an index.html from hamchops.com/learn."""
    try:
        subs = [d for d in p.iterdir() if d.is_dir() and (d / "index.html").is_file()]
    except OSError:
        return False
    if not subs:
        return False
    if p.name == "learn":
        return True
    try:
        return any("/learn/" in (d / "index.html").read_text(encoding="utf-8", errors="ignore")[:200000] for d in subs[:3])
    except OSError:
        return False


def search(root, depth):
    """Breadth-first look for a lessons folder under root (skips hidden and heavy folders)."""
    level = [root]
    for _ in range(depth):
        nxt = []
        for d in level:
            try:
                kids = sorted(k for k in d.iterdir() if k.is_dir() and not k.name.startswith(".")
                              and k.name not in ("node_modules", "snap", "go", "venv", ".venv", "dist", "vendor"))
            except OSError:
                continue
            for k in kids:
                if k.name == "learn" and is_learn(k):
                    return k
            nxt += kids
        level = nxt
    return None


def dotenv_value(key):
    f = HERE / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            k, eq, v = line.strip().partition("=")
            if eq and k.strip() == key:
                return v.strip().strip('"').strip("'")
    return os.environ.get(key, "")


# The DevOps & SRE lessons aren't in this repo: they're your saved hamchops.com/learn pages in a
# `learn` folder. Use --learn, BLACKBOX_LEARN in .env, or let us look in the usual places.
home = Path.home()
given = args.learn or dotenv_value("BLACKBOX_LEARN")
candidates = [Path(given).expanduser()] if given else [
    HERE / "learn", HERE.parent / "learn", home / "learn", home / "hamchops" / "learn", home / "hamchops"]
learn = next((p.resolve() for p in candidates if is_learn(p)), None)
if not learn and not given:
    print("Looking for your DevOps & SRE lessons…", flush=True)
    for root, depth in ((home / "hamchops", 4), (HERE.parent, 3), (home, 3)):
        learn = search(root, depth) if root.is_dir() else None
        if learn:
            learn = learn.resolve()
            break
if learn:
    print(f"DevOps & SRE lessons: {learn}", flush=True)
else:
    print("\n!! DevOps & SRE lessons not found — looked in:\n   " + "\n   ".join(str(p.resolve()) for p in candidates) +
          "\n   Tell us where it is:  python3 run.py --learn /path/to/learn   (or BLACKBOX_LEARN=/path/to/learn in .env)"
          "\n   (Building DSA, System Design and Backend only.)\n", flush=True)

print("Building the site…", flush=True)
subprocess.run([sys.executable, str(HERE / "build.py"), str(learn or HERE / ".no-learn"), str(HERE / "dist")], check=True, cwd=HERE)

# Optional settings (Google sign-in, reset emails) from a .env file next to this script.
env = dict(os.environ)
dotenv = HERE / ".env"
if not dotenv.exists() and (HERE / ".env.example").exists():
    dotenv.write_text((HERE / ".env.example").read_text(encoding="utf-8"), encoding="utf-8")
    print(f"Created {dotenv} — put your Google / email settings there.", flush=True)
if dotenv.exists():
    for line in dotenv.read_text(encoding="utf-8").splitlines():
        key, eq, val = line.strip().partition("=")
        if eq and key and not key.startswith("#") and key not in os.environ:
            env[key.strip()] = val.strip().strip('"').strip("'")
if not env.get("BLACKBOX_BASE_URL") or env["BLACKBOX_BASE_URL"] == "http://localhost:8080":
    env["BLACKBOX_BASE_URL"] = f"http://localhost:{args.port}"

if not (env.get("GOOGLE_CLIENT_ID") and env.get("GOOGLE_CLIENT_SECRET")):
    print("\nGoogle sign-in is off. To turn it on:\n"
          "  1. https://console.cloud.google.com/apis/credentials → Create credentials → OAuth client ID → Web application\n"
          f"  2. Authorized redirect URI:  {env['BLACKBOX_BASE_URL']}/api/auth/google/callback\n"
          f"  3. Paste the Client ID and Client secret into {dotenv} (GOOGLE_CLIENT_ID=..., GOOGLE_CLIENT_SECRET=...)\n"
          "  4. Restart:  python3 run.py\n", flush=True)

url = f"http://localhost:{args.port}/"
if not args.no_browser:
    threading.Thread(target=lambda: (time.sleep(1.2), webbrowser.open(url)), daemon=True).start()
print(f"\nBLACKBOX is running at {url}  (Ctrl+C to stop)\n", flush=True)
try:
    subprocess.run([sys.executable, str(HERE / "server" / "server.py"), "--static", str(HERE / "dist"),
                    "--data", str(HERE / ".data"), "--host", "127.0.0.1", "--port", str(args.port)], cwd=HERE, env=env)
except KeyboardInterrupt:
    pass
