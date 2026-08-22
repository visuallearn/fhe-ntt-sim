//==================================================================================
// ntt_trace_gen -- emit step-by-step execution traces of OpenFHE's native
// forward/inverse NTT, for the ntt-intt visual simulator.
//
// NOT part of OpenFHE. Copied into src/core/examples/ by tools/01_patch.py so it
// links against OPENFHEcore only.
//
// Two modes, selected at compile time:
//   OPENFHE_NTT_TRACE defined  -> full per-butterfly traces written as JSON.
//   OPENFHE_NTT_TRACE undefined -> "digest" mode: parameters and final vectors
//                                  only. Used to prove the instrumented build
//                                  produces bit-identical results to a pristine
//                                  one.
//
// Usage: ntt_trace_gen <output-dir>
//==================================================================================

#include "openfhecore.h"

#ifdef OPENFHE_NTT_TRACE
    #include "math/hal/intnat/ntt-trace.h"
#endif

#include <cstdint>
#include <cstdlib>
#include <exception>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

using namespace lbcrypto;

// The helpers, the input cases and the independent oracles live in one shared
// header, included by this generator and by the standalone reference experiments
// in openfhe-gt-exp/. One definition means the two cannot disagree about what
// "case delta1 at N=8" is. tools/01_patch.py copies the header next to this file.
#include "ntt_gt_cases.h"

using namespace nttgt;

// ---------------------------------------------------------------------------
// Minimal JSON writer. Compact output; the verifier pretty-prints if wanted.
// ---------------------------------------------------------------------------

class J {
public:
    J& obj() {
        pre();
        o_ << '{';
        first_.push_back(true);
        return *this;
    }
    J& endObj() {
        o_ << '}';
        first_.pop_back();
        return *this;
    }
    J& arr() {
        pre();
        o_ << '[';
        first_.push_back(true);
        return *this;
    }
    J& endArr() {
        o_ << ']';
        first_.pop_back();
        return *this;
    }
    J& key(const std::string& k) {
        comma();
        o_ << quote(k) << ':';
        pendingKey_ = true;
        return *this;
    }
    J& num(u64 v) {
        pre();
        o_ << v;
        return *this;
    }
    J& snum(int64_t v) {
        pre();
        o_ << v;
        return *this;
    }
    J& str(const std::string& s) {
        pre();
        o_ << quote(s);
        return *this;
    }
    J& boolean(bool b) {
        pre();
        o_ << (b ? "true" : "false");
        return *this;
    }
    J& raw(const std::string& s) {
        pre();
        o_ << s;
        return *this;
    }
    J& nums(const std::vector<u64>& v) {
        arr();
        for (u64 x : v)
            num(x);
        return endArr();
    }
    J& snums(const std::vector<int64_t>& v) {
        arr();
        for (int64_t x : v)
            snum(x);
        return endArr();
    }
    std::string str() const {
        return o_.str();
    }

private:
    void comma() {
        if (!first_.empty()) {
            if (!first_.back())
                o_ << ',';
            first_.back() = false;
        }
    }
    void pre() {
        if (pendingKey_) {
            pendingKey_ = false;
            return;
        }
        comma();
    }
    static std::string quote(const std::string& s) {
        std::string r = "\"";
        for (char c : s) {
            if (c == '"' || c == '\\')
                r += '\\';
            r += c;
        }
        return r + "\"";
    }
    std::ostringstream o_;
    std::vector<bool> first_;
    bool pendingKey_ = false;
};

// ---------------------------------------------------------------------------
// Bridge to OpenFHE
// ---------------------------------------------------------------------------

static std::vector<u64> toVec(const NativeVector& v) {
    std::vector<u64> r(v.GetLength());
    for (size_t i = 0; i < r.size(); ++i)
        r[i] = v[i].ConvertToInt();
    return r;
}

static NativeVector toNative(const std::vector<u64>& a, const NativeInteger& q) {
    NativeVector v(static_cast<usint>(a.size()), q);
    for (size_t i = 0; i < a.size(); ++i)
        v[i] = NativeInteger(a[i]);
    return v;
}

