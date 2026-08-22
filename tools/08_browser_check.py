#!/usr/bin/env python3
"""Drive the published site in a headless browser and report pass/fail.

Runs three checks, all of which need a local server and chromium:

  data      docs/selftest.html   -- re-verifies every shipped trace in the browser
  layout    measure.html         -- no horizontal page overflow at any width
  interact  interact.html        -- transport, keyboard, playback, pickers, routes
  audit     audit.html           -- subscription leaks across route remounts,
                                    toggle state, malformed and out-of-range deep
                                    links, browser history, racing config clicks

The two probe pages live in tools/browser-checks/ and are copied into docs/ only
for the duration of the run, so they are never part of the published site.

Usage:  python3 tools/serve.py 8777 &
        python3 tools/08_browser_check.py 8777
"""
from __future__ import annotations

import html
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PROBES = REPO / "tools" / "browser-checks"
DOCS = REPO / "docs"
PORT = sys.argv[1] if len(sys.argv) > 1 else "8777"
BASE = f"http://localhost:{PORT}"

LAYOUT_ROUTES = [
    "#/tour",
    "#/transform?N=32&bits=8&case=random&dir=inverse&step=70",
    "#/transform?N=8&bits=5&case=ramp&dir=forward&step=12",
    "#/roots?N=32&bits=10",
    "#/convolution?N=32&bits=8&conv=random",
    "#/about",
]
WIDTHS = [390, 480, 768, 1024, 1280, 1780]


def dom(url: str, width: int = 1500, height: int = 1000, budget: int = 20000) -> str:
    return subprocess.run(
        ["chromium", "--headless=new", "--no-sandbox", "--disable-gpu",
         f"--window-size={width},{height}", f"--virtual-time-budget={budget}",
         "--dump-dom", url],
        capture_output=True, text=True, timeout=300).stdout


def strip(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s))


def check_data() -> int:
    print("== data: docs/selftest.html")
    out = dom(f"{BASE}/selftest.html", budget=40000)
    m = re.search(r'data-selftest="([a-z]+)"', out)
    summary = re.search(r'id="summary"[^>]*>(.*?)</p>', out, re.S)
    print("  " + (strip(summary.group(1)).strip() if summary else "no summary"))
    if not m or m.group(1) != "pass":
        for f in re.findall(r'id="fails"[^>]*>(.*?)</div>', out, re.S)[:1]:
            print("  " + strip(f)[:2000])
        return 1
    return 0


def check_layout() -> int:
    print("== layout: horizontal overflow")
    dst = DOCS / "measure.html"
    shutil.copy2(PROBES / "measure.html", dst)
    bad = 0
    try:
        for w in WIDTHS:
            for r in LAYOUT_ROUTES:
                url = f"{BASE}/measure.html?w={w}&r={r.replace('#', '%23')}"
                out = dom(url, width=w, budget=9000)
                m = re.search(r'id="result">([^<]*)<', out)
                res = html.unescape(m.group(1)) if m else "NO RESULT"
                if not res.startswith("ok"):
                    bad += 1
                    print(f"  FAIL {w:>5}px {r}  {res}")
    finally:
        dst.unlink(missing_ok=True)
    print(f"  {len(WIDTHS) * len(LAYOUT_ROUTES)} width/route combinations, "
          f"{'no overflow' if not bad else f'{bad} overflowing'}")
    return 1 if bad else 0


def run_harness(name: str, label: str, budget: int) -> int:
    """Copy one iframe harness into docs/, run it, print its verdict, remove it."""
    print(f"== {name}: {label}")
    dst = DOCS / f"{name}.html"
    shutil.copy2(PROBES / f"{name}.html", dst)
    try:
        out = dom(f"{BASE}/{name}.html", width=1700, height=1300, budget=budget)
    finally:
        dst.unlink(missing_ok=True)
    head = re.search(r'id="head">([^<]*)<', out)
    print("  " + (html.unescape(head.group(1)) if head else "did not finish"))
    # Only the report half of the page; the harness source contains the same
    # markup as literal strings.
    report = out.split("<iframe")[0]
    for m in re.finditer(r'<div class="bad">([^<]*)</div>', report):
        print("  FAIL " + html.unescape(m.group(1)))
    m = re.search(r'data-result="([a-z]+)"', out)
    return 0 if (m and m.group(1) == "pass") else 1


def main() -> int:
    if subprocess.run(["curl", "-sf", "-o", "/dev/null", f"{BASE}/index.html"]).returncode:
        print(f"[08] FATAL: nothing serving on {BASE}. Start it with:\n"
              f"       python3 tools/serve.py {PORT} &", file=sys.stderr)
        return 1
    bad = (
        check_data()
        + check_layout()
        + run_harness("interact", "controls, keyboard, playback, pickers, routes", 120000)
        + run_harness("audit", "subscription leaks, toggles, malformed URLs, history, races", 200000)
    )
    print()
    print("[08] OK" if not bad else f"[08] {bad} check group(s) FAILED")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
