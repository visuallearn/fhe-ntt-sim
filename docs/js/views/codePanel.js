// The actual OpenFHE source, with the cursor on the line being executed.
//
// The text is the pristine upstream file, verbatim, with its real line numbers.
// The instrumentation that produced the trace lives in a patched copy and is not
// shown, because it is not part of the algorithm.

import { h, clear, panel } from '../dom.js';
import { set } from '../store.js';

export function make() {
  const el = h('div', { class: 'p-code' });
  let lineEls = new Map();
  let scroller = null;
  let varsEl = null;
  let lastLine = -1;

  function build(vm) {
    clear(el);
    lineEls = new Map();
    lastLine = -1;
    const doc = vm.state.dir === 'forward' ? vm.source.forward : vm.source.inverse;
    const of = vm.manifest.openfhe;

    const code = h('div', { class: 'code' });
    for (const ln of doc.lines) {
      const variant = ln.v || null;
      // The GCC arm of the #if is the one this build compiled and the one the
      // trace came from; the Clang arm is equivalent arithmetic written to dodge
      // an optimiser problem, and is hidden unless asked for.
      const hide = variant === 'clang' && !vm.state.showClang;
      const row = h('span', {
        class: 'ln'
          + (variant === 'pp' ? ' pp' : '')
          + (variant === 'clang' ? ' dim' : ''),
        style: hide ? 'display:none' : '',
      }, h('span', { class: 'n' }, String(ln.n)), h('span', { class: 't' }, ln.t || ' '));
      code.append(row);
      lineEls.set(ln.n, row);
    }

    scroller = h('div', { class: 'code-scroll' }, code);

    const fn = vm.state.dir === 'forward'
      ? 'ForwardTransformToBitReverseInPlace' : 'InverseTransformFromBitReverseInPlace';
    const crumb = h('div', { class: 'code-crumb' }, h('ol', {},
      h('li', {}, 'NativePoly::SwitchFormat()'),
      h('li', {}, 'ChineseRemainderTransformFTT::' + fn + '()'),
      h('li', {}, 'PreCompute()  — builds the twiddle tables'),
      h('li', {}, 'NumberTheoreticTransformNat::' + fn + '()')));

    varsEl = h('div', { class: 'code-vars' });

    const docComment = (vm.source.citations
      && (vm.state.dir === 'forward' ? vm.source.citations.forwardDoc : vm.source.citations.inverseDoc)) || '';

    const clangToggle = h('button', {
      type: 'button', 'aria-pressed': String(vm.state.showClang),
      onclick: () => set({ showClang: !vm.state.showClang }),
    }, 'show the Clang branch');

    el.append(panel('OpenFHE source',
      h('span', { class: 'badge', id: 'code-region' }, ''),
      crumb,
      docComment ? h('details', { class: 'note' },
        h('summary', {}, 'What OpenFHE says this function is'),
        h('pre', { class: 'code-doc' }, docComment)) : null,
      scroller,
      varsEl,
      h('div', { style: 'margin-top:.45rem' }, clangToggle),
      h('p', { class: 'code-foot' },
        doc.file, ' lines ', String(doc.startLine), '–', String(doc.endLine), ' · OpenFHE ',
        of.version, ' @ ', h('a', { href: doc.permalink, rel: 'noopener' }, of.commitShort),
        ' · sha256 ', doc.sourceSha256.slice(0, 12), '…',
        h('br', {}),
        '© 2014–2022 NJIT, Duality Technologies Inc. and other contributors. ',
        h('a', { href: 'data/source/LICENSE-OpenFHE.txt' }, 'BSD 2-Clause'), '.')));
  }

  function update(vm) {
    const ev = vm.ev;
    const line = ev ? ev.line : -1;

    const badge = el.querySelector('#code-region');
    if (badge) {
      const r = vm.ctx.region;
      badge.textContent = { main: 'main loop', inner: 'inner stages',
        peeledFirst: 'peeled first stage', peeledLast: 'peeled last stage',
        scale: 'n⁻¹ scaling' }[r] || '';
      badge.className = 'badge ' + (r === 'main' || r === 'inner' ? 'main' : 'peeled');
    }

    if (line !== lastLine) {
      if (lineEls.has(lastLine)) lineEls.get(lastLine).classList.remove('cur');
      const row = lineEls.get(line);
      if (row) {
        row.classList.add('cur');
        // Centre the cursor inside its own scroller only -- never scroll the page.
        const r = row.getBoundingClientRect();
        const sc = scroller.getBoundingClientRect();
        scroller.scrollTop += (r.top - sc.top) - scroller.clientHeight / 2 + r.height / 2;
      }
      lastLine = line;
    }

    // Loop variables. Only what the trace actually records, plus i, which the
    // source defines as indexOmega - m.
    clear(varsEl);
    const c = vm.ctx;
    const pairs = [];
    if (c.m !== null && !c.scaling) pairs.push(['m', c.m]);
    if (c.twIndex !== null && c.m !== null && !c.fused) pairs.push(['i', c.twIndex - c.m]);
    if (c.t !== null && !c.scaling) pairs.push(['t', c.t]);
    if (c.logt !== null && !c.scaling) pairs.push(['logt', c.logt]);
    if (c.twIndex !== null) pairs.push(['indexOmega', c.fused ? '— (fused ω₁⁻¹)' : c.twIndex]);
    if (c.tw !== null) pairs.push(['omega', c.tw]);
    if (c.lo !== null) pairs.push([c.scaling ? 'i' : 'j1', c.lo]);
    if (c.hi !== null) pairs.push(['j1+t', c.hi]);
    for (const [k, v] of pairs) {
      varsEl.append(h('span', {}, h('b', {}, k + '='), String(v)));
    }
  }

  return { el, build, update };
}