#ifdef OPENFHE_NTT_TRACE

// One recorded hook call. A single flat struct keeps the recorder trivial; at
// these sizes the wasted bytes are irrelevant.
struct Ev {
    enum Kind { Begin, Stage, Tw, BflyCT, BflyGS, Scale, End } kind;
    u32 line = 0;
    u32 dir = 0, len = 0;
    u64 modulus = 0;
    u32 region = 0, m = 0, t = 0, logt = 0;
    u32 twKind = 0, twIdx = 0;
    u64 tw = 0, precon = 0;
    u32 lo = 0, hi = 0;
    u64 u = 0, v = 0, outLo = 0, outHi = 0;
    u32 idx = 0;
    u64 in = 0, factor = 0, out = 0;
};

class Recorder final : public ntttrace::Sink {
public:
    std::vector<Ev> evs;

    void clear() {
        evs.clear();
    }

    void begin(u32 dir, u32 len, u64 modulus, u32 line) override {
        Ev e;
        e.kind = Ev::Begin;
        e.dir = dir;
        e.len = len;
        e.modulus = modulus;
        e.line = line;
        evs.push_back(e);
    }
    void stage(u32 region, u32 m, u32 t, u32 logt, u32 line) override {
        Ev e;
        e.kind = Ev::Stage;
        e.region = region;
        e.m = m;
        e.t = t;
        e.logt = logt;
        e.line = line;
        evs.push_back(e);
    }
    void twiddle(u32 kind, u32 idx, u64 w, u64 precon, u32 line) override {
        Ev e;
        e.kind = Ev::Tw;
        e.twKind = kind;
        e.twIdx = idx;
        e.tw = w;
        e.precon = precon;
        e.line = line;
        evs.push_back(e);
    }
    void bflyCT(u32 lo, u32 hi, u64 u, u64 v, u64 outLo, u64 outHi, u32 line) override {
        push(Ev::BflyCT, lo, hi, u, v, outLo, outHi, line);
    }
    void bflyGS(u32 lo, u32 hi, u64 u, u64 v, u64 outLo, u64 outHi, u32 line) override {
        push(Ev::BflyGS, lo, hi, u, v, outLo, outHi, line);
    }
    void scale(u32 idx, u64 in, u64 factor, u64 out, u32 line) override {
        Ev e;
        e.kind = Ev::Scale;
        e.idx = idx;
        e.in = in;
        e.factor = factor;
        e.out = out;
        e.line = line;
        evs.push_back(e);
    }
    void end(u32 line) override {
        Ev e;
        e.kind = Ev::End;
        e.line = line;
        evs.push_back(e);
    }

private:
    void push(Ev::Kind k, u32 lo, u32 hi, u64 u, u64 v, u64 outLo, u64 outHi, u32 line) {
        Ev e;
        e.kind = k;
        e.lo = lo;
        e.hi = hi;
        e.u = u;
        e.v = v;
        e.outLo = outLo;
        e.outHi = outHi;
        e.line = line;
        evs.push_back(e);
    }
};

static Recorder g_rec;

static void fail(const std::string& msg) {
    std::cerr << "ntt_trace_gen: FATAL: " << msg << "\n";
    std::exit(2);
}

struct Rendered {
    std::string events;     // JSON array
    std::string keyframes;  // JSON array
    std::vector<u64> finalArr;
    u32 butterflies = 0;
    u32 stages = 0;
};

