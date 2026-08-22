# Shared configuration for the trace-generation pipeline. Sourced, not executed.
# Single place where the pinned OpenFHE version lives.

OPENFHE_URL="https://github.com/openfheorg/openfhe-development.git"
OPENFHE_TAG="v1.5.1"
# Pinned so a moved tag is a hard failure rather than a silent change of ground truth.
OPENFHE_COMMIT="1306d14f8c26bb6150d3e6ad54f28dfe1007689e"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${REPO_ROOT}/.work"
OPENFHE_DIR="${WORK_DIR}/openfhe"
BUILD_TRACED="${WORK_DIR}/build-traced"
BUILD_PRISTINE="${WORK_DIR}/build-pristine"

DATA_DIR="${REPO_ROOT}/docs/data"
TRACE_DIR="${DATA_DIR}/traces"
SOURCE_DIR="${DATA_DIR}/source"

# The file that contains the algorithms being visualised.
NTT_IMPL_REL="src/core/include/math/hal/intnat/transformnat-impl.h"
NTT_IMPL="${OPENFHE_DIR}/${NTT_IMPL_REL}"

JOBS="${JOBS:-$(nproc)}"
