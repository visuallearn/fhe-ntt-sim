#!/usr/bin/env bash
# Run OpenFHE's own NTT/transform unit tests against the INSTRUMENTED build.
# If the hooks were anything other than pure observers, these would fail.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "${REPO_ROOT}/tools/env.sh"

BIN="${BUILD_TRACED}/unittest/core_tests"
if [[ ! -x "${BIN}" ]]; then
    echo "[07] core_tests not built; run: cmake --build ${BUILD_TRACED} --target core_tests" >&2
    exit 1
fi

export OMP_NUM_THREADS=1
FILTER="${1:-*NTT*:*Transform*:*transform*:*ntt*}"
echo "[07] gtest filter: ${FILTER}"
"${BIN}" --gtest_filter="${FILTER}"
echo "[07] OK: OpenFHE's own transform tests pass on the instrumented build"
