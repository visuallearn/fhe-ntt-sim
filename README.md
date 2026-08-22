# NTT / INTT Explorer

A step-by-step visual simulation of the **forward and inverse Number Theoretic
Transform** exactly as **OpenFHE 1.5.1** computes them, for ring dimensions
N = 4, 8, 16 and 32 over small single moduli (5–10 bits), so the whole thing can
be followed by hand.

It is a static site. Open it, pick a configuration, and step through one
butterfly at a time with the real OpenFHE source alongside.

## What it is not

It is not a re-implementation. The browser contains **no NTT code at all**. Every
value on screen was recorded from an instrumented build of OpenFHE
v1.5.1 (`1306d14f8c26`) and shipped as JSON; the page is a replayer.

## Views

| Route | What it shows |
|---|---|
| `#/tour` | A twelve-step guided tour, written for someone meeting the NTT for the first time. Every figure pulls its numbers from the real traces. |
| `#/transform` | The main view. Dataflow diagram, in-place array, twiddle table, the arithmetic of the current step, and the OpenFHE source with the cursor on the line being executed. |
| `#/roots` | Where the evaluation points come from, and why the modulus must satisfy q ≡ 1 (mod 2N). |
| `#/convolution` | Why any of this exists: polynomial multiplication the slow way versus via the transform. |
| `#/about` | Full provenance, the verification story, and how to reproduce every byte of `docs/data/`. |

Deep links carry state, e.g.
`#/transform?N=32&bits=8&case=random&dir=inverse&step=60`.

Keyboard: `←`/`→` step, `↑`/`↓` stage, `Space` play/pause, `Home`/`End`,
`f`/`i` switch direction.

## Hosting

Zero build step. No `npm`, no bundler, no CI required.

1. Push this repository to GitHub.
2. **Settings → Pages → Deploy from a branch**, branch `main`, folder `/docs`.

`docs/.nojekyll` is present so Pages serves the files as they are. Every asset
path is relative, so the site works under `https://<user>.github.io/<repo>/`.

To preview locally (`file://` will not work — browsers block ES modules and
`fetch` from it):

```sh
python3 tools/serve.py 8000
```

This server sends `Cache-Control: no-store`. `python3 -m http.server` does not,
and a browser can then keep an edited stylesheet in cache while it loads the new
JS, which makes the page look broken.

`docs/selftest.html` re-verifies every shipped trace in the browser and prints a
pass/fail table. Worth opening after regenerating data.

## Regenerating the data

Needs g++, CMake ≥ 3.16, git, python3 and about 2 GB of disk.

```sh
./tools/06_all.sh
```

That runs, and fails loudly on any problem:

| Step | Does |
|---|---|
| `00_fetch_openfhe.sh` | Clones OpenFHE at the pinned tag **and** commit; a moved tag is a hard error. |
| `01_patch.py` | Installs trace hooks by anchored text insertion, guarded by a sha256 of the pristine file. Every anchor must match exactly once. |
| `02_build.sh` | Builds the same source tree twice: instrumented and pristine. |
| `05_extract_source.py` | Slices the **pristine** source (from `git show`) for the code panel, locating ranges by anchor text and asserting them against the line numbers the hooks use. |
| `03_generate.sh` | Runs the generator, then diffs the pristine build's output against it. |
| `04_verify.py` | Independent verification (see below). |
| `11_stamp_assets.py` | Stamps a content version onto the stylesheet links and generates an import map so every JS module URL carries it. Without this, a returning visitor can get new JS against a cached old stylesheet. `--check` fails if the stamp is out of date. |
| `10_ste_check.py` | Checks the user-facing prose against the structural rules of ASD-STE100: sentence length, banned modals, semicolons, contractions, phrasal verbs, one term per concept, American spelling. |
| `12_install_openfhe.sh` | Installs the pinned OpenFHE into `.work/install`, with the same flags as the trace build, so `openfhe-gt-exp/` can link against it the way any external project would. |
| `14_build_gt_exp.sh` | Builds the standalone reference experiments in `openfhe-gt-exp/` and runs all of them. |
| `13_check_gt.py` | Compares the reference experiments against `docs/data/traces/*.json`, value by value. |
| `07_run_openfhe_tests.sh` | Runs OpenFHE's own `UTNTT` and `UTTransform` suites against the instrumented build. |

The OpenFHE version is pinned in one place: `tools/env.sh`.

Browser-side checks need a server and chromium, so they run separately:

```sh
python3 tools/serve.py 8777 &
python3 tools/08_browser_check.py 8777
```

That runs four groups:

| Group | Checks |
|---|---|
| `data` | Every shipped trace re-verified in the browser (`docs/selftest.html`): butterfly arithmetic, stage coverage and strides, keyframes, round trips, convolutions. |
| `layout` | No horizontal page overflow, across six viewport widths and six routes. |
| `interact` | Transport controls, keyboard shortcuts, playback, every picker, every route, every tour step. |
| `audit` | Store-subscription leaks across route remounts, toggle state, malformed and out-of-range deep links, browser history, racing configuration clicks. |

The `interact` and `audit` harnesses drive the real app inside a same-origin
iframe by dispatching real events. They and the layout probe live in
`tools/browser-checks/` and are copied into `docs/` only while the check runs, so
they are never published.

