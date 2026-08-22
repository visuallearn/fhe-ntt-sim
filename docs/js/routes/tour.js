// Guided tour. Prose lives in data/tour.json so it can be edited without
// touching code; the figures are small purpose-built views that pull their
// numbers out of the loaded trace, so nothing in the narration is invented.

import { h, s, clear, panel, frag } from '../dom.js';
import { state, set, on } from '../store.js';
import { caseOf, convOf } from '../traceLoader.js';
import { bin, brev, sup } from '../fmt.js';

let tour = null;

function subs(p, t) {
  const N = p.N;
  const map = {
    N: N, M: p.M, q: p.q, psi: p.psi, psiInv: p.psiInv, nInv: p.nInv,
    negOne: p.negOne, logN: p.logN, halfN: N / 2, NN: N * N, Nm1: N - 1,
    totalBf: (N / 2) * p.logN, cofactor: (p.q - 1) / p.M,
    firstStride: N / 2, secondStride: N / 4,
    bin1: bin(1, p.brevBits), brev1: brev(1, p.brevBits),
    brev1bin: bin(brev(1, p.brevBits), p.brevBits),
    tw1: t.fwd[1].v,
  };
  return (str) => str
    .replace(/\{\{(\w+)\}\}/g, (_, k) => (k in map ? String(map[k]) : `{{${k}}}`))
    // Typographic minus, not a hyphen, for values and exponents.
    .replace(/(^|[\s(=])-(?=\d)/g, '$1\u2212');
}

/** Tiny inline markup: **bold**, `code`, *em*, and `x^7` as a superscript. */
function rich(str) {
  const out = h('p', {});
  // Placeholders have already been substituted, so exponents are plain digits.
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\^-?\d+)/g;
  let last = 0; let m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) out.append(str.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.append(h('b', {}, tok.slice(2, -2)));
    else if (tok.startsWith('`')) out.append(h('code', {}, tok.slice(1, -1)));
    else if (tok.startsWith('^')) out.append(h('sup', {}, tok.slice(1).replace('-', '\u2212')));
    else out.append(h('em', {}, tok.slice(1, -1)));
    last = re.lastIndex;
  }
  if (last < str.length) out.append(str.slice(last));
  return out;
}

// ------------------------------------------------------------------ figures

function figPolymul(p) {
  const N = Math.min(p.N, 8);
  const rows = [];
  for (let i = 0; i < N; i++) {
    const cells = [h('th', {}, 'a' + sup(i))];
    for (let j = 0; j < N; j++) {
      cells.push(h('td', { class: i + j >= N ? 'wrap' : '' }, 'a' + sup(i) + 'b' + sup(j)));
    }
    rows.push(h('tr', {}, ...cells));
  }
  return h('div', {},
    h('div', { class: 'panel-scroll' },
      h('table', { class: 'school' },
        h('thead', {}, h('tr', {}, h('th', {}, ''),
          ...Array.from({ length: N }, (_, j) => h('th', {}, 'b' + sup(j))))),
        h('tbody', {}, ...rows))),
    h('div', { class: 'school-legend' },
      h('span', { class: 'plain' }, `the degree i+j is less than ${N}`),
      h('span', {}, `the degree i+j is ${N} or more`)),
    h('p', { class: 'hint' }, `Each cell is one multiplication. There are ${N} × ${N} = ${N * N} cells.`
      + (p.N > 8 ? ` (This figure shows N=8. Your configuration is N=${p.N}.)` : '')),
    h('p', { class: 'hint' }, `The shaded cells go past the top degree of the result. `
      + `Step 2 explains what happens to them.`));
}

function figWrap(p, trace) {
  const cv = trace.convolutions.find((c) => c.id === 'wrap') || trace.convolutions[0];
  return h('div', {},
    h('div', { class: 'vecline' }, h('b', {}, 'a(X) ='), 'X' + sup(p.N - 1)),
    h('div', { class: 'vecline' }, h('b', {}, 'b(X) ='), 'X'),
    h('div', { class: 'vecline' }, h('b', {}, 'a·b  ='), 'X' + sup(p.N)
      + ' , which is −1 , which is ' + (p.q - 1) + ' mod ' + p.q),
    h('div', { class: 'vecline' }, h('b', {}, 'result ='), '[ ' + cv.schoolbook.join(', ') + ' ]'),
    h('p', { class: 'hint' }, 'The result has one coefficient, in slot 0, equal to −1.'));
}

