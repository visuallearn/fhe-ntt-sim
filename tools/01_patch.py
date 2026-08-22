#!/usr/bin/env python3
"""Install trace instrumentation into the pinned OpenFHE checkout.

Anchored text insertion, not a context diff: every anchor must appear exactly
once or the script aborts. That makes an upstream version bump a loud failure
instead of a silently misplaced hook.

Every insertion is a pure observer:
  * it only reads element[], omega, precon values that already exist;
  * it never introduces a name the original code reads;
  * it never reorders an original statement;
  * it is wrapped in #ifdef OPENFHE_NTT_TRACE, so a build without that define
    is textually equivalent to pristine upstream.

Line numbers passed to the hooks are *upstream* line numbers (in the pristine
file), passed explicitly rather than via __LINE__, because instrumentation
shifts the lines but the simulator displays the original file.
"""
from __future__ import annotations

import hashlib
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OPENFHE = REPO / ".work" / "openfhe"
IMPL_REL = "src/core/include/math/hal/intnat/transformnat-impl.h"
IMPL = OPENFHE / IMPL_REL
HOOK_DST = OPENFHE / "src/core/include/math/hal/intnat/ntt-trace.h"
GEN_DST = OPENFHE / "src/core/examples/ntt_trace_gen.cpp"
# The generator and the standalone experiments in openfhe-gt-exp/ share one
# definition of the input cases and the oracles. Copy that header in beside it.
CASES_SRC = REPO / "openfhe-gt-exp" / "include" / "ntt_gt_cases.h"
CASES_DST = OPENFHE / "src/core/examples/ntt_gt_cases.h"

# sha256 of transformnat-impl.h at tag v1.5.1 (commit 1306d14f8c26...).
PRISTINE_SHA256 = "e48274df5c1aac1badadc36eb7656d6c62594d519519b2adb1443d86d158e2a2"
MARKER = "OPENFHE_NTT_TRACE"

EDITS: list[tuple[str, str, str]] = []


def edit(name: str, find: str, repl: str) -> None:
    EDITS.append((name, find, repl))


# --------------------------------------------------------------------------
# 0. Pull in the hook header.
# --------------------------------------------------------------------------
edit(
    "include-hook-header",
    '#include "math/hal/intnat/transformnat.h"\n'
    '#include "math/nbtheory.h"\n',
    '#include "math/hal/intnat/transformnat.h"\n'
    '#include "math/hal/intnat/ntt-trace.h"\n'
    '#include "math/nbtheory.h"\n',
)

# --------------------------------------------------------------------------
# FORWARD: ForwardTransformToBitReverseInPlace(table, precon, element)
# upstream lines 302-374. Cooley-Tukey, Longa-Naehrig Alg. 1.
# --------------------------------------------------------------------------
edit(
    "fwd-begin-stage-twiddle-capture",
    """    const auto modulus{element->GetModulus()};
    const uint32_t n(element->GetLength() >> 1);
    for (uint32_t m{1}, t{n}, logt{GetMSB(t)}; m < n; m <<= 1, t >>= 1, --logt) {
        for (uint32_t i{0}; i < m; ++i) {
            auto omega{rootOfUnityTable[i + m]};
            auto preconOmega{preconRootOfUnityTable[i + m]};
            for (uint32_t j1{i << logt}, j2{j1 + t}; j1 < j2; ++j1) {
                auto omegaFactor{(*element)[j1 + t]};
""",
    """    const auto modulus{element->GetModulus()};
    const uint32_t n(element->GetLength() >> 1);
#ifdef OPENFHE_NTT_TRACE
    NTTTR_EMIT(begin(::ntttrace::DIR_FORWARD, element->GetLength(), ::ntttrace::u64(modulus), 322u));
#endif
    for (uint32_t m{1}, t{n}, logt{GetMSB(t)}; m < n; m <<= 1, t >>= 1, --logt) {
#ifdef OPENFHE_NTT_TRACE
        NTTTR_EMIT(stage(::ntttrace::REGION_MAIN, m, t, logt, 324u));
#endif
        for (uint32_t i{0}; i < m; ++i) {
            auto omega{rootOfUnityTable[i + m]};
            auto preconOmega{preconRootOfUnityTable[i + m]};
#ifdef OPENFHE_NTT_TRACE
            NTTTR_EMIT(twiddle(::ntttrace::TW_TABLE, i + m, ::ntttrace::u64(omega),
                               ::ntttrace::u64(preconOmega), 326u));
#endif
            for (uint32_t j1{i << logt}, j2{j1 + t}; j1 < j2; ++j1) {
#ifdef OPENFHE_NTT_TRACE
                const uint64_t _ntt_u = ::ntttrace::u64((*element)[j1 + 0]);
                const uint64_t _ntt_v = ::ntttrace::u64((*element)[j1 + t]);
#endif
                auto omegaFactor{(*element)[j1 + t]};
""",
)

