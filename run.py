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
    return p.is_dir() and any((d / "index.html").exists() for d in p.iterdir() if d.is_dir())


# The DevOps & SRE lessons aren't in this repo: they're the saved pages in a `learn` folder.
candidates = [Path(args.learn).expanduser()] if args.learn else [HERE.parent / "learn", HERE / "learn", HERE.parent.parent / "learn"]
learn = next((p.resolve() for p in candidates if is_learn(p)), None)
if learn:
    print(f"DevOps & SRE lessons: {learn}", flush=True)
else:
    print("\n!! DevOps & SRE lessons not found — looked in:\n   " + "\n   ".join(str(p.resolve()) for p in candidates) +
          "\n   Put your `learn` folder next to this folder, or run:  python3 run.py --learn /path/to/learn"
          "\n   (Building DSA, System Design and Backend only.)\n", flush=True)

print("Building the site…", flush=True)
subprocess.run([sys.executable, str(HERE / "build.py"), str(learn or HERE / ".no-learn"), str(HERE / "dist")], check=True, cwd=HERE)

# Optional settings (Google sign-in, reset emails) from a .env file next to this script.
env = dict(os.environ)
dotenv = HERE / ".env"
if dotenv.exists():
    for line in dotenv.read_text(encoding="utf-8").splitlines():
        key, eq, val = line.strip().partition("=")
        if eq and key and not key.startswith("#") and key not in os.environ:
            env[key.strip()] = val.strip().strip('"').strip("'")
if not env.get("BLACKBOX_BASE_URL") or env["BLACKBOX_BASE_URL"] == "http://localhost:8080":
    env["BLACKBOX_BASE_URL"] = f"http://localhost:{args.port}"

url = f"http://localhost:{args.port}/"
if not args.no_browser:
    threading.Thread(target=lambda: (time.sleep(1.2), webbrowser.open(url)), daemon=True).start()
print(f"\nBLACKBOX is running at {url}  (Ctrl+C to stop)\n", flush=True)
try:
    subprocess.run([sys.executable, str(HERE / "server" / "server.py"), "--static", str(HERE / "dist"),
                    "--data", str(HERE / ".data"), "--host", "127.0.0.1", "--port", str(args.port)], cwd=HERE, env=env)
except KeyboardInterrupt:
    pass
