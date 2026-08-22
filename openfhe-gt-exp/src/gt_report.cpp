//==================================================================================
// The experiment itself.
//
// It calls OpenFHE for every value it prints. Nothing is recomputed for the
// report except the independent oracles, which exist to disagree with OpenFHE if
// anything is wrong.
//==================================================================================

#include "gt_report.h"
#include "ntt_gt_cases.h"

#include "openfhecore.h"

#include <exception>
#include <iomanip>
#include <sstream>

using namespace lbcrypto;

namespace nttgt {
namespace {

std::string vec(const std::vector<u64>& v) {
    std::ostringstream o;
    o << "[ ";
    for (size_t i = 0; i < v.size(); ++i)
        o << (i ? ", " : "") << v[i];
    o << " ]";
    return o.str();
}

std::string joined(const std::vector<u64>& v) {
    std::ostringstream o;
    for (size_t i = 0; i < v.size(); ++i)
        o << (i ? " " : "") << v[i];
    return o.str();
}

std::string bin(u32 x, u32 bits) {
    std::string s(bits, '0');
    for (u32 i = 0; i < bits; ++i)
        if ((x >> i) & 1u)
            s[bits - 1 - i] = '1';
    return s;
}

/// Wrap prose to `width` columns with a fixed indent, so a report stays readable
/// in a terminal and diffs stay narrow.
std::string wrap(const std::string& text, const std::string& indent, size_t width = 78) {
    std::ostringstream o;
    size_t col = 0;
    std::istringstream in(text);
    std::string w;
    while (in >> w) {
        if (col == 0) {
            o << indent << w;
            col = indent.size() + w.size();
        }
        else if (col + 1 + w.size() > width) {
            o << "\n" << indent << w;
            col = indent.size() + w.size();
        }
        else {
            o << ' ' << w;
            col += 1 + w.size();
        }
    }
    o << "\n";
    return o.str();
}

/// "  label                       value   comment"  with the columns lined up.
std::string kv(const std::string& label, const std::string& value, const std::string& note = "") {
    std::ostringstream o;
    o << "  " << std::left << std::setw(25) << label << std::right << std::setw(12) << value;
    if (!note.empty())
        o << "   " << note;
    o << "\n";
    return o.str();
}

/// "    claim                                          OK"
std::string claim(const std::string& text, const char* verdict, const char* indent = "    ") {
    std::ostringstream o;
    const size_t pad = 52 - std::string(indent).size();
    // setw does not truncate, so a claim longer than the pad would otherwise run
    // straight into its verdict with no separator.
    o << indent << std::left << std::setw(static_cast<int>(pad)) << text;
    if (text.size() >= pad)
        o << "  ";
    o << verdict << "\n";
    return o.str();
}

std::vector<u64> toVec(const NativeVector& v) {
    std::vector<u64> r(v.GetLength());
    for (size_t i = 0; i < r.size(); ++i)
        r[i] = v[i].ConvertToInt();
    return r;
}

NativeVector toNative(const std::vector<u64>& a, const NativeInteger& q) {
    NativeVector v(static_cast<usint>(a.size()), q);
    for (size_t i = 0; i < a.size(); ++i)
        v[i] = NativeInteger(a[i]);
    return v;
}

/// Accumulates pass/fail so the report can state a verdict at the end.
struct Checker {
    std::ostream& out;
    unsigned checks = 0;
    unsigned failures = 0;

    explicit Checker(std::ostream& o) : out(o) {}