edit(
    "fwd-mainloop-emit-and-peeled-header",
    """                (*element)[j1 + t] = loVal - omegaFactor;
#endif
            }
        }
    }
    // peeled off last ntt stage for performance
    for (uint32_t i{0}; i < (n << 1); i += 2) {
        auto omegaFactor{(*element)[i + 1]};
        auto omega{rootOfUnityTable[(i >> 1) + n]};
        auto preconOmega{preconRootOfUnityTable[(i >> 1) + n]};
        omegaFactor.ModMulFastConstEq(omega, modulus, preconOmega);
""",
    """                (*element)[j1 + t] = loVal - omegaFactor;
#endif
#ifdef OPENFHE_NTT_TRACE
                NTTTR_EMIT(bflyCT(j1, j1 + t, _ntt_u, _ntt_v, ::ntttrace::u64((*element)[j1 + 0]),
                                  ::ntttrace::u64((*element)[j1 + t]), 330u));
#endif
            }
        }
    }
    // peeled off last ntt stage for performance
#ifdef OPENFHE_NTT_TRACE
    NTTTR_EMIT(stage(::ntttrace::REGION_PEELED_LAST, n, 1u, 1u, 352u));
#endif
    for (uint32_t i{0}; i < (n << 1); i += 2) {
#ifdef OPENFHE_NTT_TRACE
        const uint64_t _ntt_u = ::ntttrace::u64((*element)[i + 0]);
        const uint64_t _ntt_v = ::ntttrace::u64((*element)[i + 1]);
#endif
        auto omegaFactor{(*element)[i + 1]};
        auto omega{rootOfUnityTable[(i >> 1) + n]};
        auto preconOmega{preconRootOfUnityTable[(i >> 1) + n]};
#ifdef OPENFHE_NTT_TRACE
        NTTTR_EMIT(twiddle(::ntttrace::TW_TABLE, (i >> 1) + n, ::ntttrace::u64(omega),
                           ::ntttrace::u64(preconOmega), 354u));
#endif
        omegaFactor.ModMulFastConstEq(omega, modulus, preconOmega);
""",
)

edit(
    "fwd-peeled-emit-and-end",
    """        (*element)[i + 1] = loVal - omegaFactor;
#endif
    }
}
""",
    """        (*element)[i + 1] = loVal - omegaFactor;
#endif
#ifdef OPENFHE_NTT_TRACE
        NTTTR_EMIT(bflyCT(i, i + 1, _ntt_u, _ntt_v, ::ntttrace::u64((*element)[i + 0]),
                          ::ntttrace::u64((*element)[i + 1]), 356u));
#endif
    }
#ifdef OPENFHE_NTT_TRACE
    NTTTR_EMIT(end(374u));
#endif
}
""",
)

# --------------------------------------------------------------------------
# INVERSE: InverseTransformFromBitReverseInPlace(tableI, preconI, nInv, ...)
# upstream lines 511-625. Gentleman-Sande, Longa-Naehrig Alg. 2.
# --------------------------------------------------------------------------
edit(
    "inv-begin-peeled-first",
    """    auto modulus{element->GetModulus()};
    uint32_t n(element->GetLength());

    // precomputed omega[bitreversed(1)] * (n inverse). used in final stage of intt.
    auto omega1Inv{rootOfUnityInverseTable[1].ModMulFastConst(cycloOrderInv, modulus, preconCycloOrderInv)};
    auto preconOmega1Inv{omega1Inv.PrepModMulConst(modulus)};

    if (n > 2) {
        // peeled off first stage for performance
        for (uint32_t i{0}; i < n; i += 2) {
            auto omega{rootOfUnityInverseTable[(i + n) >> 1]};
            auto preconOmega{preconRootOfUnityInverseTable[(i + n) >> 1]};
            auto loVal{(*element)[i + 0]};
            auto hiVal{(*element)[i + 1]};
""",
    """    auto modulus{element->GetModulus()};
    uint32_t n(element->GetLength());
#ifdef OPENFHE_NTT_TRACE
    NTTTR_EMIT(begin(::ntttrace::DIR_INVERSE, n, ::ntttrace::u64(modulus), 535u));
#endif

    // precomputed omega[bitreversed(1)] * (n inverse). used in final stage of intt.
    auto omega1Inv{rootOfUnityInverseTable[1].ModMulFastConst(cycloOrderInv, modulus, preconCycloOrderInv)};
    auto preconOmega1Inv{omega1Inv.PrepModMulConst(modulus)};

    if (n > 2) {
        // peeled off first stage for performance
#ifdef OPENFHE_NTT_TRACE
        NTTTR_EMIT(stage(::ntttrace::REGION_PEELED_FIRST, n >> 1, 1u, 1u, 543u));
#endif
        for (uint32_t i{0}; i < n; i += 2) {
            auto omega{rootOfUnityInverseTable[(i + n) >> 1]};
            auto preconOmega{preconRootOfUnityInverseTable[(i + n) >> 1]};
#ifdef OPENFHE_NTT_TRACE
            NTTTR_EMIT(twiddle(::ntttrace::TW_TABLE, (i + n) >> 1, ::ntttrace::u64(omega),
                               ::ntttrace::u64(preconOmega), 544u));
#endif
            auto loVal{(*element)[i + 0]};
            auto hiVal{(*element)[i + 1]};
#ifdef OPENFHE_NTT_TRACE
            const uint64_t _ntt_u = ::ntttrace::u64(loVal);
            const uint64_t _ntt_v = ::ntttrace::u64(hiVal);
#endif
""",
)

