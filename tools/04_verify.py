#!/usr/bin/env python3
"""Independently verify every generated trace. Python stdlib only.

Nothing here shares code with OpenFHE or with ntt_trace_gen. The parameters, the
twiddle tables and the transforms are all re-derived from their definitions, in
plain Python integers, and compared against what the traces claim. If this passes,
the data on the site is what OpenFHE actually computed.

Exit status 0 = every check passed.
"""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "docs" / "data"
TRACES = DATA / "traces"
SOURCE = DATA / "source"

failures: list[str] = []
checks = 0


def check(cond: bool, msg: str) -> bool:
    global checks
    checks += 1
    if not cond:
        failures.append(msg)
    return cond


# ---------------------------------------------------------------------------
# Number theory, from definitions
# ---------------------------------------------------------------------------


def is_prime(n: int) -> bool:
    if n < 2:
        return False
    for p in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        if n % p == 0:
            return n == p
    d, r = n - 1, 0
    while d % 2 == 0:
        d //= 2
        r += 1
    for a in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(r - 1):
            x = x * x % n
            if x == n - 1:
                break
        else:
            return False
    return True


def last_prime(nbits: int, m: int) -> int | None:
    """Reimplementation of OpenFHE LastPrime<NativeInteger>(nbits, m).

    Largest prime below 2^nbits congruent to 1 mod m, and it must have exactly
    nbits bits -- OpenFHE throws otherwise, which is why small moduli are
    infeasible for larger ring dimensions.
    """
    q = 1 << nbits
    r = q % m
    cand = q + 1 - r
    if r < 2:
        cand -= m
    while cand > 0 and not is_prime(cand):
        cand -= m
    if cand <= 0:
        return None
    if cand.bit_length() != nbits:
        return None
    return cand


def root_of_unity(m: int, q: int) -> int | None:
    """Minimum primitive m-th root of unity mod q, for m a power of two.

    OpenFHE finds one primitive root then minimises over its odd powers. For
    power-of-two m the odd powers are exactly the full set of primitive m-th
    roots, so minimising over the whole set gives the same answer by a route
    that shares no code with OpenFHE.
    """
    if (q - 1) % m:
        return None
    best = None
    half = m // 2
    for x in range(2, q):
        if pow(x, m, q) == 1 and pow(x, half, q) != 1:
            if best is None or x < best:
                best = x
    return best


def brev(x: int, bits: int) -> int:
    return int(format(x, f"0{bits}b")[::-1], 2) if bits else 0


# ---------------------------------------------------------------------------
# Transform oracles, O(N^2), no butterflies
# ---------------------------------------------------------------------------


def oracle_forward(a: list[int], q: int, psi: int, brev_bits: int) -> list[int]:
    n = len(a)
    return [
        sum(c * pow(psi, (2 * brev(p, brev_bits) + 1) * i, q) for i, c in enumerate(a)) % q
        for p in range(n)
    ]


def oracle_inverse(ahat: list[int], q: int, psi: int, brev_bits: int) -> list[int]:
    n = len(ahat)
    ninv = pow(n, -1, q)
    psinv = pow(psi, -1, q)
    return [
        ninv
        * sum(v * pow(psinv, (2 * brev(p, brev_bits) + 1) * i, q) for p, v in enumerate(ahat))
        % q
        for i in range(n)
    ]


def negacyclic(a: list[int], b: list[int], q: int) -> list[int]:
    n = len(a)
    c = [0] * n
    for i, x in enumerate(a):
        for j, y in enumerate(b):
            k = i + j
            if k < n:
                c[k] = (c[k] + x * y) % q
            else:
                c[k - n] = (c[k - n] - x * y) % q
    return c


# ---------------------------------------------------------------------------
# Trace replay
# ---------------------------------------------------------------------------


