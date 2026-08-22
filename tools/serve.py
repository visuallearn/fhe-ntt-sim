#!/usr/bin/env python3
"""Serve docs/ for local development, with caching turned off.

python3 -m http.server sends Last-Modified but no Cache-Control and no ETag. A
browser is then free to reuse a heuristically-fresh copy without asking, so an
edited stylesheet can stay stale for a long time and the page renders with old
CSS and new JS. That looks like a broken site. This server says no-store.

Usage: python3 tools/serve.py [port]
"""
from __future__ import annotations

import functools
import http.server
import socketserver
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    handler = functools.partial(NoCacheHandler, directory=str(DOCS))
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", port), handler) as httpd:
        print(f"serving {DOCS} on http://localhost:{port}/  (no-store)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