// Replay the recorded events, re-deriving every intermediate with textbook
// modular arithmetic and asserting it matches what OpenFHE produced. Renders the
// JSON as it goes.
static Rendered render(const std::vector<Ev>& evs, const std::vector<u64>& input, u64 q, u32 brevBits,
                       const std::string& what) {
    Rendered R;
    std::vector<u64> arr = input;
    J ev, kf;
    ev.arr();
    kf.arr();

    u32 step = 0;
    u32 stageNo = 0;
    u32 region = 0;
    u64 curTw = 0;
    u32 curTwIdx = 0;
    u32 curTwKind = 0;

    for (const Ev& e : evs) {
        switch (e.kind) {
            case Ev::Begin: {
                if (e.len != arr.size())
                    fail(what + ": begin length " + std::to_string(e.len) + " != input size");
                if (e.modulus != q)
                    fail(what + ": begin modulus mismatch");
                ev.obj().key("s").num(step).key("k").str("begin").key("line").num(e.line);
                ev.key("dir").str(e.dir == 0 ? "forward" : "inverse").endObj();
                break;
            }
            case Ev::Stage: {
                region = e.region;
                static const char* kRegion[] = {"main", "peeledFirst", "inner", "peeledLast", "scale"};
                if (e.region != 4)
                    ++stageNo;
                ev.obj().key("s").num(step).key("k").str("stage").key("line").num(e.line);
                ev.key("region").str(kRegion[e.region]);
                if (e.region != 4) {
                    ev.key("stage").num(stageNo).key("m").num(e.m).key("t").num(e.t).key("logt").num(e.logt);
                }
                ev.endObj();
                // A keyframe at every stage boundary: enough to scrub backwards
                // instantly without storing a snapshot per event.
                kf.obj().key("s").num(step).key("array").nums(arr).endObj();
                break;
            }
            case Ev::Tw: {
                curTw = e.tw;
                curTwIdx = e.twIdx;
                curTwKind = e.twKind;
                // exponent of psi that this table slot holds (sign implied by direction)
                const u32 exp = brev(e.twIdx, brevBits);
                ev.obj().key("s").num(step).key("k").str("tw").key("line").num(e.line);
                ev.key("twIndex").num(e.twIdx).key("twExp").num(exp).key("tw").num(e.tw);
                ev.key("fused").boolean(e.twKind == 1);
                ev.endObj();
                break;
            }
            case Ev::BflyCT: {
                if (arr[e.lo] != e.u || arr[e.hi] != e.v)
                    fail(what + ": CT input disagrees with replayed state at " + std::to_string(e.lo));
                const u64 prod = modMul(e.v, curTw, q);
                const u64 wantLo = (e.u + prod) % q;
                const u64 wantHi = (e.u + q - prod) % q;
                if (e.outLo != wantLo || e.outHi != wantHi)
                    fail(what + ": CT butterfly algebra mismatch at (" + std::to_string(e.lo) + "," +
                         std::to_string(e.hi) + ")");
                arr[e.lo] = e.outLo;
                arr[e.hi] = e.outHi;
                ++R.butterflies;
                ev.obj().key("s").num(step).key("k").str("bfly_ct").key("line").num(e.line);
                ev.key("stage").num(stageNo).key("lo").num(e.lo).key("hi").num(e.hi);
                ev.key("u").num(e.u).key("v").num(e.v).key("tw").num(curTw).key("twIndex").num(curTwIdx);
                ev.key("prod").num(prod).key("outLo").num(e.outLo).key("outHi").num(e.outHi);
                ev.endObj();
                break;
            }
            case Ev::BflyGS: {
                if (arr[e.lo] != e.u || arr[e.hi] != e.v)
                    fail(what + ": GS input disagrees with replayed state at " + std::to_string(e.lo));
                const u64 sum = (e.u + e.v) % q;
                const u64 diff = (e.u + q - e.v) % q;
                const u64 prod = modMul(diff, curTw, q);
                if (e.outLo != sum || e.outHi != prod)
                    fail(what + ": GS butterfly algebra mismatch at (" + std::to_string(e.lo) + "," +
                         std::to_string(e.hi) + ")");
                arr[e.lo] = e.outLo;
                arr[e.hi] = e.outHi;
                ++R.butterflies;
                ev.obj().key("s").num(step).key("k").str("bfly_gs").key("line").num(e.line);
                ev.key("stage").num(stageNo).key("lo").num(e.lo).key("hi").num(e.hi);
                ev.key("u").num(e.u).key("v").num(e.v).key("sum").num(sum).key("diff").num(diff);
                ev.key("tw").num(curTw).key("twIndex").num(curTwIdx).key("fused").boolean(curTwKind == 1);
                ev.key("prod").num(prod).key("outLo").num(e.outLo).key("outHi").num(e.outHi);
                ev.endObj();
                break;
            }
            case Ev::Scale: {
                if (arr[e.idx] != e.in)
                    fail(what + ": scale input disagrees with replayed state");
                if (e.out != modMul(e.in, e.factor, q))
                    fail(what + ": scale algebra mismatch");
                arr[e.idx] = e.out;
                ev.obj().key("s").num(step).key("k").str("scale").key("line").num(e.line);
                ev.key("idx").num(e.idx).key("in").num(e.in).key("factor").num(e.factor);
                ev.key("out").num(e.out).endObj();
                break;
            }
            case Ev::End: {
                ev.obj().key("s").num(step).key("k").str("end").key("line").num(e.line).endObj();
                kf.obj().key("s").num(step).key("array").nums(arr).endObj();
                break;
            }
        }
        ++step;
    }
    (void)region;

    R.stages = stageNo;
    R.events = ev.endArr().str();
    R.keyframes = kf.endArr().str();
    R.finalArr = arr;
    return R;
}