edit(
    "inv-peeled-first-emit-and-inner-header",
    """            (*element)[i + 1] = omegaFactor;
#endif
        }
    }
    // inner stages
    for (uint32_t m{n >> 2}, t{2}, logt{2}; m > 1; m >>= 1, t <<= 1, ++logt) {
        for (uint32_t i{0}; i < m; ++i) {
            auto omega{rootOfUnityInverseTable[i + m]};
            auto preconOmega{preconRootOfUnityInverseTable[i + m]};
            for (uint32_t j1{i << logt}, j2{j1 + t}; j1 < j2; ++j1) {
                auto loVal{(*element)[j1 + 0]};
                auto hiVal{(*element)[j1 + t]};
""",
    """            (*element)[i + 1] = omegaFactor;
#endif
#ifdef OPENFHE_NTT_TRACE
            NTTTR_EMIT(bflyGS(i, i + 1, _ntt_u, _ntt_v, ::ntttrace::u64((*element)[i + 0]),
                              ::ntttrace::u64((*element)[i + 1]), 556u));
#endif
        }
    }
    // inner stages
    for (uint32_t m{n >> 2}, t{2}, logt{2}; m > 1; m >>= 1, t <<= 1, ++logt) {
#ifdef OPENFHE_NTT_TRACE
        NTTTR_EMIT(stage(::ntttrace::REGION_INNER, m, t, logt, 569u));
#endif
        for (uint32_t i{0}; i < m; ++i) {
            auto omega{rootOfUnityInverseTable[i + m]};
            auto preconOmega{preconRootOfUnityInverseTable[i + m]};
#ifdef OPENFHE_NTT_TRACE
            NTTTR_EMIT(twiddle(::ntttrace::TW_TABLE, i + m, ::ntttrace::u64(omega),
                               ::ntttrace::u64(preconOmega), 571u));
#endif
            for (uint32_t j1{i << logt}, j2{j1 + t}; j1 < j2; ++j1) {
                auto loVal{(*element)[j1 + 0]};
                auto hiVal{(*element)[j1 + t]};
#ifdef OPENFHE_NTT_TRACE
                const uint64_t _ntt_u = ::ntttrace::u64(loVal);
                const uint64_t _ntt_v = ::ntttrace::u64(hiVal);
#endif
""",
)

edit(
    "inv-inner-emit-and-final-header",
    """                (*element)[j1 + t] = omegaFactor;
#endif
            }
        }
    }

    // peeled off final stage to implement optimization where n/2 scalar multiplies
    // by (n inverse) are incorporated into the omegaFactor calculation.
    // Please see https://github.com/openfheorg/openfhe-development/issues/872 for details.
    uint32_t j2{n >> 1};
    for (uint32_t j1{0}; j1 < j2; ++j1) {
        auto loVal{(*element)[j1]};
        auto hiVal{(*element)[j1 + j2]};
""",
    """                (*element)[j1 + t] = omegaFactor;
#endif
#ifdef OPENFHE_NTT_TRACE
                NTTTR_EMIT(bflyGS(j1, j1 + t, _ntt_u, _ntt_v, ::ntttrace::u64((*element)[j1 + 0]),
                                  ::ntttrace::u64((*element)[j1 + t]), 584u));
#endif
            }
        }
    }

    // peeled off final stage to implement optimization where n/2 scalar multiplies
    // by (n inverse) are incorporated into the omegaFactor calculation.
    // Please see https://github.com/openfheorg/openfhe-development/issues/872 for details.
    uint32_t j2{n >> 1};
#ifdef OPENFHE_NTT_TRACE
    NTTTR_EMIT(stage(::ntttrace::REGION_PEELED_LAST, 1u, j2, GetMSB(j2), 601u));
    NTTTR_EMIT(twiddle(::ntttrace::TW_FUSED, 1u, ::ntttrace::u64(omega1Inv),
                       ::ntttrace::u64(preconOmega1Inv), 538u));
#endif
    for (uint32_t j1{0}; j1 < j2; ++j1) {
        auto loVal{(*element)[j1]};
        auto hiVal{(*element)[j1 + j2]};
#ifdef OPENFHE_NTT_TRACE
        const uint64_t _ntt_u = ::ntttrace::u64(loVal);
        const uint64_t _ntt_v = ::ntttrace::u64(hiVal);
#endif
""",
)

