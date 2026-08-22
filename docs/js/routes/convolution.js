// The payoff: multiplying two polynomials. This is the reason the NTT exists.

import { h, clear, panel } from '../dom.js';
import { state, set, on } from '../store.js';
import { convOf } from '../traceLoader.js';
import { sup } from '../fmt.js';

function poly(a) {
  const parts = [];
  for (let i = 0; i < a.length; i++) {
    if (!a[i]) continue;
    parts.push(i === 0 ? String(a[i]) : (a[i] === 1 ? '' : a[i]) + 'X' + (i === 1 ? '' : sup(i)));
  }
  return parts.length ? parts.join(' + ') : '0';
}

function vec(label, arr, cls) {
  return h('div', { class: 'vecline' }, h('b', {}, label), h('span', { class: cls || '' },
    '[ ' + arr.join(', ') + ' ]'));
}

/** The N x N schoolbook grid, with the terms that wrap marked. */
function grid(cv, q, N, hi) {
  const head = h('tr', {}, h('th', {}, ''),
    ...Array.from({ length: N }, (_, j) => h('th', { title: `b[${j}] = ${cv.b[j]}` }, 'b' + sup(j))));
  const rows = [];
  for (let i = 0; i < N; i++) {
    const cells = [h('th', { title: `a[${i}] = ${cv.a[i]}` }, 'a' + sup(i))];
    for (let j = 0; j < N; j++) {
      const t = (cv.a[i] * cv.b[j]) % q;
      const k = i + j;
      const wraps = k >= N;
      const dest = wraps ? k - N : k;
      const cls = [];
      if (wraps) cls.push('wrap');
      cls.push(t === 0 ? 'zero' : 'nz');
      if (hi !== null && dest === hi && t !== 0) cls.push('hi');
      cells.push(h('td', {
        class: cls.join(' '),
        style: hi !== null && dest === hi && t !== 0 ? 'outline:2px solid var(--accent)' : '',
        title: `a[${i}]·b[${j}] = ${cv.a[i]}·${cv.b[j]} = ${t} mod ${q}`
          + `  →  ${wraps ? `wraps to degree ${dest} with a minus sign` : `degree ${dest}`}`,
      }, (wraps && t !== 0 ? '−' : '') + t));
    }
    rows.push(h('tr', {}, ...cells));
  }
  return h('table', { class: 'school' }, h('thead', {}, head), h('tbody', {}, ...rows));
}

