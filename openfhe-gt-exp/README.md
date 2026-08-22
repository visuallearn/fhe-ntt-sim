# openfhe-gt-exp — ground-truth NTT experiments

Standalone OpenFHE programs that print, for every parameter set the website
covers: the parameters, the twiddle factor tables, which twiddle factors each
stage uses, the input vector, the output vector, and the result of a negacyclic
product.

They exist so that the data behind the website can be checked by hand, and
reproduced by anyone with an OpenFHE install.

## What makes them useful

- **Nothing is recomputed for display.** Every value comes from OpenFHE, including
  the twiddle tables, which are read out of the static caches that
  `ChineseRemainderTransformFTT::PreCompute` fills.
- **Every value is checked against an independent oracle.** The reports recompute
  each transform by direct `O(N²)` evaluation, in plain integers, with no code
  from OpenFHE. A report says `MATCH` on every line or it says `*** MISMATCH ***`.
- **They are built out of tree.** `find_package(OpenFHE CONFIG REQUIRED)`, exactly
  as any external project would. They share no build system with the generator
  that produced the website's traces.
- **They agree with the website.** `tools/13_check_gt.py` compares
  `expected/DIGEST.txt` against `docs/data/traces/*.json`, line by line.

## Build and run

OpenFHE must be installed somewhere. To install the pinned release into this
repository:

```sh
./tools/12_install_openfhe.sh          # builds and installs into .work/install
./tools/14_build_gt_exp.sh             # builds these programs and runs them all
```

Or by hand, against any OpenFHE install:

```sh
cmake -S . -B build -DCMAKE_PREFIX_PATH=/path/to/openfhe/install
cmake --build build -j
./build/gt_run_all expected
```

The OpenFHE install must have `NATIVE_SIZE=64`. CMake stops with an error
otherwise, because the Shoup constants would differ from the published ones.

## The two programs

| Program | Does |
|---|---|
| `gt_experiment [N bits]` | Runs one experiment and prints the report to stdout. Default `8 5`. Exit status 0 if every check passed, 2 if the parameters are not possible, 3 if a check failed. |
| `gt_run_all [dir]` | Runs every experiment. Writes one report per configuration, plus `DIGEST.txt` and `SUMMARY.txt`. |

```sh
./build/gt_experiment 8 5        # N=8, 5-bit modulus  -> q=17, psi=3
./build/gt_experiment 32 10      # N=32, 10-bit modulus -> q=769
./build/gt_experiment 16 5       # not possible; says why
```

## Files

```
include/ntt_gt_cases.h   the input vectors, the oracles, the number theory.
                         Shared with the trace generator, so the two cannot
                         disagree about what a case is.
include/gt_report.h      the experiment interface
src/gt_report.cpp        the experiment: calls OpenFHE and writes the report
src/gt_experiment.cpp    one experiment to stdout
src/gt_run_all.cpp       every experiment to files
expected/                the committed reports, for reference and for diffing
```

`expected/` is committed on purpose. A reader can look at the numbers without
building anything, and a rebuild that changes a value shows up as a diff.

## What one report contains

```
PARAMETERS                       N, M, q, psi, psi^-1, omega, N^-1, Barrett mu,
                                 with the OpenFHE call that produced each one,
                                 and six checks on them
FORWARD TWIDDLE TABLE            slot, binary slot, bit-reversed slot, the power
                                 of psi, the value, and the Shoup constant
INVERSE TWIDDLE TABLE            the same for psi^-1
CYCLOTOMIC-ORDER INVERSE TABLE   (2^i)^-1 mod q, and which index the inverse
                                 transform reads
FUSED FINAL TWIDDLE              omega1Inv = psi^-(N/2) * N^-1
TWIDDLE FACTORS BY STAGE         which table slots each stage reads, both
                                 directions
EVALUATION POINTS                slot p holds a(psi^(2*brev(p)+1))
CASE <id> x7                     input vector, forward output, inverse output,
                                 the independent oracle for each, the round trip,
                                 and the same output through NativePoly
NEGACYCLIC PRODUCT <id> x3       a, b, NTT(a), NTT(b), the product per slot, the
                                 inverse, and the schoolbook product to compare
```

## Checking the website against these

```sh
python3 tools/13_check_gt.py
```

It compares every parameter, both twiddle tables, the cyclotomic-order inverse
table, the fused twiddle, every input vector, every forward and inverse output,
and every negacyclic product against the JSON the browser downloads.

## Licence

These programs are part of this repository. OpenFHE is a separate work under the
BSD 2-Clause licence.