    /// Print "MATCH" or a failure line. Returns the condition.
    bool say(bool ok, const std::string& what) {
        ++checks;
        if (!ok) {
            ++failures;
            out << "      *** FAILED: " << what << "\n";
        }
        return ok;
    }
    const char* mark(bool ok) {
        ++checks;
        if (!ok)
            ++failures;
        return ok ? "MATCH" : "*** MISMATCH ***";
    }
    const char* okmark(bool ok) {
        ++checks;
        if (!ok)
            ++failures;
        return ok ? "OK" : "*** WRONG ***";
    }
};

}  // namespace

void writeBuildHeader(std::ostream& out) {
    out << "OpenFHE version        : " << GetOPENFHEVersion() << "\n"
        << "MATHBACKEND            : " << MATHBACKEND << "\n"
        << "NATIVEINT              : " << NATIVEINT << "\n"
        << "MAX_MODULUS_SIZE       : " << MAX_MODULUS_SIZE << "\n"
        << "Compiler               : " << __VERSION__ << "\n"
        << "Values come from       : ChineseRemainderTransformFTT<NativeVector>\n"
        << "                         ::ForwardTransformToBitReverseInPlace\n"
        << "                         ::InverseTransformFromBitReverseInPlace\n"
        << "                         (the functions NativePoly::SwitchFormat calls)\n";
}

ExpResult runExperiment(uint32_t N, uint32_t bits, std::ostream& out,
                        std::vector<std::string>* digest) {
    ExpResult R;
    R.N = N;
    R.bits = bits;
    R.M = 2 * N;
    const u32 brevBits = log2u(N);

    NativeInteger q, psi;
    try {
        // The real OpenFHE parameter path: LastPrime, then RootOfUnity.
        auto params = std::make_shared<ILNativeParams>(R.M, bits);
        q = params->GetModulus();
        psi = params->GetRootOfUnity();
    }
    catch (const std::exception& e) {
        R.feasible = false;
        R.reason = trimSourcePath(e.what());
        out << "N = " << N << ", " << bits << "-bit modulus: NOT POSSIBLE\n"
            << "  OpenFHE rejected these parameters:\n    " << R.reason << "\n"
            << "  No prime of exactly " << bits << " bits is congruent to 1 modulo "
            << R.M << ".\n  A root of unity of order " << R.M
            << " therefore does not exist, and this transform is not possible.\n";
        return R;
    }

    R.feasible = true;
    R.q = q.ConvertToInt();
    R.psi = psi.ConvertToInt();
    const u64 qi = R.q, psii = R.psi;
    const u64 psiInv = modInv(psii, qi);
    const u64 nInv = modInv(N % qi, qi);
    R.name = "n" + std::to_string(N) + "-b" + std::to_string(bits) + "-q" + std::to_string(qi);

    Checker ck(out);
    auto dig = [&](const std::string& key, const std::string& value) {
        if (digest)
            digest->push_back(R.name + "\t" + key + "\t" + value);
    };

    // Fresh tables. PreCompute caches by modulus in static maps and several q
    // values repeat across N, so this reset is load-bearing.
    ChineseRemainderTransformFTT<NativeVector>().Reset();
    ChineseRemainderTransformFTT<NativeVector>().PreCompute(psi, R.M, q);

    const auto& fwdT = ChineseRemainderTransformFTT<NativeVector>::m_rootOfUnityReverseTableByModulus[q];
    const auto& fwdP = ChineseRemainderTransformFTT<NativeVector>::m_rootOfUnityPreconReverseTableByModulus[q];
    const auto& invT = ChineseRemainderTransformFTT<NativeVector>::m_rootOfUnityInverseReverseTableByModulus[q];
    const auto& invP =
        ChineseRemainderTransformFTT<NativeVector>::m_rootOfUnityInversePreconReverseTableByModulus[q];
    const auto& coiT = ChineseRemainderTransformFTT<NativeVector>::m_cycloOrderInverseTableByModulus[q];
    const auto& coiP = ChineseRemainderTransformFTT<NativeVector>::m_cycloOrderInversePreconTableByModulus[q];

    // ---------------------------------------------------------------- header
    out << "================================================================================\n"
        << "EXPERIMENT  " << R.name << "\n"
        << "================================================================================\n\n";

    // ------------------------------------------------------------ parameters
    out << "PARAMETERS\n"
        << kv("ring", "Z_" + std::to_string(qi) + "[X] / (X^" + std::to_string(N) + " + 1)")
        << kv("N   ring dimension", std::to_string(N))
        << kv("M   cyclotomic order", std::to_string(R.M), "= 2N")
        << kv("modulus bit size", std::to_string(bits))
        << kv("q   modulus", std::to_string(qi),
              "LastPrime<NativeInteger>(" + std::to_string(bits) + ", " + std::to_string(R.M) + ")")
        << kv("psi 2N-th root of unity", std::to_string(psii),
              "RootOfUnity<NativeInteger>(" + std::to_string(R.M) + ", " + std::to_string(qi) + ")")
        << kv("psi^-1", std::to_string(psiInv))
        << kv("omega = psi^2", std::to_string(modMul(psii, psii, qi)), "an N-th root of unity")
        << kv("N^-1 mod q", std::to_string(nInv))
        << kv("bit-reversal width", std::to_string(brevBits), "= log2(N)")
        << kv("Barrett mu", std::to_string(q.ComputeMu().ConvertToInt()), "from q.ComputeMu()")
        << "\n  checks on the parameters\n"
        << claim("(q-1) mod M = " + std::to_string((qi - 1) % R.M),
                 ck.okmark((qi - 1) % R.M == 0))
        << claim("psi^N mod q = " + std::to_string(modPow(psii, N, qi)) + ", and q-1 = " +
                     std::to_string(qi - 1),
                 ck.okmark(modPow(psii, N, qi) == qi - 1))
        << claim("psi^M mod q = " + std::to_string(modPow(psii, R.M, qi)),
                 ck.okmark(modPow(psii, R.M, qi) == 1))
        << claim("psi * psi^-1 mod q = " + std::to_string(modMul(psii, psiInv, qi)),
                 ck.okmark(modMul(psii, psiInv, qi) == 1))
        << claim("N * N^-1 mod q = " + std::to_string(modMul(N % qi, nInv, qi)),
                 ck.okmark(modMul(N % qi, nInv, qi) == 1))
        << claim("Barrett mu recomputed independently",
                 ck.okmark(q.ComputeMu().ConvertToInt() == barrettMu(qi)))
        << "\n";

    dig("params", "N=" + std::to_string(N) + " M=" + std::to_string(R.M) + " bits=" +
                      std::to_string(bits) + " q=" + std::to_string(qi) + " psi=" +
                      std::to_string(psii) + " psiInv=" + std::to_string(psiInv) + " nInv=" +
                      std::to_string(nInv) + " brevBits=" + std::to_string(brevBits));

    // ------------------------------------------------------- twiddle tables
    auto table = [&](const char* title, const char* member, const NativeVector& t,
                     const NativeVector& p, bool inverse) {
        out << title << "\n  " << member << "\n\n"
            << "    slot   bin(slot)   brev(slot)   power          value   "
               "Shoup precon floor(w*2^64/q)\n";
        std::vector<u64> vals;
        for (u32 j = 0; j < N; ++j) {
            const u32 e = brev(j, brevBits);
            const u64 v = t[j].ConvertToInt();
            vals.push_back(v);
            const u64 want = modPow(inverse ? psiInv : psii, e, qi);
            out << "    " << std::setw(4) << j << "   " << std::setw(9) << bin(j, brevBits)
                << "   " << std::setw(10) << bin(e, brevBits) << "   " << std::left
                << std::setw(8) << (std::string(inverse ? "psi^-" : "psi^") + std::to_string(e))
                << std::right << std::setw(11) << v << "   " << std::setw(22)
                << p[j].ConvertToInt();
            if (v != want)
                out << "   *** expected " << want << " ***";
            ck.say(v == want, "table entry");
            ck.say(p[j].ConvertToInt() == shoupPrecon(v, qi), "Shoup precon");
            out << "\n";
        }
        out << "\n";
        return vals;
    };

    const std::vector<u64> fwdVals =
        table("FORWARD TWIDDLE TABLE", "m_rootOfUnityReverseTableByModulus[q]", fwdT, fwdP, false);
    dig("fwd-table", joined(fwdVals));
    const std::vector<u64> invVals = table("INVERSE TWIDDLE TABLE",
                                           "m_rootOfUnityInverseReverseTableByModulus[q]", invT, invP, true);
    dig("inv-table", joined(invVals));

    out << "  Slot 0 holds psi^0 = 1. The forward transform never reads it: its loops\n"
        << "  index the table from 1 upward.\n\n";

    out << "CYCLOTOMIC-ORDER INVERSE TABLE\n"
        << "  m_cycloOrderInverseTableByModulus[q]\n\n"
        << "    index   (2^index)^-1 mod q   Shoup precon\n";
    std::vector<u64> coiVals;
    for (usint i = 0; i < coiT.GetLength(); ++i) {
        const u64 v = coiT[i].ConvertToInt();
        coiVals.push_back(v);
        out << "    " << std::setw(5) << i << "   " << std::setw(17) << v << "   " << std::setw(22)
            << coiP[i].ConvertToInt() << "\n";
        ck.say(modMul(v, modPow(2, i, qi), qi) == 1, "cycloOrderInverse entry");
    }
    dig("coi-table", joined(coiVals));
    out << "\n"
        << claim("the inverse transform reads index " + std::to_string(brevBits) +
                     ", which is N^-1 = " + std::to_string(nInv),
                 ck.okmark(coiT[brevBits].ConvertToInt() == nInv))
        << "\n";

    const u64 omega1Inv = modMul(invVals[1], nInv, qi);
    out << "FUSED FINAL TWIDDLE OF THE INVERSE TRANSFORM\n"
        << "  omega1Inv = TableI[1] * N^-1 = " << invVals[1] << " * " << nInv << " mod " << qi
        << " = " << omega1Inv << "\n"
        << "  which is psi^-(N/2) * N^-1 = " << modPow(psiInv, N / 2, qi) << " * " << nInv << " = "
        << omega1Inv << "   "
        << ck.okmark(modMul(modPow(psiInv, N / 2, qi), nInv, qi) == omega1Inv) << "\n"
        << "  OpenFHE puts the division by N into this twiddle for the upper half of the\n"
        << "  array, then multiplies only the lower half by N^-1. See OpenFHE issue 872.\n\n";
    dig("omega1Inv", std::to_string(omega1Inv));

    // ---------------------------------------- which twiddles each stage uses
    auto stageList = [&](bool forward) {
        out << (forward ? "TWIDDLE FACTORS USED BY EACH STAGE, FORWARD\n"
                        : "TWIDDLE FACTORS USED BY EACH STAGE, INVERSE\n");
        const u32 stages = log2u(N);
        for (u32 s = 1; s <= stages; ++s) {
            // Forward: m doubles from 1. Inverse: m halves from N/2. Either way a
            // stage reads table slots m .. 2m-1.
            const u32 m = forward ? (1u << (s - 1)) : (N >> s);
            const u32 t = forward ? (N >> s) : (1u << (s - 1));
            out << "  stage " << s << "   m = " << std::setw(3) << m << "   stride t = "
                << std::setw(3) << t << "   slots " << m << ".." << (2 * m - 1) << "   twiddles ";
            for (u32 i = 0; i < m; ++i)
                out << (i ? ", " : "") << (forward ? fwdVals : invVals)[m + i];
            if (!forward && s == stages)
                out << "   (used as omega1Inv = " << omega1Inv << ")";
            out << "\n";
        }
        out << "\n";
    };
    stageList(true);
    stageList(false);

    // ------------------------------------------------------ evaluation points
    out << "EVALUATION POINTS\n"
        << "  The forward transform leaves slot p holding a(psi^(2*brev(p)+1)).\n\n"
        << "    slot p   brev(p)   exponent   point = psi^exponent mod q\n";
    for (u32 p = 0; p < N; ++p) {
        const u64 e = 2ull * brev(p, brevBits) + 1ull;
        out << "    " << std::setw(6) << p << "   " << std::setw(7) << brev(p, brevBits) << "   "
            << std::setw(8) << e << "   " << std::setw(26) << modPow(psii, e, qi) << "\n";
    }
    out << "\n";

    // --------------------------------------------------------------- cases
    for (const Case& c : makeCases(N, qi, bits)) {
        out << "--------------------------------------------------------------------------------\n"
            << "CASE " << c.id << "   " << c.label << "\n"
            << wrap(c.note, "  ") << "\n";

        NativeVector vfwd = toNative(c.a, q);
        ChineseRemainderTransformFTT<NativeVector>().ForwardTransformToBitReverseInPlace(psi, R.M, &vfwd);
        const std::vector<u64> ahat = toVec(vfwd);

        NativeVector vinv = toNative(ahat, q);
        ChineseRemainderTransformFTT<NativeVector>().InverseTransformFromBitReverseInPlace(psi, R.M, &vinv);
        const std::vector<u64> back = toVec(vinv);

        const std::vector<u64> oF = oracleForward(c.a, qi, psii, brevBits);
        const std::vector<u64> oI = oracleInverse(ahat, qi, psii, brevBits);

        out << "  input, coefficient form   " << vec(c.a) << "\n"
            << "  forward NTT output        " << vec(ahat) << "\n"
            << "    independent O(N^2)      " << vec(oF) << "   " << ck.mark(oF == ahat) << "\n"
            << "  inverse NTT output        " << vec(back) << "\n"
            << "    independent O(N^2)      " << vec(oI) << "   " << ck.mark(oI == back) << "\n"
            << claim("round trip equals the input", ck.okmark(back == c.a), "  ");

        // Prove this is the path NativePoly uses, not a lookalike.
        auto params = std::make_shared<ILNativeParams>(R.M, bits);
        NativePoly poly(params, Format::COEFFICIENT, true);
        for (u32 i = 0; i < N; ++i)
            poly[i] = NativeInteger(c.a[i]);
        poly.SwitchFormat();
        std::vector<u64> viaPoly(N, 0);
        for (u32 i = 0; i < N; ++i)
            viaPoly[i] = poly[i].ConvertToInt();
        out << "  NativePoly::SwitchFormat  " << vec(viaPoly) << "   " << ck.mark(viaPoly == ahat)
            << "\n\n";

        dig("case " + c.id + " input", joined(c.a));
        dig("case " + c.id + " forward", joined(ahat));
        dig("case " + c.id + " inverse", joined(back));
    }

    // -------------------------------------------------------- convolutions
    for (const ConvCase& c : makeConvCases(N, qi, bits)) {
        out << "--------------------------------------------------------------------------------\n"
            << "NEGACYCLIC PRODUCT " << c.id << "   " << c.label << "\n"
            << wrap(c.note, "  ") << "\n";

        NativeVector va = toNative(c.a, q), vb = toNative(c.b, q);
        ChineseRemainderTransformFTT<NativeVector>().ForwardTransformToBitReverseInPlace(psi, R.M, &va);
        ChineseRemainderTransformFTT<NativeVector>().ForwardTransformToBitReverseInPlace(psi, R.M, &vb);
        const std::vector<u64> ah = toVec(va), bh = toVec(vb);
        std::vector<u64> ch(N, 0);
        for (u32 i = 0; i < N; ++i)
            ch[i] = modMul(ah[i], bh[i], qi);
        NativeVector vc = toNative(ch, q);
        ChineseRemainderTransformFTT<NativeVector>().InverseTransformFromBitReverseInPlace(psi, R.M, &vc);
        const std::vector<u64> prod = toVec(vc);
        const std::vector<u64> school = negacyclicMul(c.a, c.b, qi);

        const u64 direct = static_cast<u64>(N) * N;
        const u64 mulsButterfly = 3ull * (N / 2ull) * log2u(N);
        const u64 mulsPointwise = N;
        const u64 mulsScale = N / 2ull;
        const u64 viaNtt = mulsButterfly + mulsPointwise + mulsScale;

        out << "  a                         " << vec(c.a) << "\n"
            << "  b                         " << vec(c.b) << "\n"
            << "  NTT(a)                    " << vec(ah) << "\n"
            << "  NTT(b)                    " << vec(bh) << "\n"
            << "  one product per slot      " << vec(ch) << "\n"
            << "  INTT of that              " << vec(prod) << "\n"
            << "  schoolbook product        " << vec(school) << "   " << ck.mark(school == prod)
            << "\n"
            << "  multiplications           direct " << direct << "\n"
            << "                            through the transform " << viaNtt << " = "
            << mulsButterfly << " in butterflies + " << mulsPointwise << " pointwise + "
            << mulsScale << " by N^-1\n\n";

        dig("conv " + c.id + " a", joined(c.a));
        dig("conv " + c.id + " b", joined(c.b));
        dig("conv " + c.id + " product", joined(prod));
    }

    R.checks = ck.checks;
    R.failures = ck.failures;
    R.allChecksPassed = ck.failures == 0;
    out << "--------------------------------------------------------------------------------\n"
        << "RESULT  " << R.name << ": " << ck.checks << " checks, " << ck.failures << " failures  "
        << (R.allChecksPassed ? "ALL PASSED" : "*** SOMETHING FAILED ***") << "\n\n";
    return R;
}

}  // namespace nttgt