function figPipeline(p) {
  // Three transforms, on three rows, read left to right. An earlier version drew
  // b-hat with no row that produced it, which made the second polynomial look
  // free and contradicted the operation count below (that count includes three
  // transforms) and the text of this step (which says three conversions).
  const box = (t2, on2) => h('span', { class: 'box' + (on2 ? ' on' : '') }, t2);
  const arrow = () => h('span', { class: 'arrow' }, '→');
  // Every multiplication, including the trailing pass by N^-1 in the inverse
  // transform. The simulator animates those steps, so the total counts them.
  const perTransform = (p.N / 2) * p.logN;
  const mulsButterfly = 3 * perTransform;
  const mulsScale = p.N / 2;
  const total = mulsButterfly + p.N + mulsScale;
  return h('div', {},
    h('div', { class: 'pipe' }, box('a'), arrow(), box('NTT', true), arrow(), box('â')),
    h('div', { class: 'pipe' }, box('b'), arrow(), box('NTT', true), arrow(), box('b̂')),
    h('div', { class: 'pipe' },
      box('â · b̂'), arrow(), box('ĉ'), arrow(), box('INTT', true), arrow(), box('c = a·b')),
    h('div', { class: 'opcount' },
      h('div', { class: 'slow' }, h('span', { class: 'big' }, String(p.N * p.N)),
        'direct'),
      h('div', { class: 'fast' }, h('span', { class: 'big' }, String(total)),
        `${mulsButterfly} in butterflies + ${p.N} products + ${mulsScale} by N⁻¹`)));
}

function modPow(b, e, q) {
  let r = 1; let bb = b % q;
  for (let i = 0; i < e; i++) r = (r * bb) % q;
  return r;
}

function figCircle(p) {
  const R = 118, C = 148;
  const g = s('g', {});
  g.append(s('circle', { class: 'ring', cx: C, cy: C, r: R }));
  for (let k = 0; k < p.M; k++) {
    const a = (-Math.PI / 2) + (2 * Math.PI * k) / p.M;
    const x = C + R * Math.cos(a); const y = C + R * Math.sin(a);
    const v = modPow(p.psi, k, p.q);
    const odd = k % 2 === 1;
    const cls = k === 0 ? 'one' : (k === p.N ? 'neg' : (odd ? 'odd' : 'even'));
    g.append(s('circle', { class: 'pt ' + cls, cx: x, cy: y, r: odd ? 5 : 3.5 }));
    g.append(s('text', {
      class: 'lab' + (odd ? ' odd' : ''), x: C + (R + 15) * Math.cos(a), y: C + (R + 15) * Math.sin(a) + 3,
      'text-anchor': Math.abs(Math.cos(a)) < 0.25 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end'),
    }, String(v)));
  }
  g.append(s('text', { class: 'cap', x: C, y: C, 'text-anchor': 'middle' }, `ψ=${p.psi} mod ${p.q}`));
  return h('div', {},
    s('svg', { width: 2 * C, height: 2 * C, viewBox: `0 0 ${2 * C} ${2 * C}`, class: 'circle' }, g),
    h('p', { class: 'hint' }, 'Purple shows the odd powers, which are the evaluation '
      + `points. Orange at the bottom shows ψ${sup(p.N)} = ${p.negOne} = −1.`),
    h('p', {}, h('a', { href: `#/roots?N=${p.N}&bits=${p.bits}` }, 'See the complete figure, with the subgroup →')));
}

