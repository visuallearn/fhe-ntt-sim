#!/usr/bin/env python3
"""Turn manifest.partial.json into docs/data/manifest.json, adding provenance.

The site reads its OpenFHE version, tag, commit and build flags from here, so
nothing about provenance is ever hand-typed into markup.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WORK = REPO / ".work"
OPENFHE = WORK / "openfhe"
DATA = REPO / "docs" / "data"
IMPL_REL = "src/core/include/math/hal/intnat/transformnat-impl.h"

CMAKE_KEYS = (
    "CMAKE_BUILD_TYPE", "CMAKE_CXX_COMPILER", "NATIVE_SIZE", "WITH_OPENMP",
    "WITH_NATIVEOPT", "WITH_BE2", "WITH_BE4", "WITH_NTL", "BUILD_SHARED",
    "BUILD_STATIC", "BUILD_EXAMPLES",
)


def die(msg: str) -> None:
    print(f"[03] FATAL: {msg}", file=sys.stderr)
    sys.exit(1)


def git(*args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(OPENFHE), *args], check=True, capture_output=True, text=True
    ).stdout.strip()


def git_bytes(*args: str) -> bytes:
    """Raw stdout. File contents must not be stripped: the trailing newline is
    part of the blob, and stripping it produced a sha256 that disagreed with the
    one in docs/data/source/*.json and with `git show ... | sha256sum`."""
    return subprocess.run(
        ["git", "-C", str(OPENFHE), *args], check=True, capture_output=True
    ).stdout


def cmake_cache(build: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    cache = build / "CMakeCache.txt"
    if not cache.is_file():
        return out
    for line in cache.read_text(errors="replace").splitlines():
        m = re.match(r"^([A-Za-z0-9_]+):[A-Z]+=(.*)$", line)
        if m and m.group(1) in CMAKE_KEYS:
            out[m.group(1)] = m.group(2)
    return out


def main() -> None:
    partial = DATA / "manifest.partial.json"
    if not partial.is_file():
        die("manifest.partial.json not found; run the generator first")
    man = json.loads(partial.read_text())

    commit = git("rev-parse", "HEAD")
    tag = git("describe", "--tags", "--exact-match", "HEAD")
    sha = hashlib.sha256(git_bytes("show", f"HEAD:{IMPL_REL}")).hexdigest()

    # One hash, published in two places. Make them agree by construction.
    src_doc = json.loads((DATA / "source" / "forward.json").read_text())
    if src_doc["sourceSha256"] != sha:
        die(f"sourceSha256 disagrees: this script computed {sha}, "
            f"docs/data/source/forward.json has {src_doc['sourceSha256']}")

    build = man.pop("build")
    if not build.get("traced"):
        die("manifest came from a non-traced build")

    # Case and convolution metadata, lifted from one trace so the UI can build
    # its pickers without downloading every config.
    cases: list[dict] = []
    convs: list[dict] = []
    feasible = [c for c in man["configs"] if c.get("feasible")]
    if feasible:
        sample = json.loads((DATA / feasible[0]["file"]).read_text())
        cases = [{k: c[k] for k in ("id", "label", "note")} for c in sample["cases"]]
        convs = [{k: c[k] for k in ("id", "label", "note")} for c in sample["convolutions"]]

    out = {
        "schemaVersion": 1,
        "generatedAtUtc": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "openfhe": {
            "version": build["openfheVersion"],
            "tag": tag,
            "commit": commit,
            "commitShort": commit[:12],
            "repo": "https://github.com/openfheorg/openfhe-development",
            "sourceFile": IMPL_REL,
            "sourceSha256": sha,
            "sourcePermalink": f"https://github.com/openfheorg/openfhe-development/blob/{commit}/{IMPL_REL}",
            "nativeInt": build["nativeInt"],
            "mathBackend": build["mathBackend"],
            "maxModulusSize": build["maxModulusSize"],
            "compiler": build["compiler"],
            "cmakeOptions": cmake_cache(WORK / "build-traced"),
        },
        "ringDimensions": man["ringDimensions"],
        "modulusBits": man["modulusBits"],
        "configs": man["configs"],
        # N=8, q=17 is the smallest configuration with three real stages, and every
        # number in it is one or two digits.
        "default": {"N": 8, "bits": 5, "case": "delta1", "dir": "forward"},
        "cases": cases,
        "convolutions": convs,
        "source": {
            "forward": "source/forward.json",
            "inverse": "source/inverse.json",
            "precompute": "source/precompute.json",
            "citations": "source/citations.json",
            "license": "source/LICENSE-OpenFHE.txt",
        },
    }

    (DATA / "manifest.json").write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    partial.unlink()
    nf = sum(1 for c in out["configs"] if c.get("feasible"))
    print(f"[03] manifest.json: OpenFHE {out['openfhe']['version']} @ {out['openfhe']['commitShort']}, "
          f"{nf}/{len(out['configs'])} parameter sets feasible")


if __name__ == "__main__":
    main()
