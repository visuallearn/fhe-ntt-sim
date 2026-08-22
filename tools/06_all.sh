#!/usr/bin/env bash
# Rebuild every byte of docs/data/ from a pinned OpenFHE release, and verify it.
# Any failure anywhere aborts.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

./tools/00_fetch_openfhe.sh
python3 tools/01_patch.py
./tools/02_build.sh
./tools/05_extract_source.py
./tools/03_generate.sh
python3 tools/04_verify.py
python3 tools/10_ste_check.py
python3 tools/11_stamp_assets.py
./tools/07_run_openfhe_tests.sh

# The standalone reference experiments, built out of tree against an installed
# OpenFHE, and compared against the traces the website ships.
./tools/12_install_openfhe.sh
./tools/14_build_gt_exp.sh
python3 tools/13_check_gt.py

echo
echo "[06] everything regenerated and verified."
echo
echo "     Browser-side checks need a server and chromium, so run them separately:"
echo "       python3 tools/serve.py 8777 &"
echo "       python3 tools/08_browser_check.py 8777"
