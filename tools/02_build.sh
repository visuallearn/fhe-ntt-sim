#!/usr/bin/env bash
# Configure and build two variants from one source tree:
#   build-traced   -- OPENFHE_NTT_TRACE defined: emits step traces
#   build-pristine -- no define: instrumentation compiles away entirely
# Building both lets us prove the hooks changed nothing.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "${REPO_ROOT}/tools/env.sh"

# g++ specifically: transformnat-impl.h branches on
# `#if defined(__GNUC__) && !defined(__clang__)`, and the simulator displays the
# GCC side of that branch.
COMMON=(
    -DCMAKE_BUILD_TYPE=Release
    -DCMAKE_CXX_COMPILER=g++
    -DCMAKE_C_COMPILER=gcc
    -DNATIVE_SIZE=64
    -DWITH_OPENMP=OFF
    -DWITH_NATIVEOPT=OFF
    -DBUILD_SHARED=ON
    -DBUILD_STATIC=OFF
    -DBUILD_EXAMPLES=ON
    -DBUILD_BENCHMARKS=OFF
    -DBUILD_EXTRAS=OFF
    -DGIT_SUBMOD_AUTO=OFF
)

want_tests="${WITH_TESTS:-ON}"

echo "[02] configuring build-traced"
cmake -S "${OPENFHE_DIR}" -B "${BUILD_TRACED}" "${COMMON[@]}" \
    -DBUILD_UNITTESTS="${want_tests}" \
    -DCMAKE_CXX_FLAGS="-DOPENFHE_NTT_TRACE" >/dev/null

echo "[02] configuring build-pristine"
cmake -S "${OPENFHE_DIR}" -B "${BUILD_PRISTINE}" "${COMMON[@]}" \
    -DBUILD_UNITTESTS=OFF >/dev/null

targets=(ntt_trace_gen)
[[ "${want_tests}" == "ON" ]] && targets+=(core_tests)

echo "[02] building build-traced: ${targets[*]}"
cmake --build "${BUILD_TRACED}" --target "${targets[@]}" -j"${JOBS}"

echo "[02] building build-pristine: ntt_trace_gen"
cmake --build "${BUILD_PRISTINE}" --target ntt_trace_gen -j"${JOBS}"

echo "[02] OK"
echo "     traced   : ${BUILD_TRACED}/bin/examples/core/ntt_trace_gen"
echo "     pristine : ${BUILD_PRISTINE}/bin/examples/core/ntt_trace_gen"
