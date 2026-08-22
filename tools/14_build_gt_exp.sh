#!/usr/bin/env bash
# Build the standalone reference experiments and run them.
#
# openfhe-gt-exp/ is built out of tree against an installed OpenFHE, exactly the
# way any external project would. It shares no build system with the trace
# generator, which is the point: if its numbers match the traces on the site, then
# anyone with an OpenFHE install can reproduce that data.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "${REPO_ROOT}/tools/env.sh"

PREFIX="${WORK_DIR}/install"
EXP="${REPO_ROOT}/openfhe-gt-exp"

if [[ ! -f "${PREFIX}/lib/OpenFHE/OpenFHEConfig.cmake" ]]; then
    echo "[14] OpenFHE is not installed at ${PREFIX}." >&2
    echo "[14] Run ./tools/12_install_openfhe.sh first." >&2
    exit 1
fi

echo "[14] configuring openfhe-gt-exp against ${PREFIX}"
cmake -S "${EXP}" -B "${EXP}/build" -DCMAKE_PREFIX_PATH="${PREFIX}" >/dev/null

echo "[14] building"
cmake --build "${EXP}/build" -j"${JOBS}" >/dev/null

# One OpenMP thread, matching the trace generation, so the order of work is fixed.
export OMP_NUM_THREADS=1
echo "[14] running every experiment"
"${EXP}/build/gt_run_all" "${EXP}/expected"

echo "[14] OK"
echo "     one experiment on its own:  ${EXP}/build/gt_experiment 8 5"
