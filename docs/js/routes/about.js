// Provenance: exactly where every number came from, and how to reproduce it.

import { h, clear, panel } from '../dom.js';
import { state } from '../store.js';

export function mount(root) {
  clear(root);
  const of = state.manifest.openfhe;
  const man = state.manifest;
  const src = state.source;

  const row = (k, v) => h('tr', {}, h('th', {}, k), h('td', {}, v));

  const opts = Object.entries(of.cmakeOptions || {})
    .map(([k, v]) => `${k}=${v}`).join('  ');

  const matrix = h('table', { class: 'matrix' },
    h('tbody', {},
      h('tr', {}, h('th', {}, 'bits'), ...man.ringDimensions.map((n) => h('th', {}, 'N=' + n))),
      ...man.modulusBits.map((b) => h('tr', {},
        h('th', {}, String(b)),
        ...man.ringDimensions.map((n) => {
          const c = man.configs.find((x) => x.N === n && x.bits === b);
          return c && c.feasible
            ? h('td', {}, String(c.q))
            : h('td', { class: 'no', title: c ? c.reason : '' }, '—');
        })))));

  const nFeas = man.configs.filter((c) => c.feasible).length;

  root.append(h('div', { class: 'route-prose' },
    h('h1', {}, 'How this website was made'),

    h('p', {}, 'This website contains no transform code. It shows recordings of ',
      h('b', {}, 'OpenFHE ' + of.version), '. A build of OpenFHE with observer hooks '
      + 'made these recordings. That build ran over every parameter set below. It wrote '
      + 'every butterfly into a JSON file. The browser shows only the contents of those files.'),

    h('h2', {}, 'The origin of the data'),
    h('table', { class: 'prov' }, h('tbody', {},
      row('OpenFHE version', of.version),
      row('Release tag', h('a', { href: `${of.repo}/releases/tag/${of.tag}`, rel: 'noopener' }, of.tag)),
      row('Commit', h('a', { href: `${of.repo}/commit/${of.commit}`, rel: 'noopener' }, of.commit)),
      row('Algorithm source', h('a', { href: of.sourcePermalink, rel: 'noopener' }, of.sourceFile)),
      row('Source sha256', of.sourceSha256),
      row('Compiler', of.compiler),
      row('NATIVE_SIZE / MATHBACKEND', `${of.nativeInt} / ${of.mathBackend}`),
      row('MAX_MODULUS_SIZE', String(of.maxModulusSize)),
      row('CMake options', opts || '(not recorded)'),
      row('Date of the recordings', man.generatedAtUtc),
      row('Parameter sets', `${nFeas} possible of ${man.configs.length} tested`))),

    h('h2', {}, 'The two functions in the recordings'),
    h('p', {}, 'Both functions are in ', h('code', {}, of.sourceFile), ':'),
    h('ul', {},
      h('li', {}, h('code', {}, 'NumberTheoreticTransformNat::ForwardTransformToBitReverseInPlace'),
        ' — lines ', String(src.forward.startLine), '–', String(src.forward.endLine),
        '. Cooley–Tukey butterflies. The output stays in bit-reversed order.'),
      h('li', {}, h('code', {}, 'NumberTheoreticTransformNat::InverseTransformFromBitReverseInPlace'),
        ' — lines ', String(src.inverse.startLine), '–', String(src.inverse.endLine),
        '. Gentleman–Sande butterflies, then the multiplication by N⁻¹.')),
    h('p', {}, h('code', {}, 'NativePoly::SwitchFormat()'), ' calls these two functions. '
      + 'Every OpenFHE scheme calls ', h('code', {}, 'SwitchFormat()'),
      ' to change a polynomial between the coefficient form and the value form. '
      + 'OpenFHE names these two formats COEFFICIENT and EVALUATION. '
      + 'The generator makes sure that the recorded function and ',
      h('code', {}, 'SwitchFormat()'), ' give the same output. This is therefore the '
      + 'real code path.'),
    h('p', {}, 'There is one modulus everywhere on this website. Real OpenFHE ciphertexts '
      + 'use a residue number system with a chain of moduli. They run this same transform '
      + 'one time for each modulus. Here there is exactly one modulus. No Chinese Remainder '
      + 'Theorem arithmetic hides the transform.'),

    h('h2', {}, 'Modular multiplication: this website and OpenFHE'),
    h('p', {}, 'The working panel shows simple ', h('code', {}, '(a·ω) mod q'),
      '. OpenFHE calculates the same values with two methods that use constants '
      + 'from an earlier calculation:'),
    h('ul', {},
      h('li', {}, h('b', {}, 'Shoup / Harvey precomputed multiplicand'),
        ' (', h('code', {}, 'PrepModMulConst'), ' / ', h('code', {}, 'ModMulFastConstEq'),
        '). Many butterflies use the same twiddle ω. OpenFHE therefore calculates ',
        h('code', {}, '⌊ω·2⁶⁴/q⌋'), ' one time. Each multiplication then needs one '
        + '64-bit multiply-high, two low multiplies, a subtraction and one conditional '
        + 'addition. It needs no division, which is the part that matters. Algorithm 2, '
        + 'lines 5–7 of ',
        h('a', { href: 'https://arxiv.org/abs/1205.2926', rel: 'noopener' },
          'Harvey, “Faster arithmetic for number-theoretic transforms”'),
        ', originally from Shoup’s NTL.'),
      h('li', {}, h('b', {}, 'Barrett reduction'), ' (', h('code', {}, 'ComputeMu'), ') elsewhere.')),
    h('p', {}, 'These methods change the cost, not the result. The traces contain the '
      + 'real constants. You can see them under “Advanced” in the parameters panel, and '
      + 'in the note “How OpenFHE actually multiplies”. The website shows them as '
      + 'reference values, not as animated steps. At this size the 64-bit intermediate '
      + 'values hide the transform instead of explaining it.'),

    h('h2', {}, 'Two methods that make the code faster'),
    h('ul', {},
      h('li', {}, h('b', {}, 'Peeling.'), ' The forward transform writes its last stage as '
        + 'a separate loop. The inverse transform does the same with its first stage. The '
        + 'butterflies are the same, but the code is separate. The code cursor therefore '
        + 'moves to another loop. The dataflow diagram shades those columns.'),
      h('li', {}, h('b', {}, 'The division by N in a twiddle.'), ' The last stage of the '
        + 'inverse transform uses ω₁⁻¹ = ψ⁻ᴺ⁄² · N⁻¹, not a simple power of ψ⁻¹. This '
        + 'twiddle divides the upper half of the array by N. A separate operation then '
        + 'multiplies only the lower half by N⁻¹. See OpenFHE issue ',
        h('a', { href: 'https://github.com/openfheorg/openfhe-development/issues/872', rel: 'noopener' }, '#872'), '.')),
    h('p', {}, 'The source panel shows the GCC arm of the ',
      h('code', {}, '#if defined(__GNUC__) && !defined(__clang__)'),
      ' branch. This build compiled that part, so the recordings come from it. The '
      + 'Clang part gives the same arithmetic. Its purpose is to avoid a problem in the '
      + 'optimizer. The button in that panel shows it.'),

    h('h2', {}, 'Parameter feasibility'),
    h('p', {}, 'OpenFHE selected every modulus here with ',
      h('code', {}, 'LastPrime<NativeInteger>(bits, 2N)'),
      '. This function gives the largest prime below 2', h('sup', {}, 'bits'),
      ' that is ≡ 1 (mod 2N). That prime must also have exactly that number of bits. '
      + 'A dash shows that no such prime exists. That combination is therefore not '
      + 'possible. Four-bit moduli are not possible for any ring dimension here.'),
    h('div', { class: 'panel-scroll' }, matrix),

    h('h2', {}, 'The five tests of the data'),
    h('p', {}, 'The data has five independent tests. All five run in ',
      h('code', {}, 'tools/06_all.sh'), '. Any failure stops the build.'),
    h('ol', {},
      h('li', {}, h('b', {}, 'An independent oracle.'), ' A Python script calculates the '
        + 'modulus, the root of unity, both twiddle tables and both transforms again, from '
        + 'their definitions. It calculates the transforms by direct O(N²) evaluation, with '
        + 'no code from OpenFHE. It then compares the values. It also tests the arithmetic '
        + 'of every butterfly, the slot coverage and stride of every stage, and the source '
        + 'line that each trace event names.'),
      h('li', {}, h('b', {}, 'Two builds from one source tree.'), ' One build has the hooks. '
        + 'The other build does not. The two runs give identical bytes.'),
      h('li', {}, h('b', {}, 'The tests of OpenFHE.'), ' The instrumented build runs the ',
        h('code', {}, 'UTNTT'), ' and ', h('code', {}, 'UTTransform'),
        ' suites of OpenFHE. They pass. They pass only because the hooks are pure observers.'),
      h('li', {}, h('b', {}, 'Values calculated by hand.'), ' A small set of values comes '
        + 'from a calculation by hand, made before any code existed. The set covers N=4 '
        + 'and N=8 at q=17, and includes the state after each stage. The test compares '
        + 'these values directly.'),
      h('li', {}, h('b', {}, 'Standalone reference experiments.'), ' A separate folder holds '
        + 'OpenFHE programs that are built out of tree, against an installed OpenFHE, and '
        + 'share no build system with the generator of these traces. They print the '
        + 'parameters, both tables and every vector for each parameter set. ',
        h('code', {}, 'tools/13_check_gt.py'), ' makes 991 comparisons between their '
        + 'output and the files this page loads.')),

    h('h2', {}, 'How to repeat the build'),
    h('p', {}, 'The build needs g++, CMake 3.16 or later, git, python3 and approximately '
      + '2 GB of disk space. It needs no Node and no npm. The website is plain ES modules. '
      + 'A server sends the files without changes.'),
    h('pre', { class: 'cmd' }, [
      'git clone <this repo> && cd ntt-intt',
      './tools/06_all.sh          # fetch, patch, build, generate, verify',
      '',
      '# or step by step:',
      './tools/00_fetch_openfhe.sh      # clone OpenFHE ' + of.tag + ' at ' + of.commitShort,
      'python3 tools/01_patch.py        # install observer hooks (anchored, checksum-guarded)',
      './tools/02_build.sh              # build instrumented + pristine',
      './tools/05_extract_source.py     # slice the pristine source for the code panel',
      './tools/03_generate.sh           # generate traces + differential check',
      'python3 tools/04_verify.py       # independent verification',
      './tools/07_run_openfhe_tests.sh  # OpenFHE\'s own NTT tests',
      '',
      '# serve over HTTP: a browser blocks modules and fetch on file:// URLs',
      'python3 tools/serve.py 8000',
    ].join('\n')),

    h('h2', {}, 'Citations'),
    h('ul', {}, ...(src.citations.papers || []).map((p) => h('li', {},
      h('a', { href: p.url, rel: 'noopener' }, p.title), ' — ', p.authors,
      h('br', {}), h('span', { class: 'hint' }, p.used_for)))),

    h('h2', {}, 'License'),
    h('p', {}, 'The code panel shows source excerpts from OpenFHE without changes. '
      + 'They are under the BSD 2-Clause license. ',
      h('a', { href: 'data/source/LICENSE-OpenFHE.txt' }, 'The full text is here'),
      '. © 2014–2022 NJIT, Duality Technologies Inc. and other contributors.'),

    panel('Files', null,
      h('p', { class: 'hint' }, 'The files that the browser loads:'),
      h('ul', { class: 'hint' },
        h('li', {}, h('a', { href: 'data/manifest.json' }, 'data/manifest.json'),
          ' — parameters and provenance'),
        h('li', {}, 'data/traces/*.json — ', String(nFeas), ' trace files, one per parameter set'),
        h('li', {}, h('a', { href: 'data/source/forward.json' }, 'data/source/*.json'),
          ' — the OpenFHE source excerpts'),
        h('li', {}, h('a', { href: 'data/tour.json' }, 'data/tour.json'), ' — the tour text')))));

  return { unmount() {}, keys() { return false; } };
}