export function mount(root) {
  clear(root);
  const host = h('div', { class: 'route' });
  root.append(host);
  let hi = null;

  function render() {
    const p = state.trace.params;
    const cv = convOf(state.trace, state.convId);
    const N = p.N; const q = p.q;
    clear(host);

    const picker = h('div', { class: 'case-list' });
    for (const c of state.trace.convolutions) {
      const on2 = c.id === state.convId;
      picker.append(h('button', {
        type: 'button', 'aria-pressed': String(on2), title: c.note,
        onclick: () => { hi = null; set({ convId: c.id }); },
      }, h('span', {}, c.label), ' ', h('span', { class: 'case-id' }, c.id)));
    }

    // Read strictly left to right. An earlier version mirrored the second row
    // back towards the middle, which looked tidy and read as nonsense.
    const arrow = () => h('span', { class: 'arrow' }, '→');
    const pipe = h('div', {},
      h('div', { class: 'pipe' },
        h('span', { class: 'box' }, 'a'), arrow(),
        h('span', { class: 'box on' }, 'NTT'), arrow(),
        h('span', { class: 'box' }, 'â')),
      h('div', { class: 'pipe' },
        h('span', { class: 'box' }, 'b'), arrow(),
        h('span', { class: 'box on' }, 'NTT'), arrow(),
        h('span', { class: 'box' }, 'b̂')),
      h('div', { class: 'pipe' },
        h('span', { class: 'box' }, 'â · b̂'), arrow(),
        h('span', { class: 'box' }, 'ĉ'), arrow(),
        h('span', { class: 'box on' }, 'INTT'), arrow(),
        h('span', { class: 'box' }, 'a · b')));

    const products = h('div', { class: 'arr', style: 'font-size:.76rem' });
    for (let i = 0; i < N; i++) {
      products.append(h('div', {
        class: 'arr-row' + (hi === i ? ' lo' : ''),
        style: 'grid-template-columns:2.4rem 1fr;cursor:pointer',
        onclick: () => { hi = hi === i ? null : i; render(); },
      },
      h('span', { class: 'idx' }, '[' + i + ']'),
      h('span', {}, `${cv.aHat[i]} · ${cv.bHat[i]} = ${cv.aHat[i] * cv.bHat[i]} = `,
        h('b', { style: 'color:var(--accent)' }, String(cv.cHat[i])), ` mod ${q}`)));
    }

    const match = cv.product.join(',') === cv.schoolbook.join(',');

    host.append(
      h('div', { class: 'route-prose', style: 'padding:0 0 1rem' },
        h('h1', {}, 'The reason for the transform'),
        h('p', {}, 'Every homomorphic encryption scheme multiplies two polynomials many '
          + 'times. The direct method costs ', h('b', {}, `N² = ${N * N}`),
          ' multiplications. A transform of both polynomials first costs ',
          h('b', {}, String(cv.opsNtt)), '. That difference is the reason for the transform.'),
        h('p', {}, 'The polynomials have one more condition. They are in ',
          h('span', { class: 'm' }, 'Z', h('sub', {}, q), '[X] / (X', h('sup', {}, N), ' + 1)'),
          ', where ', h('span', { class: 'm' }, 'X', h('sup', {}, N), ' = −1'),
          '. A term that goes past degree ', String(N),
          ' therefore returns to a lower degree ', h('em', {}, 'and changes sign'), '.')),

      h('div', { class: 'conv-grid' },
        h('div', {},
          panel('Select a product', null, picker,
            h('p', { class: 'hint', style: 'margin:.4rem 0 0' }, cv.note)),
          panel('The direct method: every pair', h('span', { class: 'badge' }, `${N * N} multiplications`),
            h('p', { class: 'hint' }, 'Row i, column j is a', h('sub', {}, 'i'), '·b',
              h('sub', {}, 'j'), '. The shaded cells go past degree ',
              String(N), '. They return to degree i+j−', String(N),
              ' with a minus sign. Put the pointer on a cell to see its values.'),
            h('div', { class: 'panel-scroll' }, grid(cv, q, N, hi)),
            h('div', { class: 'school-legend' },
              h('span', { class: 'plain' }, `degree i+j below ${N}: the term keeps its degree`),
              h('span', {}, `degree i+j of ${N} or more: the term moves to i+j−${N} and changes sign`)),
            h('div', { style: 'margin-top:.5rem' },
              vec('a =', cv.a), vec('b =', cv.b),
              h('div', { class: 'vecline' }, h('b', {}, 'a(X) ='), poly(cv.a)),
              h('div', { class: 'vecline' }, h('b', {}, 'b(X) ='), poly(cv.b)),
              vec('a·b =', cv.schoolbook)))),

        h('div', {},
          panel('The transform method: transform, multiply, transform back',
            h('span', { class: 'badge' }, `${cv.opsNtt} multiplications`),
            pipe,
            vec('a =', cv.a), vec('â = NTT(a) =', cv.aHat),
            vec('b =', cv.b), vec('b̂ = NTT(b) =', cv.bHat),
            h('h4', { style: 'margin-top:.8rem' }, 'One multiplication for each slot'),
            h('p', { class: 'hint' }, 'In the value form, a product of polynomials '
              + 'is one product of numbers for each slot. Select a row to see the same '
              + 'terms in the grid on the left.'),
            products,
            vec('ĉ =', cv.cHat),
            h('h4', { style: 'margin-top:.8rem' }, 'Back to coefficients'),
            vec('INTT(ĉ) =', cv.product),
            vec('schoolbook =', cv.schoolbook),
            h('p', { class: match ? 'params-check' : 'hint' },
              match ? '✓ The two results are the same. The transform method uses fewer multiplications.'
                : 'The two results are different.'),
            h('div', { class: 'opcount' },
              h('div', { class: 'slow' }, h('span', { class: 'big' }, String(cv.opsSchoolbook)),
                'schoolbook multiplications'),
              h('div', { class: 'fast' }, h('span', { class: 'big' }, String(cv.opsNtt)),
                `${cv.opsButterfly} in butterflies + ${cv.opsPointwise} pointwise `
                + `+ ${cv.opsScale} by N⁻¹`)),
            h('p', { class: 'hint' },
              'The second count includes the ', String(cv.opsScale),
              ' multiplications by N⁻¹ at the end of the inverse transform. The '
              + 'simulator shows those steps, so the total counts them.'),
            h('p', { class: 'hint', style: 'margin-top:.6rem' },
              'At N = ', String(N), ' the difference is small. Real FHE uses N in the thousands. '
              + 'There N² is millions, and the transform method is tens of thousands.'),
            h('p', {}, h('a', { href: `#/transform?N=${p.N}&bits=${p.bits}&case=delta1&dir=forward&step=0` },
              'See one butterfly at a time →'))))),
    );
  }

  const ready = () => state.trace && state.trace.params.N === state.N
    && state.trace.params.bits === state.bits;
  const unsubs = [on('structure', () => { if (state.route === 'convolution' && ready()) render(); })];
  render();
  return { unmount() { for (const off of unsubs) off(); }, keys() { return false; } };
}
