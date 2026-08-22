#!/usr/bin/env python3
"""Compare the standalone reference experiments against the traces on the site.

openfhe-gt-exp/ is built out of tree against an installed OpenFHE, and knows
nothing about docs/data/. If its numbers agree with the JSON the browser loads,
then the site's data is reproducible by anyone with an OpenFHE install, which is
the whole point of shipping the experiments.

Reads openfhe-gt-exp/expected/DIGEST.txt and docs/data/traces/*.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DIGEST = REPO / "openfhe-gt-exp" / "expected" / "DIGEST.txt"
TRACES = REPO / "docs" / "data" / "traces"

failures: list[str] = []
checks = 0


def check(cond: bool, msg: str) -> None:
    global checks
    checks += 1
    if not cond:
        failures.append(msg)


def main() -> int:
    if not DIGEST.is_file():
        print(f"[13] FATAL: {DIGEST.relative_to(REPO)} missing.\n"
              "       Build and run the experiments first:\n"
              "         ./tools/12_install_openfhe.sh\n"
              "         ./tools/14_build_gt_exp.sh", file=sys.stderr)
        return 1

    # digest[config][key] = list[int]  (or the raw string for "params")
    digest: dict[str, dict[str, object]] = {}
    for line in DIGEST.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) != 3:
            failures.append(f"malformed digest line: {line!r}")
            continue
        cfg, key, val = parts
        digest.setdefault(cfg, {})[key] = val

    traces = {p.stem: json.loads(p.read_text()) for p in sorted(TRACES.glob("*.json"))}
    check(set(digest) == set(traces),
          f"configurations differ: experiments {sorted(set(digest) - set(traces))}, "
          f"traces {sorted(set(traces) - set(digest))}")

    def nums(cfg: str, key: str) -> list[int] | None:
        v = digest.get(cfg, {}).get(key)
        if v is None:
            failures.append(f"{cfg}: digest has no {key!r}")
            return None
        return [int(x) for x in str(v).split()] if str(v).strip() else []

    for cfg in sorted(set(digest) & set(traces)):
        t = traces[cfg]
        p = t["params"]

        # parameters
        raw = str(digest[cfg].get("params", ""))
        kv = dict(item.split("=", 1) for item in raw.split() if "=" in item)
        for name, want in (("N", p["N"]), ("M", p["M"]), ("bits", p["bits"]),
                           ("q", p["q"]), ("psi", p["psi"]), ("psiInv", p["psiInv"]),
                           ("nInv", p["nInv"]), ("brevBits", p["brevBits"])):
            check(kv.get(name) == str(want),
                  f"{cfg}: {name} is {kv.get(name)} in the experiment, {want} in the trace")

        # tables
        check(nums(cfg, "fwd-table") == [e["v"] for e in t["tables"]["fwd"]],
              f"{cfg}: forward twiddle table differs")
        check(nums(cfg, "inv-table") == [e["v"] for e in t["tables"]["inv"]],
              f"{cfg}: inverse twiddle table differs")
        check(nums(cfg, "coi-table") == [e["v"] for e in t["tables"]["coi"]],
              f"{cfg}: cyclotomic-order inverse table differs")
        check(nums(cfg, "omega1Inv") == [t["tables"]["omega1Inv"]["v"]],
              f"{cfg}: fused final twiddle differs")

        # every input case: input, forward output, inverse output
        for c in t["cases"]:
            cid = c["id"]
            check(nums(cfg, f"case {cid} input") == c["input"],
                  f"{cfg}/{cid}: input vector differs")
            check(nums(cfg, f"case {cid} forward") == c["forward"]["expected"],
                  f"{cfg}/{cid}: forward output differs")
            check(nums(cfg, f"case {cid} inverse") == c["inverse"]["expected"],
                  f"{cfg}/{cid}: inverse output differs")

        # every convolution
        for cv in t["convolutions"]:
            cid = cv["id"]
            check(nums(cfg, f"conv {cid} a") == cv["a"], f"{cfg}/conv:{cid}: a differs")
            check(nums(cfg, f"conv {cid} b") == cv["b"], f"{cfg}/conv:{cid}: b differs")
            check(nums(cfg, f"conv {cid} product") == cv["product"],
                  f"{cfg}/conv:{cid}: product differs")

        # the human report must exist and state that it passed
        rpt = DIGEST.parent / f"{cfg}.txt"
        check(rpt.is_file(), f"{cfg}: report {rpt.name} missing")
        if rpt.is_file():
            text = rpt.read_text()
            check("ALL PASSED" in text, f"{cfg}: report does not say ALL PASSED")
            check("*** " not in text, f"{cfg}: report contains a failure marker")
            # The report must actually show the things it promises.
            for section in ("PARAMETERS", "FORWARD TWIDDLE TABLE", "INVERSE TWIDDLE TABLE",
                            "CYCLOTOMIC-ORDER INVERSE TABLE", "TWIDDLE FACTORS USED BY EACH STAGE",
                            "EVALUATION POINTS", "input, coefficient form",
                            "forward NTT output", "inverse NTT output", "NEGACYCLIC PRODUCT"):
                check(section in text, f"{cfg}: report has no {section!r} section")

    print(f"[13] {len(set(digest) & set(traces))} configurations, {checks} comparisons")
    if failures:
        print(f"[13] {len(failures)} FAILURE(S):", file=sys.stderr)
        for f in failures[:30]:
            print(f"       {f}", file=sys.stderr)
        return 1
    print("[13] OK -- the reference experiments and the shipped traces agree exactly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