def replay(direction: dict, q: int, tag: str) -> tuple[list[int], int, int]:
    """Fold the event stream with textbook arithmetic. Returns (array, butterflies, stages)."""
    arr = list(direction["input"])
    events = direction["events"]
    keyframes = {k["s"]: k["array"] for k in direction["keyframes"]}
    bf = 0
    stages = 0
    tw = None
    seen_steps = []

    for e in events:
        s, k = e["s"], e["k"]
        seen_steps.append(s)
        if s in keyframes:
            check(keyframes[s] == arr, f"{tag}: keyframe at step {s} disagrees with replay")

        if k == "begin":
            check(arr == list(direction["input"]), f"{tag}: begin state is not the input")
        elif k == "stage":
            if e["region"] != "scale":
                stages += 1
                check(e["stage"] == stages, f"{tag}: stage numbering broke at step {s}")
        elif k == "tw":
            tw = e["tw"]
        elif k == "bfly_ct":
            lo, hi, u, v = e["lo"], e["hi"], e["u"], e["v"]
            check(arr[lo] == u and arr[hi] == v, f"{tag}: CT inputs disagree with state at step {s}")
            check(e["tw"] == tw, f"{tag}: CT twiddle {e['tw']} != last loaded {tw} at step {s}")
            prod = v * e["tw"] % q
            check(e["prod"] == prod, f"{tag}: CT product wrong at step {s}")
            check(e["outLo"] == (u + prod) % q, f"{tag}: CT outLo wrong at step {s}")
            check(e["outHi"] == (u - prod) % q, f"{tag}: CT outHi wrong at step {s}")
            arr[lo], arr[hi] = e["outLo"], e["outHi"]
            bf += 1
        elif k == "bfly_gs":
            lo, hi, u, v = e["lo"], e["hi"], e["u"], e["v"]
            check(arr[lo] == u and arr[hi] == v, f"{tag}: GS inputs disagree with state at step {s}")
            check(e["tw"] == tw, f"{tag}: GS twiddle {e['tw']} != last loaded {tw} at step {s}")
            check(e["sum"] == (u + v) % q, f"{tag}: GS sum wrong at step {s}")
            check(e["diff"] == (u - v) % q, f"{tag}: GS diff wrong at step {s}")
            check(e["prod"] == e["diff"] * e["tw"] % q, f"{tag}: GS product wrong at step {s}")
            check(e["outLo"] == e["sum"], f"{tag}: GS outLo wrong at step {s}")
            check(e["outHi"] == e["prod"], f"{tag}: GS outHi wrong at step {s}")
            arr[lo], arr[hi] = e["outLo"], e["outHi"]
            bf += 1
        elif k == "scale":
            check(arr[e["idx"]] == e["in"], f"{tag}: scale input disagrees with state at step {s}")
            check(e["out"] == e["in"] * e["factor"] % q, f"{tag}: scale product wrong at step {s}")
            arr[e["idx"]] = e["out"]
        elif k == "end":
            pass
        else:
            check(False, f"{tag}: unknown event kind {k!r}")

    check(seen_steps == list(range(len(events))), f"{tag}: step indices are not 0..n-1 in order")
    check(arr == direction["expected"], f"{tag}: replay result != recorded expected output")
    return arr, bf, stages