function figPsiPow(p) {
  const cells = [];
  for (let k = 0; k < p.M; k++) {
    const v = modPow(p.psi, k, p.q);
    cells.push(h('i', {
      class: k === p.N ? 'sub' : (k % 2 === 1 ? '' : ''),
      style: k === p.N ? 'border-color:var(--warn);background:var(--warn-soft);color:var(--warn)'
        : (k % 2 ? 'border-color:var(--twiddle);color:var(--twiddle);font-weight:700' : ''),
      title: `ψ^${k} = ${v}`,
    }, String(v)));
  }
  return h('div', {},
    h('div', { class: 'ladder' }, ...cells),
    h('p', { class: 'hint' }, `The values go from ψ⁰ to ψ${sup(p.M - 1)}, left to right. `
      + `Purple shows the odd powers (the evaluation points). Orange shows ψ${sup(p.N)} = −1.`));
}

function figTable(p, t) {
  const body = t.fwd.map((e, j) => h('tr', { class: j === 1 ? 'active' : '' },
    h('td', {}, String(j)),
    h('td', {}, bin(j, p.brevBits)),
    h('td', {}, bin(e.brev, p.brevBits)),
    h('td', {}, 'ψ' + sup(e.exp)),
    h('td', { class: 'v' }, String(e.v))));
  return h('div', { class: 'panel-scroll' },
    h('table', { class: 'tw-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'slot j'), h('th', {}, 'j in binary'),
        h('th', {}, 'reversed'), h('th', {}, 'power'), h('th', {}, 'value'))),
      h('tbody', {}, ...body)));
}

function figButterfly(p, trace) {
  // Use a real butterfly out of the real trace rather than a made-up example.
  const c = caseOf(trace, 'ramp') || trace.cases[0];
  const ev = c.forward.events.find((e) => e.k === 'bfly_ct' && e.u !== 0 && e.v !== 0)
    || c.forward.events.find((e) => e.k === 'bfly_ct');
  const W = 300, H = 108;
  const g = s('g', {});
  const x0 = 46, x1 = 250, ya = 30, yb = 80;
  const edge = (a, b2, mul) => s('path', {
    class: 'edge' + (mul ? ' mul' : '') + ' settled',
    d: `M${x0 + 18} ${a} C${x0 + 60} ${a} ${x1 - 60} ${b2} ${x1 - 18} ${b2}`,
  });
  g.append(edge(ya, ya, false), edge(yb, ya, true), edge(ya, yb, false), edge(yb, yb, true));
  const node = (x, y, v, cls) => s('g', {},
    s('rect', { class: 'node ' + cls, x: x - 18, y: y - 9, width: 36, height: 18, rx: 3 }),
    s('text', { class: 'nval ' + cls, x, y: y + 1 }, String(v)));
  g.append(node(x0, ya, ev.u, 'settled'), node(x0, yb, ev.v, 'settled'),
    node(x1, ya, ev.outLo, 'active'), node(x1, yb, ev.outHi, 'active'));
  g.append(s('text', { class: 'twlab', x: (x0 + x1) / 2, y: (ya + yb) / 2 - 3, 'text-anchor': 'middle' },
    '×ω = ' + ev.tw));
  g.append(s('text', { class: 'rowlab', x: x0 - 24, y: ya + 3 }, 'u'),
    s('text', { class: 'rowlab', x: x0 - 24, y: yb + 3 }, 'v'));
  g.append(s('text', { class: 'col-sub', x: x1 + 24, y: ya + 3 }, 'u+vω'),
    s('text', { class: 'col-sub', x: x1 + 24, y: yb + 3 }, 'u−vω'));

  return h('div', {},
    s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'flow' }, g),
    h('div', { class: 'math-lines' },
      h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'v·ω'),
        h('span', { class: 'm' }, `${ev.v} · ${ev.tw} = ${ev.v * ev.tw} = ${ev.prod} mod ${p.q}`)),
      h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'u + v·ω'),
        h('span', { class: 'm' }, `${ev.u} + ${ev.prod} = ${ev.outLo} mod ${p.q}`)),
      h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'u − v·ω'),
        h('span', { class: 'm' }, `${ev.u} − ${ev.prod} = ${ev.outHi} mod ${p.q}`))),
    h('p', { class: 'hint' }, 'These values come from a recorded trace. This is butterfly '
      + `(${ev.lo}, ${ev.hi}) of the "ramp" input at N=${p.N}, q=${p.q}.`));
}

