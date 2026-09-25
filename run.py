#!/usr/bin/env python3
"""One command to see BLACKBOX on your machine: builds the site, starts the server, opens the browser.

    python3 run.py              # http://localhost:8765
    python3 run.py --port 9000

Needs only Python 3. Your accounts and progress are kept in ./.data. Press Ctrl+C to stop.
"""
import argparse
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--port", type=int, default=8765)
ap.add_argument("--no-browser", action="store_true")
args = ap.parse_args()

print("Building the site…", flush=True)
subprocess.run([sys.executable, str(HERE / "build.py")], check=True, cwd=HERE)

url = f"http://localhost:{args.port}/"
if not args.no_browser:
    threading.Thread(target=lambda: (time.sleep(1.2), webbrowser.open(url)), daemon=True).start()
print(f"\nBLACKBOX is running at {url}  (Ctrl+C to stop)\n", flush=True)
try:
    subprocess.run([sys.executable, str(HERE / "server" / "server.py"), "--static", str(HERE / "dist"),
                    "--data", str(HERE / ".data"), "--host", "127.0.0.1", "--port", str(args.port)], cwd=HERE)
except KeyboardInterrupt:
    pass