edit(
    "inv-final-emit-scale-and-end",
    """        (*element)[j1 + j2] = omegaFactor;
#endif
    }
    // perform remaining n/2 scalar multiplies by (n inverse)
    for (uint32_t i = 0; i < j2; ++i)
        (*element)[i].ModMulFastConstEq(cycloOrderInv, modulus, preconCycloOrderInv);
}
""",
    """        (*element)[j1 + j2] = omegaFactor;
#endif
#ifdef OPENFHE_NTT_TRACE
        NTTTR_EMIT(bflyGS(j1, j1 + j2, _ntt_u, _ntt_v, ::ntttrace::u64((*element)[j1]),
                          ::ntttrace::u64((*element)[j1 + j2]), 612u));
#endif
    }
    // perform remaining n/2 scalar multiplies by (n inverse)
#ifdef OPENFHE_NTT_TRACE
    NTTTR_EMIT(stage(::ntttrace::REGION_SCALE, 0u, 0u, 0u, 623u));
    for (uint32_t i = 0; i < j2; ++i) {
        const uint64_t _ntt_in = ::ntttrace::u64((*element)[i]);
        (*element)[i].ModMulFastConstEq(cycloOrderInv, modulus, preconCycloOrderInv);
        NTTTR_EMIT(scale(i, _ntt_in, ::ntttrace::u64(cycloOrderInv), ::ntttrace::u64((*element)[i]), 624u));
    }
    NTTTR_EMIT(end(625u));
#else
    for (uint32_t i = 0; i < j2; ++i)
        (*element)[i].ModMulFastConstEq(cycloOrderInv, modulus, preconCycloOrderInv);
#endif
}
""",
)


def die(msg: str) -> None:
    print(f"[01] FATAL: {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    if not IMPL.is_file():
        die(f"{IMPL} not found. Run tools/00_fetch_openfhe.sh first.")

    text = IMPL.read_text(encoding="utf-8")

    if MARKER in text:
        print("[01] transformnat-impl.h is already instrumented; nothing to do.")
        _install_aux()
        return

    got = hashlib.sha256(text.encode("utf-8")).hexdigest()
    if got != PRISTINE_SHA256:
        die(
            f"{IMPL_REL} sha256 mismatch.\n"
            f"       expected {PRISTINE_SHA256}\n"
            f"       got      {got}\n"
            "       The upstream file changed. Re-read it and update the anchors "
            "and the upstream line numbers in this script before proceeding."
        )

    for name, find, repl in EDITS:
        count = text.count(find)
        if count != 1:
            die(f"anchor {name!r} matched {count} times (expected exactly 1)")
        text = text.replace(find, repl, 1)
        print(f"[01] applied {name}")

    IMPL.write_text(text, encoding="utf-8")
    print(f"[01] wrote {IMPL_REL} ({len(text.splitlines())} lines)")
    _install_aux()


def _install_aux() -> None:
    src_dir = Path(__file__).resolve().parent / "openfhe-src"
    shutil.copy2(src_dir / "ntt-trace.h", HOOK_DST)
    print(f"[01] installed {HOOK_DST.relative_to(OPENFHE)}")
    if not CASES_SRC.is_file():
        die(f"{CASES_SRC} missing: the generator needs the shared cases header")
    shutil.copy2(CASES_SRC, CASES_DST)
    print(f"[01] installed {CASES_DST.relative_to(OPENFHE)}")
    gen = src_dir / "ntt_trace_gen.cpp"
    if gen.is_file():
        shutil.copy2(gen, GEN_DST)
        print(f"[01] installed {GEN_DST.relative_to(OPENFHE)}")
    else:
        print("[01] note: ntt_trace_gen.cpp not present yet; skipping")


if __name__ == "__main__":
    main()