Tested in Chromium only — no other browser was available on the machine this was
built on. Nothing exotic is used (dynamic `import()`, `display: contents`,
`paint-order`, `Array.flat`), so Firefox and Safari should be fine, but that is
an expectation rather than a measurement.

## Reference experiments

`openfhe-gt-exp/` holds standalone OpenFHE programs that print, for every
parameter set on the site, everything the transform used and everything it
produced: the parameters, both twiddle factor tables, which twiddle factors each
stage reads, the input vector, the output vector, and a negacyclic product.

They are for reference and for checking. Anyone can read
`openfhe-gt-exp/expected/*.txt` without building anything, or rebuild them and
diff.

```sh
./tools/12_install_openfhe.sh    # install OpenFHE into .work/install
./tools/14_build_gt_exp.sh       # build the experiments and run all 18
python3 tools/13_check_gt.py     # compare them against the site's traces

./openfhe-gt-exp/build/gt_experiment 8 5     # one experiment to stdout
```

They are built out of tree with `find_package(OpenFHE CONFIG REQUIRED)`, sharing
no build system with the trace generator. Both include one header,
`openfhe-gt-exp/include/ntt_gt_cases.h`, which is the single definition of the
input vectors and the independent oracles — so the reference reports and the
shipped traces cannot disagree about what a case is.

`tools/13_check_gt.py` makes 991 comparisons across the 18 configurations:
parameters, both twiddle tables, the cyclotomic-order inverse table, the fused
final twiddle, every input vector, every forward and inverse output, and every
negacyclic product. See `openfhe-gt-exp/README.md`.

## Why you can trust the numbers

Five independent checks, all wired into `06_all.sh`:

1. **An independent oracle** (`tools/04_verify.py`, Python stdlib only) re-derives
   the modulus, the root of unity, both twiddle tables and both transforms from
   their definitions — the transforms by direct O(N²) evaluation, sharing no code
   with OpenFHE — and compares. It also re-checks every butterfly's arithmetic,
   that each stage covers every index exactly once with the documented stride,
   and that every source line a trace points at still contains the code it claims.
2. **A differential build.** One source tree, built with and without the hooks.
   The two runs must produce byte-identical output. They do.
3. **OpenFHE's own tests** pass on the instrumented build. If the hooks were
   anything but pure observers, they would not.
4. **Hand-computed golden vectors.** A set of values for N=4 and N=8 at q=17,
   including intermediate stage states, worked out by hand from the algorithm
   before any code was written, asserted literally.
5. **Standalone reference experiments.** `openfhe-gt-exp/`, built out of tree
   against an installed OpenFHE, produces the same parameters, tables and vectors
   independently of the trace generator. `tools/13_check_gt.py` compares them
   against the shipped JSON.

## What is faithful, and what is simplified

Faithful: the parameters (chosen by OpenFHE's own `LastPrime` and `RootOfUnity`),
the bit-reversed twiddle tables, the merged negacyclic twist, every butterfly and
its operands, the stage structure including OpenFHE's peeled first/last stages,
the fused `ψ^-(N/2)·N⁻¹` twiddle in the inverse's final stage, the bit-reversed
output ordering, and the source line executed at each step.

Simplified, deliberately: modular multiplication is shown as textbook
`(a·ω) mod q`. OpenFHE reaches the same values using Shoup/Harvey precomputed
multiplicands and Barrett reduction. Those are reduction *techniques* — the
arithmetic result is identical — and at this scale their 64-bit intermediates
obscure the transform rather than explain it. The real precomputed constants are
shipped in the traces and shown as reference values in the parameters panel and
in the "How OpenFHE actually multiplies" note.

Single modulus throughout. Real OpenFHE ciphertexts use an RNS chain and run this
same transform once per modulus; here there is exactly one.

## Layout

```
docs/                     the site (GitHub Pages root)
  index.html  selftest.html
  css/  js/  js/views/  js/routes/
  data/manifest.json      parameters + provenance
  data/traces/*.json      18 trace files, one per feasible (N, bits)
  data/source/*.json      verbatim OpenFHE source excerpts + BSD-2-Clause text
  data/tour.json          tour copy, editable without touching code
openfhe-gt-exp/           standalone reference experiments (see its README)
  include/ntt_gt_cases.h  the input vectors and oracles, shared with the generator
  expected/               the committed reports, one per parameter set
tools/                    the generation pipeline (00 … 14)
tools/openfhe-src/        the hook header and the trace generator
.work/                    scratch: OpenFHE checkout, build trees, install prefix
                          (git-ignored)
```

## Licence and citations

Site code: see `LICENSE`.

The source excerpts rendered in the code panel are taken verbatim from OpenFHE
and used under the **BSD 2-Clause** licence — full text in
`docs/data/source/LICENSE-OpenFHE.txt`.
© 2014–2022 NJIT, Duality Technologies Inc. and other contributors.

- Longa & Naehrig, [*Speeding up the Number Theoretic Transform for Faster Ideal
  Lattice-Based Cryptography*](https://eprint.iacr.org/2016/504) — Algorithms 1
  and 2, which OpenFHE cites directly for these two functions.
- Harvey, [*Faster arithmetic for number-theoretic
  transforms*](https://arxiv.org/abs/1205.2926) — Algorithm 2, lines 5–7: the
  precomputed-multiplicand modular multiplication.
- [OpenFHE issue #872](https://github.com/openfheorg/openfhe-development/issues/872)
  — why the inverse transform's last twiddle carries the ÷N.