// Run one transform under instrumentation and return the rendered trace.
static Rendered runTraced(bool forward, std::vector<u64>& data, const NativeInteger& q, const NativeInteger& psi,
                          u32 M, u32 brevBits, const std::string& what) {
    NativeVector vec = toNative(data, q);
    g_rec.clear();
    ntttrace::g_sink = &g_rec;
    if (forward)
        ChineseRemainderTransformFTT<NativeVector>().ForwardTransformToBitReverseInPlace(psi, M, &vec);
    else
        ChineseRemainderTransformFTT<NativeVector>().InverseTransformFromBitReverseInPlace(psi, M, &vec);
    ntttrace::g_sink = nullptr;

    Rendered R = render(g_rec.evs, data, q.ConvertToInt(), brevBits, what);
    const std::vector<u64> actual = toVec(vec);
    if (R.finalArr != actual)
        fail(what + ": replayed state != OpenFHE's output vector");

    const u32 n = static_cast<u32>(data.size());
    const u32 expectBf = (n / 2u) * log2u(n);
    if (R.butterflies != expectBf)
        fail(what + ": counted " + std::to_string(R.butterflies) + " butterflies, expected " +
             std::to_string(expectBf));
    if (R.stages != log2u(n))
        fail(what + ": counted " + std::to_string(R.stages) + " stages, expected " + std::to_string(log2u(n)));

    data = actual;
    return R;
}

#endif  // OPENFHE_NTT_TRACE

// ---------------------------------------------------------------------------
// Untraced transform, used in digest mode and for cross-checks.
// ---------------------------------------------------------------------------

