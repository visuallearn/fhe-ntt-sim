#!/usr/bin/env bash
# Build and install OpenFHE into a local prefix, so openfhe-gt-exp/ can be built
# the way any external project would: find_package(OpenFHE CONFIG REQUIRED).
#
# The flags MUST match tools/02_build.sh, or the reference experiments would
# produce different numbers from the traces on the site.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "${REPO_ROOT}/tools/env.sh"

BUILD_INSTALL="${WORK_DIR}/build-install"
PREFIX="${WORK_DIR}/install"

echo "[12] configuring an install build of OpenFHE ${OPENFHE_TAG}"
cmake -S "${OPENFHE_DIR}" -B "${BUILD_INSTALL}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_COMPILER=g++ \
    -DCMAKE_C_COMPILER=gcc \
    -DCMAKE_INSTALL_PREFIX="${PREFIX}" \
    -DNATIVE_SIZE=64 \
    -DWITH_OPENMP=OFF \
    -DWITH_NATIVEOPT=OFF \
    -DBUILD_SHARED=ON \
    -DBUILD_STATIC=OFF \
    -DBUILD_UNITTESTS=OFF \
    -DBUILD_EXAMPLES=OFF \
    -DBUILD_BENCHMARKS=OFF \
    -DBUILD_EXTRAS=OFF \
    -DGIT_SUBMOD_AUTO=OFF >/dev/null

echo "[12] building (this is the whole library, so it takes a while)"
cmake --build "${BUILD_INSTALL}" -j"${JOBS}"

echo "[12] installing to ${PREFIX}"
cmake --install "${BUILD_INSTALL}" >/dev/null

test -f "${PREFIX}/lib/OpenFHE/OpenFHEConfig.cmake" \
  || test -f "${PREFIX}/lib/cmake/OpenFHE/OpenFHEConfig.cmake" \
  || { echo "[12] FATAL: OpenFHEConfig.cmake not found under ${PREFIX}" >&2
       find "${PREFIX}" -name 'OpenFHEConfig.cmake' >&2; exit 1; }

echo "[12] OK: OpenFHE ${OPENFHE_TAG} installed at ${PREFIX}"
find "${PREFIX}" -name 'OpenFHEConfig.cmake' | sed 's/^/     /'