function figStages(p) {
  return h('div', {},
    h('table', { class: 'slotmap' },
      h('thead', {}, h('tr', {}, h('th', {}, 'stage'), h('th', {}, 'pairs slots'),
        h('th', {}, 'butterflies'))),
      h('tbody', {}, ...Array.from({ length: p.logN }, (_, k) => h('tr', {},
        h('td', {}, String(k + 1)),
        h('td', {}, `(i, i+${p.N / Math.pow(2, k + 1)})`),
        h('td', {}, String(p.N / 2)))))),
    h('p', {}, h('a', { href: `#/transform?N=${p.N}&bits=${p.bits}&case=ramp&dir=forward&step=0` },
      'See all ' + (p.N / 2) * p.logN + ' butterflies →')));
}

function figBitrev(p, trace) {
  const c = caseOf(trace, 'delta1') || trace.cases[0];
  return h('div', {},
    h('div', { class: 'panel-scroll' },
      h('table', { class: 'slotmap' },
        h('thead', {}, h('tr', {}, h('th', {}, 'slot p'), h('th', {}, 'p in binary'),
          h('th', {}, 'reversed'), h('th', {}, 'exponent 2·brev(p)+1'), h('th', {}, 'point'))),
        h('tbody', {}, ...c.evalPoints.map((e) => h('tr', {},
          h('td', {}, String(e.slot)),
          h('td', {}, bin(e.slot, p.brevBits)),
          h('td', {}, bin(e.brev, p.brevBits)),
          h('td', {}, String(e.exp)),
          h('td', { class: 'pt' }, 'ψ' + sup(e.exp) + ' = ' + e.point)))))),
    h('p', { class: 'hint' }, 'The exponent column, from the top: '
      + c.evalPoints.map((e) => e.exp).join(', ') + '. These values are not in numerical order.'));
}

function figGs(p, trace) {
  const c = caseOf(trace, 'ramp') || trace.cases[0];
  const ev = c.inverse.events.find((e) => e.k === 'bfly_gs' && e.u !== 0 && e.v !== 0 && !e.fused)
    || c.inverse.events.find((e) => e.k === 'bfly_gs');
  return h('div', { class: 'math-lines' },
    h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'u, v'),
      h('span', { class: 'm' }, `${ev.u}, ${ev.v}`)),
    h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'ω'),
      h('span', { class: 'm m-tw' }, String(ev.tw))),
    h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, 'u + v'),
      h('span', { class: 'm' }, `${ev.u} + ${ev.v} = ${ev.sum} mod ${p.q}`)),
    h('div', { class: 'math-line' }, h('span', { class: 'lbl' }, '(u−v)·ω'),
      h('span', { class: 'm' }, `${ev.diff} · ${ev.tw} = ${ev.diff * ev.tw} = ${ev.outHi} mod ${p.q}`)),
    h('p', { class: 'hint' }, 'These values come from the recorded inverse trace. In step 7 '
      + 'the multiplication is on v. Here it is on the difference.'));
}

function figRoundtrip(trace) {
  const c = caseOf(trace, 'ramp') || trace.cases[0];
  return h('div', {},
    h('div', { class: 'vecline' }, h('b', {}, 'start   '), '[ ' + c.input.join(', ') + ' ]'),
    h('div', { class: 'vecline' }, h('b', {}, 'NTT     '), '[ ' + c.forward.expected.join(', ') + ' ]'),
    h('div', { class: 'vecline' }, h('b', {}, 'INTT    '), '[ ' + c.inverse.expected.join(', ') + ' ]'),
    h('p', { class: 'params-check' }, c.roundTripOk
      ? '✓ The result equals the start exactly. This test passes for every input in every configuration.'
      : 'The values are different.'));
}

