#!/usr/bin/env bash
# Run the instrumented generator, then prove the instrumentation was inert by
# running the pristine build over the same parameters and diffing the digests.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "${REPO_ROOT}/tools/env.sh"

TRACED_BIN="${BUILD_TRACED}/bin/examples/core/ntt_trace_gen"
PRISTINE_BIN="${BUILD_PRISTINE}/bin/examples/core/ntt_trace_gen"
for b in "${TRACED_BIN}" "${PRISTINE_BIN}"; do
    [[ -x "$b" ]] || { echo "[03] FATAL: $b missing. Run tools/02_build.sh." >&2; exit 1; }
done

mkdir -p "${TRACE_DIR}"
rm -f "${TRACE_DIR}"/*.json

# One OpenMP thread: OpenFHE's PreCompute guards its table cache with
# `#pragma omp critical`, and we want a single deterministic execution order.
export OMP_NUM_THREADS=1

echo "[03] generating traces"
"${TRACED_BIN}" "${DATA_DIR}" | tee "${WORK_DIR}/digest-traced.txt"

echo "[03] running pristine build for the differential check"
pd="${WORK_DIR}/pristine-out"
mkdir -p "${pd}/traces"
"${PRISTINE_BIN}" "${pd}" > "${WORK_DIR}/digest-pristine.txt"

if ! diff -u "${WORK_DIR}/digest-traced.txt" "${WORK_DIR}/digest-pristine.txt" > "${WORK_DIR}/digest.diff"; then
    echo "[03] FATAL: instrumented and pristine builds disagree:" >&2
    head -40 "${WORK_DIR}/digest.diff" >&2
    exit 1
fi
echo "[03] instrumented output is bit-identical to pristine"

python3 "${REPO_ROOT}/tools/03_finalize.py"
echo "[03] OK"
