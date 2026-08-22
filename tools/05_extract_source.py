#!/usr/bin/env python3
"""Slice the *pristine* OpenFHE source into JSON for the simulator's code panel.

The pristine text comes from `git show HEAD:<path>`, not from the working tree,
because tools/01_patch.py instruments the working tree in place. So this stays
correct however many times the patcher has run.

Every extracted range is located by anchor text and then asserted against the
line numbers the trace hooks were wired to. An upstream change therefore fails
here instead of silently mis-highlighting code for a reader.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OPENFHE = REPO / ".work" / "openfhe"
IMPL_REL = "src/core/include/math/hal/intnat/transformnat-impl.h"
DECL_REL = "src/core/include/math/hal/intnat/transformnat.h"
OUT = REPO / "docs" / "data" / "source"

PRISTINE_SHA256 = "e48274df5c1aac1badadc36eb7656d6c62594d519519b2adb1443d86d158e2a2"

GNUC_IF = "#if defined(__GNUC__) && !defined(__clang__)"

# name -> (anchor, expected_start, expected_end)
EXTRACTS = {
    "forward": (
        "void NumberTheoreticTransformNat<VecType>::ForwardTransformToBitReverseInPlace(const VecType& rootOfUnityTable,\n"
        "                                                                               const VecType& preconRootOfUnityTable,",
        302,
        374,
    ),
    "inverse": (
        "void NumberTheoreticTransformNat<VecType>::InverseTransformFromBitReverseInPlace(\n"
        "    const VecType& rootOfUnityInverseTable, const VecType& preconRootOfUnityInverseTable, const IntType& cycloOrderInv,",
        511,
        625,
    ),
    "precompute": (
        "void ChineseRemainderTransformFTTNat<VecType>::PreCompute(const IntType& rootOfUnity, const uint32_t cycloOrder,",
        713,
        756,
    ),
}

# Regions, keyed by the comment or statement that opens them. Each entry is
# (region-name, anchor-line-substring). `to` is filled by the next region's start.
REGIONS = {
    "forward": [
        ("prologue", "const auto modulus{element->GetModulus()};"),
        ("main", "for (uint32_t m{1}, t{n}, logt{GetMSB(t)}; m < n;"),
        ("peeledLast", "// peeled off last ntt stage for performance"),
    ],
    "inverse": [
        ("prologue", "auto modulus{element->GetModulus()};"),
        ("peeledFirst", "// peeled off first stage for performance"),
        ("inner", "// inner stages"),
        ("peeledLast", "// peeled off final stage to implement optimization"),
        ("scale", "// perform remaining n/2 scalar multiplies by (n inverse)"),
    ],
    "precompute": [("body", "auto ringDim   = (cycloOrder >> 1);")],
}

# Lines that trace events point at, with a substring that must be on that line.
# 04_verify.py re-checks these against the emitted traces.
LINE_ANCHORS = {
    322: "const auto modulus{element->GetModulus()};",
    324: "for (uint32_t m{1}, t{n}, logt{GetMSB(t)}; m < n;",
    326: "auto omega{rootOfUnityTable[i + m]};",
    330: "omegaFactor.ModMulFastConstEq(omega, modulus, preconOmega);",
    352: "for (uint32_t i{0}; i < (n << 1); i += 2) {",
    354: "auto omega{rootOfUnityTable[(i >> 1) + n]};",
    356: "omegaFactor.ModMulFastConstEq(omega, modulus, preconOmega);",
    374: "}",
    535: "uint32_t n(element->GetLength());",
    538: "auto omega1Inv{rootOfUnityInverseTable[1].ModMulFastConst(",
    543: "for (uint32_t i{0}; i < n; i += 2) {",
    544: "auto omega{rootOfUnityInverseTable[(i + n) >> 1]};",
    556: "omegaFactor.ModMulFastConstEq(omega, modulus, preconOmega);",
    569: "for (uint32_t m{n >> 2}, t{2}, logt{2}; m > 1;",
    571: "auto omega{rootOfUnityInverseTable[i + m]};",
    584: "omegaFactor.ModMulFastConstEq(omega, modulus, preconOmega);",
    601: "for (uint32_t j1{0}; j1 < j2; ++j1) {",
    612: "omegaFactor.ModMulFastConstEq(omega1Inv, modulus, preconOmega1Inv);",
    623: "for (uint32_t i = 0; i < j2; ++i)",
    624: "(*element)[i].ModMulFastConstEq(cycloOrderInv, modulus, preconCycloOrderInv);",
    625: "}",
}


def die(msg: str) -> None:
    print(f"[05] FATAL: {msg}", file=sys.stderr)
    sys.exit(1)


def git_show(rel: str) -> str:
    return subprocess.run(
        ["git", "-C", str(OPENFHE), "show", f"HEAD:{rel}"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def classify(lines: list[str]) -> list[str | None]:
    """Tag each line as always-shown (None), 'gcc', 'clang', or 'pp'.

    transformnat-impl.h carries two arithmetically identical formulations of each
    butterfly behind `#if defined(__GNUC__) && !defined(__clang__)`. We build with
    GCC, so the GCC side is what actually executes; the simulator shows that side
    by default and offers the other as a footnote.
    """
    out: list[str | None] = []
    state = None  # None | 'gcc' | 'clang'
    for ln in lines:
        s = ln.strip()
        if s == GNUC_IF:
            state = "gcc"
            out.append("pp")
        elif s == "#else" and state == "gcc":
            state = "clang"
            out.append("pp")
        elif s == "#endif" and state in ("gcc", "clang"):
            state = None
            out.append("pp")
        else:
            out.append(state)
    if state is not None:
        die("unbalanced #if/#else/#endif while classifying")
    return out


def main() -> None:
    if not (OPENFHE / ".git").is_dir():
        die("run tools/00_fetch_openfhe.sh first")

    commit = subprocess.run(
        ["git", "-C", str(OPENFHE), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
    ).stdout.strip()

    impl = git_show(IMPL_REL)
    sha = hashlib.sha256(impl.encode("utf-8")).hexdigest()
    if sha != PRISTINE_SHA256:
        die(f"{IMPL_REL} sha256 {sha} != expected {PRISTINE_SHA256}")

    all_lines = impl.split("\n")
    version = _read_version()

    OUT.mkdir(parents=True, exist_ok=True)
    written = []

    for name, (anchor, want_start, want_end) in EXTRACTS.items():
        idx = impl.find(anchor)
        if idx < 0:
            die(f"anchor for {name!r} not found")
        if impl.find(anchor, idx + 1) >= 0:
            die(f"anchor for {name!r} is not unique")
        # 1-based line of the anchor's first line.
        anchor_line = impl.count("\n", 0, idx) + 1
        # The signature is preceded by `template <typename VecType>`.
        start = anchor_line - 1
        if all_lines[start - 1].strip() != "template <typename VecType>":
            die(f"{name}: line {start} is not the template header")
        end = None
        for i in range(start, len(all_lines)):
            if all_lines[i] == "}":
                end = i + 1
                break
        if end is None:
            die(f"{name}: no closing brace found")
        if (start, end) != (want_start, want_end):
            die(
                f"{name}: located lines {start}-{end}, expected {want_start}-{want_end}. "
                "Upstream moved; update the hook line numbers in tools/01_patch.py too."
            )

        body = all_lines[start - 1 : end]
        variants = classify(body)

        regions = []
        for rname, sub in REGIONS[name]:
            hit = [start + k for k, ln in enumerate(body) if sub in ln]
            if len(hit) != 1:
                die(f"{name}: region anchor {rname!r} matched {len(hit)} lines")
            regions.append({"name": rname, "from": hit[0]})
        for a, b in zip(regions, regions[1:]):
            a["to"] = b["from"] - 1
        regions[-1]["to"] = end

        doc = {
            "name": name,
            "file": IMPL_REL,
            "openfheVersion": version,
            "openfheCommit": commit,
            "sourceSha256": sha,
            "permalink": f"https://github.com/openfheorg/openfhe-development/blob/{commit}/{IMPL_REL}",
            "startLine": start,
            "endLine": end,
            "regions": regions,
            "lines": [
                {"n": start + k, "t": txt, **({"v": v} if v else {})}
                for k, (txt, v) in enumerate(zip(body, variants))
            ],
        }
        path = OUT / f"{name}.json"
        path.write_text(json.dumps(doc, separators=(",", ":")) + "\n", encoding="utf-8")
        written.append((path.name, start, end, len(body)))

    # Verify every line a trace event points at still says what we think it says.
    bad = []
    for n, sub in sorted(LINE_ANCHORS.items()):
        if sub not in all_lines[n - 1]:
            bad.append((n, sub, all_lines[n - 1]))
    if bad:
        for n, sub, got in bad:
            print(f"[05]   line {n}: expected {sub!r}\n[05]        got      {got!r}", file=sys.stderr)
        die("trace line anchors no longer match the source")

    (OUT / "line-anchors.json").write_text(
        json.dumps({str(k): v for k, v in sorted(LINE_ANCHORS.items())}, indent=1) + "\n", encoding="utf-8"
    )

    # Doc comments from transformnat.h: OpenFHE's own pointer to Longa-Naehrig
    # Algorithms 1 and 2. Worth showing verbatim above the code.
    decl = git_show(DECL_REL)
    (OUT / "citations.json").write_text(
        json.dumps(
            {
                "file": DECL_REL,
                "forwardDoc": _doc_for(decl, "void ForwardTransformToBitReverseInPlace(const VecType& rootOfUnityTable, const VecType& preconRootOfUnityTable,"),
                "inverseDoc": _doc_for(decl, "void InverseTransformFromBitReverseInPlace(const VecType& rootOfUnityInverseTable,"),
                "papers": [
                    {
                        "id": "longa-naehrig-2016",
                        "title": "Speeding up the Number Theoretic Transform for Faster Ideal Lattice-Based Cryptography",
                        "authors": "Patrick Longa, Michael Naehrig",
                        "url": "https://eprint.iacr.org/2016/504",
                        "used_for": "Algorithm 1 (forward, Cooley-Tukey) and Algorithm 2 (inverse, Gentleman-Sande), cited by OpenFHE in transformnat.h",
                    },
                    {
                        "id": "harvey-2014",
                        "title": "Faster arithmetic for number-theoretic transforms",
                        "authors": "David Harvey",
                        "url": "https://arxiv.org/abs/1205.2926",
                        "used_for": "Algorithm 2 lines 5-7: the precomputed-multiplicand modular multiplication (Shoup/NTL), cited by OpenFHE in ubintnat.h",
                    },
                    {
                        "id": "openfhe-872",
                        "title": "Fold the 1/N scaling into the inverse transform's final stage",
                        "authors": "OpenFHE issue #872",
                        "url": "https://github.com/openfheorg/openfhe-development/issues/872",
                        "used_for": "Why the inverse transform's last twiddle is psi^-(N/2) * N^-1 rather than a plain power of psi^-1",
                    },
                ],
            },
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )

    lic = OPENFHE / "LICENSE"
    if lic.is_file():
        shutil.copy2(lic, OUT / "LICENSE-OpenFHE.txt")
    else:
        die("OpenFHE LICENSE not found; the excerpts may not be redistributed without it")

    for nm, s, e, cnt in written:
        print(f"[05] {nm}: lines {s}-{e} ({cnt} lines)")
    print(f"[05] verified {len(LINE_ANCHORS)} trace line anchors")
    print("[05] OK")


def _doc_for(text: str, decl_sub: str) -> str:
    """Return the /** ... */ block immediately preceding a declaration."""
    i = text.find(decl_sub)
    if i < 0:
        return ""
    head = text[:i]
    start = head.rfind("/**")
    stop = head.rfind("*/")
    if start < 0 or stop < start:
        return ""
    return text[start : stop + 2]


def _read_version() -> str:
    cm = git_show("CMakeLists.txt")
    parts = {}
    for key in ("MAJOR", "MINOR", "PATCH"):
        tag = f"set(OPENFHE_VERSION_{key} "
        j = cm.find(tag)
        if j < 0:
            die("could not read OPENFHE_VERSION from CMakeLists.txt")
        parts[key] = cm[j + len(tag) : cm.find(")", j)].strip()
    return f"{parts['MAJOR']}.{parts['MINOR']}.{parts['PATCH']}"


if __name__ == "__main__":
    main()