function figPayoff(p, trace) {
  const cv = convOf(trace, 'random') || trace.convolutions[0];
  return h('div', {},
    h('div', { class: 'vecline' }, h('b', {}, 'a       '), '[ ' + cv.a.join(', ') + ' ]'),
    h('div', { class: 'vecline' }, h('b', {}, 'b       '), '[ ' + cv.b.join(', ') + ' ]'),
    h('div', { class: 'vecline' }, h('b', {}, 'a·b     '), '[ ' + cv.product.join(', ') + ' ]'),
    h('div', { class: 'opcount' },
      h('div', { class: 'slow' }, h('span', { class: 'big' }, String(cv.opsSchoolbook)), 'direct'),
      h('div', { class: 'fast' }, h('span', { class: 'big' }, String(cv.opsNtt)),
        'through the transform')),
    h('p', {}, h('a', { href: `#/convolution?N=${p.N}&bits=${p.bits}&conv=random` },
      'Compare the two methods →')));
}

const FIGS = {
  polymul: (p) => figPolymul(p),
  wrap: (p, t, tr) => figWrap(p, tr),
  pipeline: (p) => figPipeline(p),
  circle: (p) => figCircle(p),
  psipow: (p) => figPsiPow(p),
  table: (p, t) => figTable(p, t),
  butterfly: (p, t, tr) => figButterfly(p, tr),
  stages: (p) => figStages(p),
  bitrev: (p, t, tr) => figBitrev(p, tr),
  gs: (p, t, tr) => figGs(p, tr),
  roundtrip: (p, t, tr) => figRoundtrip(tr),
  payoff: (p, t, tr) => figPayoff(p, tr),
};

export function mount(root) {
  clear(root);
  const host = h('div', { class: 'tour' });
  root.append(host);

  function render() {
    if (!tour) return;
    const trace = state.trace;
    const p = trace.params;
    const sub = subs(p, trace.tables);
    const i = Math.max(0, Math.min(state.tourStep, tour.steps.length - 1));
    const st = tour.steps[i];
    clear(host);

    const dots = h('div', { class: 'tour-dots' });
    tour.steps.forEach((s2, k) => dots.append(h('button', {
      type: 'button', title: `${k + 1}. ${sub(s2.title)}`,
      'aria-current': String(k === i), 'aria-label': `Step ${k + 1}: ${sub(s2.title)}`,
      onclick: () => set({ tourStep: k }),
    }, String(k + 1))));

    const nav = h('div', { class: 'tour-nav' },
      h('button', { type: 'button', disabled: i === 0 ? true : null, onclick: () => set({ tourStep: i - 1 }) }, '← Back'),
      h('button', {
        type: 'button', disabled: i === tour.steps.length - 1 ? true : null,
        onclick: () => set({ tourStep: i + 1 }),
      }, 'Next →'),
      dots);

    const fig = FIGS[st.fig];
    host.append(
      h('div', { class: 'tour-count' }, `Step ${i + 1} of ${tour.steps.length}`
        + `  ·  the examples use N = ${p.N}, q = ${p.q}, ψ = ${p.psi}`),
      h('article', { class: 'tour-step' },
        h('h2', {}, sub(st.title)),
        ...st.body.map((b) => rich(sub(b))),
        fig ? h('div', { class: 'tour-fig' }, h('h4', {}, 'The figure'), fig(p, trace.tables, trace)) : null),
      nav,
      // frag() drops nulls; a bare null here would print the text "null".
      frag(i === 0 ? h('p', { class: 'hint' }, 'Use ← and → to move through the tour.') : null));
  }

  (async () => {
    if (!tour) {
      const r = await fetch('data/tour.json', { cache: 'no-cache' });
      tour = await r.json();
    }
    render();
  })();

  const unsubs = [on('structure', () => { if (state.route === 'tour') render(); })];

  return {
    unmount() { for (const off of unsubs) off(); },
    keys(e) {
      if (!tour) return false;
      if (e.key === 'ArrowRight') { set({ tourStep: Math.min(state.tourStep + 1, tour.steps.length - 1) }); return true; }
      if (e.key === 'ArrowLeft') { set({ tourStep: Math.max(state.tourStep - 1, 0) }); return true; }
      return false;
    },
  };
}