static std::vector<u64> runPlain(bool forward, const std::vector<u64>& data, const NativeInteger& q,
                                 const NativeInteger& psi, u32 M) {
    NativeVector vec = toNative(data, q);
    if (forward)
        ChineseRemainderTransformFTT<NativeVector>().ForwardTransformToBitReverseInPlace(psi, M, &vec);
    else
        ChineseRemainderTransformFTT<NativeVector>().InverseTransformFromBitReverseInPlace(psi, M, &vec);
    return toVec(vec);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------


int main(int argc, char** argv) {
    if (argc != 2) {
        std::cerr << "usage: ntt_trace_gen <output-dir>\n";
        return 1;
    }
    const std::string outDir = argv[1];

    J man;
    man.obj();
    man.key("schemaVersion").num(1);
    man.key("build")
        .obj()
        .key("openfheVersion")
        .str(GetOPENFHEVersion())
        .key("nativeInt")
        .num(NATIVEINT)
        .key("mathBackend")
        .num(MATHBACKEND)
        .key("maxModulusSize")
        .num(MAX_MODULUS_SIZE)
        .key("compiler")
        .str(__VERSION__)
#ifdef OPENFHE_NTT_TRACE
        .key("traced")
        .boolean(true)
#else
        .key("traced")
        .boolean(false)
#endif
        .endObj();
    man.key("ringDimensions").arr();
    for (u32 nd : ringDimensions())
        man.num(nd);
    man.endArr();
    man.key("modulusBits").arr();
    for (u32 b : modulusBits())
        man.num(b);
    man.endArr();
    man.key("configs").arr();

    for (u32 n : ringDimensions()) {
        const u32 M = 2u * n;
        const u32 brevBits = log2u(n);

        for (u32 bits : modulusBits()) {
            NativeInteger q, psi;
            std::string infeasible;
            try {
                // The real OpenFHE parameter path: LastPrime then RootOfUnity.
                auto params = std::make_shared<ILNativeParams>(M, bits);
                q = params->GetModulus();
                psi = params->GetRootOfUnity();
                // Belt and braces: the same values via the underlying helpers.
                if (q != LastPrime<NativeInteger>(bits, M))
                    throw std::runtime_error("modulus disagrees with LastPrime");
                if (psi != RootOfUnity<NativeInteger>(M, q))
                    throw std::runtime_error("root disagrees with RootOfUnity");
            }
            catch (const std::exception& e) {
                infeasible = trimSourcePath(e.what());
            }

            man.obj().key("N").num(n).key("M").num(M).key("bits").num(bits);
            if (!infeasible.empty()) {
                man.key("feasible").boolean(false).key("reason").str(infeasible).endObj();
                std::cout << "N=" << n << " bits=" << bits << "  INFEASIBLE\n";
                continue;
            }

            const u64 qi = q.ConvertToInt();
            const u64 psii = psi.ConvertToInt();
            const std::string file =
                "n" + std::to_string(n) + "-b" + std::to_string(bits) + "-q" + std::to_string(qi) + ".json";
            man.key("feasible").boolean(true).key("q").num(qi).key("psi").num(psii);
            man.key("file").str("traces/" + file).endObj();

            // Fresh tables. PreCompute caches by modulus in static maps and
            // several q values repeat across N (17, 193, 241, 449, 1009), so
            // this reset is load-bearing, not hygiene.
            ChineseRemainderTransformFTT<NativeVector>().Reset();
            ChineseRemainderTransformFTT<NativeVector>().PreCompute(psi, M, q);

            const auto& fwdT = ChineseRemainderTransformFTT<NativeVector>::m_rootOfUnityReverseTableByModulus[q];
            const auto& invT =
                ChineseRemainderTransformFTT<NativeVector>::m_rootOfUnityInverseReverseTableByModulus[q];
            const auto& coiT = ChineseRemainderTransformFTT<NativeVector>::m_cycloOrderInverseTableByModulus[q];
#ifdef OPENFHE_NTT_TRACE
            const auto& fwdP =
                ChineseRemainderTransformFTT<NativeVector>::m_rootOfUnityPreconReverseTableByModulus[q];
            const auto& invP =
                ChineseRemainderTransformFTT<NativeVector>::m_rootOfUnityInversePreconReverseTableByModulus[q];
            const auto& coiP =
                ChineseRemainderTransformFTT<NativeVector>::m_cycloOrderInversePreconTableByModulus[q];
#endif

            const u64 psiInv = modInv(psii, qi);
            const u64 nInv = modInv(n % qi, qi);
            std::cout << "N=" << n << " bits=" << bits << " q=" << qi << " psi=" << psii << " psiInv=" << psiInv
                      << " nInv=" << nInv << "\n";

            // Cross-check OpenFHE's own tables against the textbook definition.
            for (u32 j = 0; j < n; ++j) {
                const u32 e = brev(j, brevBits);
                if (fwdT[j].ConvertToInt() != modPow(psii, e, qi)) {
                    std::cerr << "FATAL: forward table mismatch at " << j << "\n";
                    return 2;
                }
                if (invT[j].ConvertToInt() != modPow(psiInv, e, qi)) {
                    std::cerr << "FATAL: inverse table mismatch at " << j << "\n";
                    return 2;
                }
            }
            if (coiT[brevBits].ConvertToInt() != nInv) {
                std::cerr << "FATAL: cycloOrderInverse table mismatch\n";
                return 2;
            }

#ifdef OPENFHE_NTT_TRACE
            J t;
            t.obj();
            t.key("schemaVersion").num(1);
            t.key("params")
                .obj()
                .key("N")
                .num(n)
                .key("M")
                .num(M)
                .key("bits")
                .num(bits)
                .key("q")
                .num(qi)
                .key("psi")
                .num(psii)
                .key("psiInv")
                .num(psiInv)
                .key("omegaN")
                .num(modMul(psii, psii, qi))
                .key("negOne")
                .num(modPow(psii, n, qi))
                .key("nInv")
                .num(nInv)
                .key("brevBits")
                .num(brevBits)
                .key("logN")
                .num(log2u(n))
                .key("coiIndex")
                .num(brevBits)
                .key("modulusSelector")
                .str("LastPrime<NativeInteger>(" + std::to_string(bits) + ", " + std::to_string(M) + ")")
                .key("rootSelector")
                .str("RootOfUnity<NativeInteger>(" + std::to_string(M) + ", " + std::to_string(qi) + ")")
                .key("mu")
                .str(std::to_string(q.ComputeMu().ConvertToInt()))
                .key("maxModulusSize")
                .num(MAX_MODULUS_SIZE)
                .endObj();

            // Tables, verbatim from OpenFHE's static caches.
            t.key("tables").obj();
            t.key("fwd").arr();
            for (u32 j = 0; j < n; ++j) {
                t.obj()
                    .key("j")
                    .num(j)
                    .key("brev")
                    .num(brev(j, brevBits))
                    .key("exp")
                    .num(brev(j, brevBits))
                    .key("v")
                    .num(fwdT[j].ConvertToInt())
                    .key("precon")
                    .str(std::to_string(fwdP[j].ConvertToInt()))
                    .endObj();
            }
            t.endArr();
            t.key("inv").arr();
            for (u32 j = 0; j < n; ++j) {
                t.obj()
                    .key("j")
                    .num(j)
                    .key("brev")
                    .num(brev(j, brevBits))
                    .key("exp")
                    .num(brev(j, brevBits))
                    .key("v")
                    .num(invT[j].ConvertToInt())
                    .key("precon")
                    .str(std::to_string(invP[j].ConvertToInt()))
                    .endObj();
            }
            t.endArr();
            t.key("coi").arr();
            for (usint i = 0; i < coiT.GetLength(); ++i) {
                t.obj()
                    .key("i")
                    .num(i)
                    .key("v")
                    .num(coiT[i].ConvertToInt())
                    .key("precon")
                    .str(std::to_string(coiP[i].ConvertToInt()))
                    .endObj();
            }
            t.endArr();
            {
                // The fused twiddle of the inverse's final stage.
                const u64 o1 = modMul(invT[1].ConvertToInt(), nInv, qi);
                t.key("omega1Inv")
                    .obj()
                    .key("v")
                    .num(o1)
                    .key("expr")
                    .str("TableI[1] * nInv = psi^-(N/2) * N^-1")
                    .endObj();
            }
            t.endObj();  // tables

            t.key("cases").arr();
            for (const Case& c : makeCases(n, qi, bits)) {
                std::vector<u64> work = c.a;
                Rendered fwd = runTraced(true, work, q, psi, M, brevBits, c.id + "/forward");
                const std::vector<u64> ahat = work;

                const std::vector<u64> oracle = oracleForward(c.a, qi, psii, brevBits);
                if (oracle != ahat) {
                    std::cerr << "FATAL: forward oracle mismatch for " << c.id << " (N=" << n << ", q=" << qi
                              << ")\n";
                    return 2;
                }

                Rendered inv = runTraced(false, work, q, psi, M, brevBits, c.id + "/inverse");
                const bool roundTrip = (work == c.a);
                if (!roundTrip) {
                    std::cerr << "FATAL: round trip failed for " << c.id << "\n";
                    return 2;
                }
                if (oracleInverse(ahat, qi, psii, brevBits) != work) {
                    std::cerr << "FATAL: inverse oracle mismatch for " << c.id << "\n";
                    return 2;
                }

                t.obj();
                t.key("id").str(c.id).key("label").str(c.label).key("note").str(c.note);
                t.key("input").nums(c.a);
                t.key("evalPoints").arr();
                for (u32 p = 0; p < n; ++p) {
                    const u64 e = 2ull * brev(p, brevBits) + 1ull;
                    t.obj()
                        .key("slot")
                        .num(p)
                        .key("brev")
                        .num(brev(p, brevBits))
                        .key("exp")
                        .num(e)
                        .key("point")
                        .num(modPow(psii, e, qi))
                        .key("value")
                        .num(ahat[p])
                        .endObj();
                }
                t.endArr();
                t.key("forward")
                    .obj()
                    .key("input")
                    .nums(c.a)
                    .key("expected")
                    .nums(ahat)
                    .key("keyframes")
                    .raw(fwd.keyframes)
                    .key("events")
                    .raw(fwd.events)
                    .endObj();
                t.key("inverse")
                    .obj()
                    .key("input")
                    .nums(ahat)
                    .key("expected")
                    .nums(work)
                    .key("keyframes")
                    .raw(inv.keyframes)
                    .key("events")
                    .raw(inv.events)
                    .endObj();
                t.key("roundTripOk").boolean(roundTrip);
                t.endObj();

                // Same one-line digest the pristine build prints, so the two
                // builds can be compared with a plain diff.
                std::cout << "  case " << c.id << " fwd:";
                for (u64 x : ahat)
                    std::cout << ' ' << x;
                std::cout << " rt:";
                for (u64 x : work)
                    std::cout << ' ' << x;
                std::cout << "\n";
            }
            t.endArr();  // cases

            t.key("convolutions").arr();
            for (const ConvCase& c : makeConvCases(n, qi, bits)) {
                std::vector<u64> wa = c.a, wb = c.b;
                Rendered fa = runTraced(true, wa, q, psi, M, brevBits, c.id + "/convA");
                Rendered fb = runTraced(true, wb, q, psi, M, brevBits, c.id + "/convB");
                std::vector<u64> chat(n, 0);
                for (u32 i = 0; i < n; ++i)
                    chat[i] = modMul(wa[i], wb[i], qi);
                std::vector<u64> wc = chat;
                Rendered ic = runTraced(false, wc, q, psi, M, brevBits, c.id + "/convInv");

                const std::vector<u64> school = negacyclicMul(c.a, c.b, qi);
                if (school != wc) {
                    std::cerr << "FATAL: convolution mismatch for " << c.id << " (N=" << n << ", q=" << qi << ")\n";
                    return 2;
                }

                t.obj();
                t.key("id").str(c.id).key("label").str(c.label).key("note").str(c.note);
                t.key("a").nums(c.a).key("b").nums(c.b);
                t.key("aHat").nums(wa).key("bHat").nums(wb).key("cHat").nums(chat);
                t.key("product").nums(wc).key("schoolbook").nums(school).key("match").boolean(true);
                std::cout << "  conv " << c.id << " prod:";
                for (u64 x : wc)
                    std::cout << ' ' << x;
                std::cout << "\n";
                // Multiplication counts, as OpenFHE actually performs them. The
                // trailing multiply by N^-1 in the inverse transform is included:
                // the simulator animates those steps, so leaving them out of its
                // own total would be inconsistent with what it shows.
                const u64 mulsButterfly = 3ull * (n / 2ull) * log2u(n);
                const u64 mulsPointwise = n;
                const u64 mulsScale     = n / 2ull;
                t.key("opsSchoolbook").num(static_cast<u64>(n) * n);
                t.key("opsButterfly").num(mulsButterfly);
                t.key("opsPointwise").num(mulsPointwise);
                t.key("opsScale").num(mulsScale);
                t.key("opsNtt").num(mulsButterfly + mulsPointwise + mulsScale);
                t.key("forwardA")
                    .obj()
                    .key("input")
                    .nums(c.a)
                    .key("expected")
                    .nums(wa)
                    .key("keyframes")
                    .raw(fa.keyframes)
                    .key("events")
                    .raw(fa.events)
                    .endObj();
                t.key("forwardB")
                    .obj()
                    .key("input")
                    .nums(c.b)
                    .key("expected")
                    .nums(wb)
                    .key("keyframes")
                    .raw(fb.keyframes)
                    .key("events")
                    .raw(fb.events)
                    .endObj();
                t.key("inverse")
                    .obj()
                    .key("input")
                    .nums(chat)
                    .key("expected")
                    .nums(wc)
                    .key("keyframes")
                    .raw(ic.keyframes)
                    .key("events")
                    .raw(ic.events)
                    .endObj();
                t.endObj();
            }
            t.endArr();  // convolutions
            t.endObj();

            const std::string path = outDir + "/traces/" + file;
            std::ofstream os(path, std::ios::binary);
            if (!os) {
                std::cerr << "FATAL: cannot write " << path << "\n";
                return 2;
            }
            os << t.str() << "\n";
            os.close();

            // Prove the traced entry point is the one NativePoly actually uses.
            {
                auto params = std::make_shared<ILNativeParams>(M, bits);
                const auto cases = makeCases(n, qi, bits);
                const std::vector<u64>& a = cases.front().a;
                NativePoly poly(params, Format::COEFFICIENT, true);
                for (u32 i = 0; i < n; ++i)
                    poly[i] = NativeInteger(a[i]);
                poly.SwitchFormat();
                std::vector<u64> viaPoly(n, 0);
                for (u32 i = 0; i < n; ++i)
                    viaPoly[i] = poly[i].ConvertToInt();
                if (viaPoly != runPlain(true, a, q, psi, M)) {
                    std::cerr << "FATAL: NativePoly::SwitchFormat disagrees with the traced entry point\n";
                    return 2;
                }
            }
#else
            // Digest mode: no traces, just the values the transform produced,
            // in a stable text form that can be diffed against the instrumented
            // build. The same independent oracles run here, so the pristine
            // build validates itself too.
            for (const Case& c : makeCases(n, qi, bits)) {
                const std::vector<u64> f = runPlain(true, c.a, q, psi, M);
                const std::vector<u64> r = runPlain(false, f, q, psi, M);
                if (f != oracleForward(c.a, qi, psii, brevBits)) {
                    std::cerr << "FATAL: forward oracle mismatch for " << c.id << "\n";
                    return 2;
                }
                if (r != oracleInverse(f, qi, psii, brevBits) || r != c.a) {
                    std::cerr << "FATAL: inverse/round trip mismatch for " << c.id << "\n";
                    return 2;
                }
                std::cout << "  case " << c.id << " fwd:";
                for (u64 x : f)
                    std::cout << ' ' << x;
                std::cout << " rt:";
                for (u64 x : r)
                    std::cout << ' ' << x;
                std::cout << "\n";
            }
            for (const ConvCase& c : makeConvCases(n, qi, bits)) {
                const std::vector<u64> fa = runPlain(true, c.a, q, psi, M);
                const std::vector<u64> fb = runPlain(true, c.b, q, psi, M);
                std::vector<u64> chat(n, 0);
                for (u32 i = 0; i < n; ++i)
                    chat[i] = modMul(fa[i], fb[i], qi);
                const std::vector<u64> prod = runPlain(false, chat, q, psi, M);
                if (prod != negacyclicMul(c.a, c.b, qi)) {
                    std::cerr << "FATAL: convolution mismatch for " << c.id << "\n";
                    return 2;
                }
                std::cout << "  conv " << c.id << " prod:";
                for (u64 x : prod)
                    std::cout << ' ' << x;
                std::cout << "\n";
            }
#endif
        }
    }

    man.endArr().endObj();
    {
        const std::string path = outDir + "/manifest.partial.json";
        std::ofstream os(path, std::ios::binary);
        if (!os) {
            std::cerr << "FATAL: cannot write " << path << "\n";
            return 2;
        }
        os << man.str() << "\n";
    }
    std::cout << "done\n";
    return 0;
}