def check_census(direction: dict, n: int, forward: bool, tag: str) -> None:
    """Every stage must cover every index exactly once, with the documented strides."""
    logn = int(math.log2(n))
    strides_seen: list[int] = []
    per_stage: dict[int, list[tuple[int, int]]] = {}
    for e in direction["events"]:
        if e["k"] in ("bfly_ct", "bfly_gs"):
            per_stage.setdefault(e["stage"], []).append((e["lo"], e["hi"]))

    check(sorted(per_stage) == list(range(1, logn + 1)), f"{tag}: stages present = {sorted(per_stage)}")
    for st, pairs in sorted(per_stage.items()):
        check(len(pairs) == n // 2, f"{tag}: stage {st} has {len(pairs)} butterflies, expected {n // 2}")
        touched = [i for p in pairs for i in p]
        check(sorted(touched) == list(range(n)), f"{tag}: stage {st} does not cover every index once")
        strides = {hi - lo for lo, hi in pairs}
        check(len(strides) == 1, f"{tag}: stage {st} has mixed strides {strides}")
        strides_seen.append(strides.pop())

    want = [n >> s for s in range(1, logn + 1)] if forward else [1 << s for s in range(0, logn)]
    check(strides_seen == want, f"{tag}: stride sequence {strides_seen}, expected {want}")


# ---------------------------------------------------------------------------
# Golden vectors, hand-computed from the algorithm before any code was written
# ---------------------------------------------------------------------------

GOLDEN = {
    "n4-b5-q17.json": {
        "psi": 2,
        "fwd_table": [1, 4, 2, 8],
        "inv_table": [1, 13, 9, 15],
        "nInv": 13,
        "omega1Inv": 16,
        "delta1_forward": [2, 15, 8, 9],
        "delta1_keyframes": [[0, 1, 0, 0], [0, 1, 0, 1], [2, 15, 8, 9]],
    },
    "n8-b5-q17.json": {
        "psi": 3,
        "fwd_table": [1, 13, 9, 15, 3, 5, 10, 11],
        "inv_table": [1, 4, 2, 8, 6, 7, 12, 14],
        "nInv": 15,
        "omega1Inv": 9,
        "delta1_forward": [3, 14, 5, 12, 10, 7, 11, 6],
        "delta1_keyframes": [
            [0, 1, 0, 0, 0, 0, 0, 0],
            [0, 1, 0, 0, 0, 1, 0, 0],
            [0, 1, 0, 1, 0, 1, 0, 1],
            [3, 14, 5, 12, 10, 7, 11, 6],
        ],
    },
}

# Feasibility matrix, hand-computed from LastPrime's definition. (N, bits) -> q or None.
EXPECTED_MATRIX = {
    (4, 4): None, (4, 5): 17, (4, 6): 41, (4, 7): 113, (4, 8): 241, (4, 9): 457, (4, 10): 1009,
    (8, 4): None, (8, 5): 17, (8, 6): None, (8, 7): 113, (8, 8): 241, (8, 9): 449, (8, 10): 1009,
    (16, 4): None, (16, 5): None, (16, 6): None, (16, 7): 97, (16, 8): 193, (16, 9): 449, (16, 10): 929,
    (32, 4): None, (32, 5): None, (32, 6): None, (32, 7): None, (32, 8): 193, (32, 9): 449, (32, 10): 769,
}


# ---------------------------------------------------------------------------


def verify_config(path: Path, anchors: dict, ranges: list[tuple[int, int]]) -> dict:
    d = json.loads(path.read_text())
    p = d["params"]
    n, m, bits, q, psi = p["N"], p["M"], p["bits"], p["q"], p["psi"]
    bb = p["brevBits"]
    tag = path.name

    check(d["schemaVersion"] == 1, f"{tag}: unexpected schemaVersion")
    check(m == 2 * n, f"{tag}: M != 2N")
    check(bb == int(math.log2(n)), f"{tag}: brevBits != log2(N)")

    # 1. parameters, re-derived
    check(last_prime(bits, m) == q, f"{tag}: q={q} != independent LastPrime({bits},{m})")
    check(root_of_unity(m, q) == psi, f"{tag}: psi={psi} != independent minimum primitive {m}-th root")
    check(pow(psi, n, q) == q - 1, f"{tag}: psi^N != -1 mod q")
    check(pow(psi, m, q) == 1, f"{tag}: psi^M != 1 mod q")
    check(p["psiInv"] == pow(psi, -1, q), f"{tag}: psiInv wrong")
    check(p["nInv"] == pow(n, -1, q), f"{tag}: nInv wrong")
    check(p["omegaN"] == psi * psi % q, f"{tag}: omegaN != psi^2")
    check(p["negOne"] == q - 1, f"{tag}: negOne != q-1")
    check(q < (1 << bits) and q.bit_length() == bits, f"{tag}: q does not have {bits} bits")
    check((q - 1) % m == 0, f"{tag}: q !≡ 1 mod 2N")

    # 2. tables, re-derived
    psinv = pow(psi, -1, q)
    for j, e in enumerate(d["tables"]["fwd"]):
        check(e["j"] == j and e["brev"] == brev(j, bb), f"{tag}: fwd table index {j} malformed")
        check(e["v"] == pow(psi, brev(j, bb), q), f"{tag}: fwd table[{j}] != psi^brev({j})")
        check(int(e["precon"]) == (e["v"] << 64) // q, f"{tag}: fwd precon[{j}] != floor(w*2^64/q)")
    for j, e in enumerate(d["tables"]["inv"]):
        check(e["v"] == pow(psinv, brev(j, bb), q), f"{tag}: inv table[{j}] != psi^-brev({j})")
        check(int(e["precon"]) == (e["v"] << 64) // q, f"{tag}: inv precon[{j}] wrong")
    for e in d["tables"]["coi"]:
        check(e["v"] == pow(pow(2, e["i"], q), -1, q), f"{tag}: coi[{e['i']}] != (2^i)^-1")
    check(
        d["tables"]["coi"][bb]["v"] == pow(n, -1, q),
        f"{tag}: coi[log2 N] is not N^-1 -- the index the inverse transform uses",
    )
    check(
        d["tables"]["omega1Inv"]["v"] == d["tables"]["inv"][1]["v"] * pow(n, -1, q) % q,
        f"{tag}: omega1Inv != TableI[1] * N^-1",
    )
    check(
        d["tables"]["omega1Inv"]["v"] == pow(psinv, n // 2, q) * pow(n, -1, q) % q,
        f"{tag}: omega1Inv != psi^-(N/2) * N^-1",
    )

    # 3-6. per-case transforms
    case_ids = []
    for c in d["cases"]:
        case_ids.append(c["id"])
        ctag = f"{tag}/{c['id']}"
        a = c["input"]
        check(len(a) == n, f"{ctag}: input length")
        check(all(0 <= x < q for x in a), f"{ctag}: input has a value outside [0,q)")

        ahat = c["forward"]["expected"]
        check(oracle_forward(a, q, psi, bb) == ahat, f"{ctag}: forward != O(N^2) oracle")
        replay(c["forward"], q, ctag + "/forward")
        check_census(c["forward"], n, True, ctag + "/forward")

        back = c["inverse"]["expected"]
        check(c["inverse"]["input"] == ahat, f"{ctag}: inverse input != forward output")
        check(oracle_inverse(ahat, q, psi, bb) == back, f"{ctag}: inverse != O(N^2) oracle")
        replay(c["inverse"], q, ctag + "/inverse")
        check_census(c["inverse"], n, False, ctag + "/inverse")
        check(back == a, f"{ctag}: round trip did not return the input")
        check(c["roundTripOk"] is True, f"{ctag}: roundTripOk not set")

        for ep in c["evalPoints"]:
            e_exp = 2 * brev(ep["slot"], bb) + 1
            check(ep["exp"] == e_exp, f"{ctag}: evalPoint exponent for slot {ep['slot']}")
            check(ep["point"] == pow(psi, e_exp, q), f"{ctag}: evalPoint value for slot {ep['slot']}")
            check(ep["value"] == ahat[ep["slot"]], f"{ctag}: evalPoint output for slot {ep['slot']}")

    # convolutions
    for cv in d["convolutions"]:
        vtag = f"{tag}/conv:{cv['id']}"
        check(oracle_forward(cv["a"], q, psi, bb) == cv["aHat"], f"{vtag}: aHat")
        check(oracle_forward(cv["b"], q, psi, bb) == cv["bHat"], f"{vtag}: bHat")
        check(
            [x * y % q for x, y in zip(cv["aHat"], cv["bHat"])] == cv["cHat"],
            f"{vtag}: pointwise product",
        )
        check(oracle_inverse(cv["cHat"], q, psi, bb) == cv["product"], f"{vtag}: inverse of product")
        school = negacyclic(cv["a"], cv["b"], q)
        check(school == cv["schoolbook"], f"{vtag}: recorded schoolbook product")
        check(school == cv["product"], f"{vtag}: NTT route != schoolbook negacyclic product")
        # Multiplication counts. opsNtt includes the trailing multiply by N^-1
        # inside the inverse transform, because the simulator animates those
        # steps: a total that excluded them would contradict what it shows.
        logn = int(math.log2(n))
        check(cv["opsSchoolbook"] == n * n, f"{vtag}: schoolbook op count")
        check(cv["opsButterfly"] == 3 * (n // 2) * logn, f"{vtag}: butterfly multiplications")
        check(cv["opsPointwise"] == n, f"{vtag}: pointwise multiplications")
        check(cv["opsScale"] == n // 2, f"{vtag}: multiplications by N^-1")
        check(
            cv["opsNtt"] == cv["opsButterfly"] + cv["opsPointwise"] + cv["opsScale"],
            f"{vtag}: opsNtt is not the sum of its parts",
        )
        # opsScale must equal the number of scale steps the trace actually records.
        scale_events = sum(1 for e in cv["inverse"]["events"] if e["k"] == "scale")
        check(cv["opsScale"] == scale_events,
              f"{vtag}: opsScale {cv['opsScale']} != {scale_events} recorded scale steps")
        for part, direction in (("forwardA", True), ("forwardB", True), ("inverse", False)):
            replay(cv[part], q, f"{vtag}/{part}")
            check_census(cv[part], n, direction, f"{vtag}/{part}")

    # 7. source-line integrity
    lines_used = set()
    for c in d["cases"]:
        for direction in ("forward", "inverse"):
            for e in c[direction]["events"]:
                lines_used.add(e["line"])
    for ln in sorted(lines_used):
        check(str(ln) in anchors, f"{tag}: event references line {ln} with no verified source anchor")
        check(
            any(lo <= ln <= hi for lo, hi in ranges),
            f"{tag}: event references line {ln} outside the extracted source slices",
        )

    # 8. golden vectors
    if tag in GOLDEN:
        g = GOLDEN[tag]
        check(psi == g["psi"], f"{tag}: GOLDEN psi")
        check([e["v"] for e in d["tables"]["fwd"]] == g["fwd_table"], f"{tag}: GOLDEN forward table")
        check([e["v"] for e in d["tables"]["inv"]] == g["inv_table"], f"{tag}: GOLDEN inverse table")
        check(p["nInv"] == g["nInv"], f"{tag}: GOLDEN nInv")
        check(d["tables"]["omega1Inv"]["v"] == g["omega1Inv"], f"{tag}: GOLDEN omega1Inv")
        c = next(c for c in d["cases"] if c["id"] == "delta1")
        check(c["forward"]["expected"] == g["delta1_forward"], f"{tag}: GOLDEN delta1 forward")
        check(
            [k["array"] for k in c["forward"]["keyframes"]] == g["delta1_keyframes"],
            f"{tag}: GOLDEN delta1 keyframes",
        )

    return {"N": n, "bits": bits, "q": q, "psi": psi, "cases": case_ids, "bytes": path.stat().st_size}


# Placeholders the tour renderer (docs/js/routes/tour.js) knows how to expand.
TOUR_PLACEHOLDERS = {
    "N", "M", "q", "psi", "psiInv", "nInv", "negOne", "logN", "halfN", "NN", "Nm1",
    "totalBf", "cofactor", "firstStride", "secondStride", "bin1", "brev1", "brev1bin", "tw1",
}
# Figure builders the tour renderer implements.
TOUR_FIGURES = {
    "polymul", "wrap", "pipeline", "circle", "psipow", "table", "butterfly",
    "stages", "bitrev", "gs", "roundtrip", "payoff",
}


def verify_tour() -> None:
    """The tour is data, so a typo in it is a shipped bug. Check it like data.

    A misspelled placeholder renders literally as "{{whatever}}" on the page, and
    a misspelled figure id silently renders no figure at all -- neither of which
    shows up in any other check.
    """
    path = DATA / "tour.json"
    check(path.is_file(), "docs/data/tour.json missing")
    if not path.is_file():
        return
    tour = json.loads(path.read_text())
    check(tour.get("schemaVersion") == 1, "tour.json: schemaVersion")
    steps = tour.get("steps", [])
    check(len(steps) >= 8, f"tour.json: only {len(steps)} steps")
    seen_ids = set()
    for i, st in enumerate(steps):
        tag = f"tour step {i} ({st.get('id', '?')})"
        for key in ("id", "title", "body"):
            check(key in st, f"{tag}: missing {key!r}")
        check(st["id"] not in seen_ids, f"{tag}: duplicate id")
        seen_ids.add(st.get("id"))
        check(isinstance(st.get("body"), list) and st["body"], f"{tag}: body must be a non-empty list")
        if "fig" in st:
            check(st["fig"] in TOUR_FIGURES, f"{tag}: unknown figure {st['fig']!r}")
        for text in [st.get("title", "")] + list(st.get("body", [])):
            for name in re.findall(r"\{\{(\w*)\}\}", text):
                check(name in TOUR_PLACEHOLDERS, f"{tag}: unknown placeholder {{{{{name}}}}}")
            # An unclosed or malformed brace pair would render as literal text.
            check("{{" not in re.sub(r"\{\{\w+\}\}", "", text),
                  f"{tag}: malformed placeholder braces in {text[:60]!r}")


def main() -> int:
    if not TRACES.is_dir():
        print("[04] FATAL: no traces; run tools/03_generate.sh first", file=sys.stderr)
        return 1

    anchors = json.loads((SOURCE / "line-anchors.json").read_text())
    ranges = []
    for name in ("forward", "inverse", "precompute"):
        s = json.loads((SOURCE / f"{name}.json").read_text())
        ranges.append((s["startLine"], s["endLine"]))
        # Every displayed line must carry its true upstream number, in order.
        nums = [ln["n"] for ln in s["lines"]]
        check(nums == list(range(s["startLine"], s["endLine"] + 1)), f"source/{name}: line numbering")
    check((SOURCE / "LICENSE-OpenFHE.txt").is_file(), "OpenFHE LICENSE missing from docs/data/source")

    verify_tour()

    files = sorted(TRACES.glob("*.json"))
    n_feasible = sum(1 for v in EXPECTED_MATRIX.values() if v is not None)
    check(
        len(files) == n_feasible,
        f"expected {n_feasible} trace files (one per feasible (N,bits)), found {len(files)}",
    )

    summary = []
    for f in files:
        summary.append(verify_config(f, anchors, ranges))

    # F3: a published error message must not carry the build machine's paths.
    man = json.loads((DATA / "manifest.json").read_text())
    for c in man["configs"]:
        if not c.get("feasible"):
            check("reason" in c, f"config N={c['N']} bits={c['bits']}: no reason given")
            r = c.get("reason", "")
            check(not r.startswith("/") and "/home/" not in r and ".work/" not in r,
                  f"config N={c['N']} bits={c['bits']}: reason leaks a local path: {r[:70]}")
    check(man["openfhe"]["sourceSha256"] == json.loads(
              (SOURCE / "forward.json").read_text())["sourceSha256"],
          "manifest.json and docs/data/source/*.json publish different sourceSha256 values")

    # Feasibility matrix: both the present and the absent cells.
    got = {(s["N"], s["bits"]): s["q"] for s in summary}
    for (n, bits), want in sorted(EXPECTED_MATRIX.items()):
        if want is None:
            check((n, bits) not in got, f"matrix: (N={n}, bits={bits}) should be infeasible but a trace exists")
            check(last_prime(bits, 2 * n) is None, f"matrix: LastPrime({bits},{2*n}) should not exist")
        else:
            check(got.get((n, bits)) == want, f"matrix: (N={n}, bits={bits}) q={got.get((n,bits))}, expected {want}")

    total = sum(s["bytes"] for s in summary)
    print(f"[04] {len(files)} configs, {checks} assertions, {total/1e6:.2f} MB of trace data")
    for s in summary:
        print(f"[04]   N={s['N']:>2} bits={s['bits']:>2} q={s['q']:>4} psi={s['psi']:>3}  {s['bytes']/1024:6.1f} KB")

    if failures:
        print(f"\n[04] {len(failures)} FAILURE(S):", file=sys.stderr)
        for f in failures[:40]:
            print(f"[04]   {f}", file=sys.stderr)
        if len(failures) > 40:
            print(f"[04]   ... and {len(failures)-40} more", file=sys.stderr)
        return 1

    print(f"[04] OK -- all {checks} assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
