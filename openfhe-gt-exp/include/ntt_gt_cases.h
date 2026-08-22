//==================================================================================
// Shared definitions for the NTT ground-truth work: the input vectors, the
// independent oracles, and the small number-theory helpers.
//
// This header is the SINGLE definition of those things. It is included by:
//   * openfhe-gt-exp/src/*            -- the standalone reference experiments
//   * src/core/examples/ntt_trace_gen -- the generator of the traces on the site
//     (tools/01_patch.py copies this header next to it)
//
// One definition means the reference reports and the shipped traces cannot
// disagree about what "case delta1 at N=8" is.
//
// Deliberately free of any OpenFHE dependency: everything here exists to CHECK
// OpenFHE, so it must not share machinery with it. Plain integers only.
//
// Everything is `inline`, not `static`: OpenFHE builds with -Wall -Werror, and a
// static function that one translation unit happens not to call is an error.
//==================================================================================

#ifndef NTT_GT_CASES_H
#define NTT_GT_CASES_H

#include <cstdint>
#include <string>
#include <vector>

namespace nttgt {

using u64 = uint64_t;
using u32 = uint32_t;

// --------------------------------------------------------------------------
// number theory, from definitions
// --------------------------------------------------------------------------

inline u64 modMul(u64 a, u64 b, u64 q) {
    return static_cast<u64>((static_cast<unsigned __int128>(a) * b) % q);
}

inline u64 modPow(u64 b, u64 e, u64 q) {
    u64 r = 1 % q;
    b %= q;
    while (e) {
        if (e & 1)
            r = modMul(r, b, q);
        b = modMul(b, b, q);
        e >>= 1;
    }
    return r;
}

/// q is prime throughout, so Fermat gives the inverse.
inline u64 modInv(u64 a, u64 q) {
    return modPow(a, q - 2, q);
}

/// Reverse the low `bits` bits of x.
inline u32 brev(u32 x, u32 bits) {
    u32 r = 0;
    for (u32 i = 0; i < bits; ++i)
        r |= ((x >> i) & 1u) << (bits - 1u - i);
    return r;
}

inline u32 log2u(u32 x) {
    u32 l = 0;
    while ((1u << l) < x)
        ++l;
    return l;
}

/// Shoup's precomputation for a fixed multiplicand: floor(w * 2^64 / q).
inline u64 shoupPrecon(u64 w, u64 q) {
    return static_cast<u64>((static_cast<unsigned __int128>(w) << 64) / q);
}

/// Barrett constant as OpenFHE computes it: floor(2^(2*bitlen(q)+3) / q).
inline u64 barrettMu(u64 q) {
    u32 msb = 0;
    while ((q >> msb) != 0)
        ++msb;
    return static_cast<u64>((static_cast<unsigned __int128>(1) << (2 * msb + 3)) / q);
}

/// Remove the absolute path from an OpenFHE exception message.
///
/// OpenFHE prefixes its exceptions with the full path of the source file, which
/// on a build machine looks like "/home/someone/work/.work/openfhe/src/core/...".
/// That path is noise in a published report and it leaks a directory layout, so
/// keep only the file name.
inline std::string trimSourcePath(const std::string& msg) {
    const auto colon = msg.find(':');
    if (colon == std::string::npos)
        return msg;
    const auto slash = msg.rfind('/', colon);
    if (slash == std::string::npos)
        return msg;
    return msg.substr(slash + 1);
}

// --------------------------------------------------------------------------
// input generation: deterministic, and not OpenFHE's PRNG
// --------------------------------------------------------------------------

struct XorShift64 {
    u64 s;
    explicit XorShift64(u64 seed) : s(seed ? seed : 0x9E3779B97F4A7C15ull) {}
    u64 next() {
        s ^= s >> 12;
        s ^= s << 25;
        s ^= s >> 27;
        return s * 0x2545F4914F6CDD1Dull;
    }
};

// --------------------------------------------------------------------------
// independent oracles
//
// OpenFHE's forward transform leaves the result in bit-reversed order, evaluated
// at the odd powers of psi:   out[p] = a(psi^(2*brev(p) + 1)) mod q
// These evaluate that sum directly, in O(N^2), with no butterflies.
// --------------------------------------------------------------------------

inline std::vector<u64> oracleForward(const std::vector<u64>& a, u64 q, u64 psi, u32 brevBits) {
    const u32 n = static_cast<u32>(a.size());
    std::vector<u64> out(n, 0);
    for (u32 p = 0; p < n; ++p) {
        const u64 x = modPow(psi, 2ull * brev(p, brevBits) + 1ull, q);
        u64 acc = 0, xp = 1 % q;
        for (u32 i = 0; i < n; ++i) {
            acc = (acc + modMul(a[i], xp, q)) % q;
            xp = modMul(xp, x, q);
        }
        out[p] = acc;
    }
    return out;
}

inline std::vector<u64> oracleInverse(const std::vector<u64>& ahat, u64 q, u64 psi, u32 brevBits) {
    const u32 n = static_cast<u32>(ahat.size());
    const u64 nInv = modInv(n % q, q);
    const u64 psiInv = modInv(psi, q);
    std::vector<u64> out(n, 0);
    for (u32 i = 0; i < n; ++i) {
        u64 acc = 0;
        for (u32 p = 0; p < n; ++p) {
            const u64 e = (2ull * brev(p, brevBits) + 1ull) * i % (2ull * n);
            acc = (acc + modMul(ahat[p], modPow(psiInv, e, q), q)) % q;
        }
        out[i] = modMul(acc, nInv, q);
    }
    return out;
}

/// Schoolbook product in Z_q[X]/(X^n + 1): a term that passes degree n returns
/// to degree i+j-n with the opposite sign.
inline std::vector<u64> negacyclicMul(const std::vector<u64>& a, const std::vector<u64>& b, u64 q) {
    const u32 n = static_cast<u32>(a.size());
    std::vector<u64> c(n, 0);
    for (u32 i = 0; i < n; ++i) {
        for (u32 j = 0; j < n; ++j) {
            const u64 t = modMul(a[i], b[j], q);
            const u32 k = i + j;
            if (k < n)
                c[k] = (c[k] + t) % q;
            else
                c[k - n] = (c[k - n] + q - t) % q;
        }
    }
    return c;
}

// --------------------------------------------------------------------------
// the input cases
// --------------------------------------------------------------------------

struct Case {
    std::string id;
    std::string label;
    std::string note;
    std::vector<u64> a;
};

inline std::vector<Case> makeCases(u32 n, u64 q, u32 bits) {
    std::vector<Case> cs;
    auto zeros = [n]() { return std::vector<u64>(n, 0); };

    {
        auto a = zeros();
        a[0] = 1;
        cs.push_back({"delta0", "a(X) = 1",
                      "The constant polynomial 1. Its value is 1 at every point, so the "
                      "transform is all ones. This is the simplest test.",
                      a});
    }
    {
        auto a = zeros();
        a[1] = 1;
        cs.push_back({"delta1", "a(X) = X",
                      "The value of X at a point is the point. This transform is therefore "
                      "the list of evaluation points: out[p] = psi^(2*brev(p)+1).",
                      a});
    }
    {
        auto a = zeros();
        for (u32 i = 0; i < n; ++i)
            a[i] = i % q;
        cs.push_back({"ramp", "a_i = i", "A ramp. It has no symmetry that can hide a mistake.", a});
    }
    {
        std::vector<u64> a(n, 1);
        cs.push_back({"ones", "a_i = 1",
                      "Every coefficient is 1. The output looks random, but it is only this "
                      "polynomial at N different points.",
                      a});
    }
    {
        auto a = zeros();
        a[0] = 3 % q;
        a[n - 1] = 5 % q;
        cs.push_back({"sparse", "a(X) = 3 + 5X^(N-1)",
                      "Two non-zero coefficients. One is at the top degree, where X^N = -1 "
                      "becomes important.",
                      a});
    }
    {
        XorShift64 rng(0x9E3779B97F4A7C15ull ^ (static_cast<u64>(n) * 1000003ull) ^
                       (static_cast<u64>(bits) * 65537ull));
        std::vector<u64> a(n, 0);
        for (u32 i = 0; i < n; ++i)
            a[i] = rng.next() % q;
        cs.push_back({"random", "pseudo-random coefficients",
                      "What a real ciphertext polynomial looks like: uniform residues mod q. "
                      "A fixed-seed xorshift64* generates them, so the trace repeats exactly.",
                      a});
    }
    {
        std::vector<u64> a(n, q - 1);
        cs.push_back({"nearmax", "a_i = q-1",
                      "Every coefficient is at the largest residue. The conditional "
                      "subtractions inside the butterfly then run.",
                      a});
    }
    return cs;
}

struct ConvCase {
    std::string id;
    std::string label;
    std::string note;
    std::vector<u64> a, b;
};

inline std::vector<ConvCase> makeConvCases(u32 n, u64 q, u32 bits) {
    std::vector<ConvCase> cs;
    auto zeros = [n]() { return std::vector<u64>(n, 0); };
    {
        auto a = zeros(), b = zeros();
        a[1] = 1;
        b[1] = 1;
        cs.push_back({"square", "X * X = X^2", "The simplest product. Nothing passes the top degree.", a, b});
    }
    {
        auto a = zeros(), b = zeros();
        a[n - 1] = 1;
        b[1] = 1;
        cs.push_back({"wrap", "X^(N-1) * X = X^N = -1",
                      "The purpose of this ring. The product passes degree N, returns to "
                      "degree 0, and changes sign.",
                      a, b});
    }
    {
        XorShift64 r1(0xD1B54A32D192ED03ull ^ (static_cast<u64>(n) << 8) ^ bits);
        XorShift64 r2(0xA24BAED4963EE407ull ^ (static_cast<u64>(n) << 8) ^ bits);
        std::vector<u64> a(n, 0), b(n, 0);
        for (u32 i = 0; i < n; ++i) {
            a[i] = r1.next() % q;
            b[i] = r2.next() % q;
        }
        cs.push_back({"random", "two random polynomials", "The realistic case.", a, b});
    }
    return cs;
}

// --------------------------------------------------------------------------
// the parameter grid the site covers
// --------------------------------------------------------------------------

inline std::vector<u32> ringDimensions() {
    return {4, 8, 16, 32};
}
inline std::vector<u32> modulusBits() {
    return {4, 5, 6, 7, 8, 9, 10};
}

}  // namespace nttgt

#endif  // NTT_GT_CASES_H
