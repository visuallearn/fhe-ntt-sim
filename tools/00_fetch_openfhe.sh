#!/usr/bin/env bash
# Fetch OpenFHE at a pinned release tag + commit into .work/openfhe.
# Idempotent: if the tree is already at the pinned commit, does nothing.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "${REPO_ROOT}/tools/env.sh"

if [[ -d "${OPENFHE_DIR}/.git" ]]; then
    have="$(git -C "${OPENFHE_DIR}" rev-parse HEAD)"
    if [[ "${have}" == "${OPENFHE_COMMIT}" ]]; then
        echo "[00] OpenFHE already at ${OPENFHE_TAG} (${OPENFHE_COMMIT:0:12}); skipping clone."
        exit 0
    fi
    echo "[00] ${OPENFHE_DIR} is at ${have:0:12}, expected ${OPENFHE_COMMIT:0:12}; re-cloning." >&2
    rm -rf "${OPENFHE_DIR}"
fi

mkdir -p "${WORK_DIR}"
echo "[00] Cloning OpenFHE ${OPENFHE_TAG} ..."
git clone --depth 1 --branch "${OPENFHE_TAG}" \
    --recurse-submodules --shallow-submodules \
    "${OPENFHE_URL}" "${OPENFHE_DIR}"

have="$(git -C "${OPENFHE_DIR}" rev-parse HEAD)"
if [[ "${have}" != "${OPENFHE_COMMIT}" ]]; then
    echo "[00] FATAL: tag ${OPENFHE_TAG} resolved to ${have}, expected ${OPENFHE_COMMIT}." >&2
    echo "[00] The upstream tag moved. Review the change before updating tools/env.sh." >&2
    exit 1
fi

# The build reads the version straight out of the source tree, never from this script.
grep -E '^set\(OPENFHE_VERSION_(MAJOR|MINOR|PATCH)' "${OPENFHE_DIR}/CMakeLists.txt"

echo "[00] OK: ${OPENFHE_TAG} @ ${OPENFHE_COMMIT:0:12}"
