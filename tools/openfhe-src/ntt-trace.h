//==================================================================================
// Trace instrumentation for OpenFHE's native NTT/INTT.
//
// Part of the ntt-intt visual simulator (https://github.com/<owner>/ntt-intt).
// NOT part of OpenFHE. Installed into the OpenFHE source tree by tools/01_patch.py
// as src/core/include/math/hal/intnat/ntt-trace.h.
//
// Everything here is inert unless OPENFHE_NTT_TRACE is defined at compile time,
// and even then it is a pure observer: no hook reads or writes any value the
// transform depends on. The pristine build sees an empty header.
//==================================================================================

#ifndef __NTT_TRACE_H__
#define __NTT_TRACE_H__

#ifdef OPENFHE_NTT_TRACE

    #include <cstdint>

namespace ntttrace {

// Direction of the transform being traced.
enum Dir : uint32_t {
    DIR_FORWARD = 0,
    DIR_INVERSE = 1,
};

// Which textual region of the OpenFHE source the current stage comes from.
// The production routines peel their first/last stage into a separate loop,
// so "which stage" and "which code" are not the same question.
enum Region : uint32_t {
    REGION_MAIN         = 0,  // forward: the m-loop covering stages 1..log2(N)-1
    REGION_PEELED_FIRST = 1,  // inverse: unrolled stage 1 (t == 1)
    REGION_INNER        = 2,  // inverse: the m-loop covering stages 2..log2(N)-1
    REGION_PEELED_LAST  = 3,  // forward: unrolled final stage; inverse: unrolled final stage
    REGION_SCALE        = 4,  // inverse: the trailing multiply by N^-1
};

// How a twiddle factor was obtained.
enum TwKind : uint32_t {
    TW_TABLE = 0,  // read straight out of the (bit-reversed) root-of-unity table
    TW_FUSED = 1,  // table entry pre-multiplied by N^-1 (inverse final stage, issue #872)
};

// Every callback carries `line`: the line number in the *pristine* upstream
// transformnat-impl.h, passed explicitly rather than via __LINE__, because
// instrumentation shifts the lines but the simulator displays the original file.
class Sink {
public:
    virtual ~Sink() = default;

    virtual void begin(uint32_t dir, uint32_t len, uint64_t modulus, uint32_t line)                     = 0;
    virtual void stage(uint32_t region, uint32_t m, uint32_t t, uint32_t logt, uint32_t line)           = 0;
    virtual void twiddle(uint32_t kind, uint32_t idx, uint64_t w, uint64_t precon, uint32_t line)       = 0;
    // Cooley-Tukey: out = (u + v*w, u - v*w)
    virtual void bflyCT(uint32_t lo, uint32_t hi, uint64_t u, uint64_t v, uint64_t outLo, uint64_t outHi,
                        uint32_t line)                                                                 = 0;
    // Gentleman-Sande: out = (u + v, (u - v)*w)
    virtual void bflyGS(uint32_t lo, uint32_t hi, uint64_t u, uint64_t v, uint64_t outLo, uint64_t outHi,
                        uint32_t line)                                                                 = 0;
    virtual void scale(uint32_t idx, uint64_t in, uint64_t factor, uint64_t out, uint32_t line)         = 0;
    virtual void end(uint32_t line)                                                                    = 0;
};

// C++17 inline variable: one entity across every translation unit, no library .cpp.
// Null unless the trace generator installs a sink, so an instrumented build that
// nobody hooks into behaves exactly like a pristine one.
inline Sink* g_sink = nullptr;

// Uniform widening for OpenFHE integer types (NativeInteger and friends).
template <typename T>
inline uint64_t u64(const T& x) {
    return static_cast<uint64_t>(x.ConvertToInt());
}

}  // namespace ntttrace

    #define NTTTR_EMIT(call)                 \
        do {                                 \
            if (::ntttrace::g_sink)          \
                ::ntttrace::g_sink->call;    \
        } while (0)

#endif  // OPENFHE_NTT_TRACE
#endif  // __NTT_TRACE_H__
