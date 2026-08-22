// Why a modulus has to satisfy q = 1 (mod 2N), and which points the transform
// actually evaluates at.

import { h, s, clear, panel } from '../dom.js';
import { state, set, on } from '../store.js';
import { caseOf } from '../traceLoader.js';
import { brev, sup } from '../fmt.js';

function modPow(b, e, q) {
  let r = 1n; let bb = BigInt(b) % BigInt(q); let ee = BigInt(e); const qq = BigInt(q);
  while (ee > 0n) { if (ee & 1n) r = (r * bb) % qq; bb = (bb * bb) % qq; ee >>= 1n; }
  return Number(r);
}

/** Smallest generator of Z_q^*, found by brute force (q is tiny here). */
function generator(q) {
  for (let g = 2; g < q; g++) {
    const seen = new Set();
    let x = 1;
    for (let k = 0; k < q - 1; k++) { x = (x * g) % q; seen.add(x); }
    if (seen.size === q - 1) return g;
  }
  return 1;
}

function circle(p, selExp) {
  const R = 168, C = 210;
  const g = s('g', {});
  const M = p.M;
  g.append(s('circle', { class: 'ring', cx: C, cy: C, r: R }));

  const pts = [];
  for (let k = 0; k < M; k++) {
    // k = 0 at the top, going clockwise, so psi^0 = 1 sits where you expect it.
    const a = (-Math.PI / 2) + (2 * Math.PI * k) / M;
    const x = C + R * Math.cos(a);
    const y = C + R * Math.sin(a);
    const v = modPow(p.psi, k, p.q);
    const odd = k % 2 === 1;
    const cls = k === 0 ? 'one' : (k === p.N ? 'neg' : (odd ? 'odd' : 'even'));
    g.append(s('line', { class: 'spoke', x1: C, y1: C, x2: x, y2: y }));
    const dot = s('circle', {
      class: 'pt ' + cls + (selExp === k ? ' sel' : ''),
      cx: x, cy: y, r: odd ? 5.5 : 4,
    });
    g.append(dot);
    const lx = C + (R + 16) * Math.cos(a);
    const ly = C + (R + 16) * Math.sin(a);
    g.append(s('text', {
      class: 'lab' + (odd ? ' odd' : ''), x: lx, y: ly + 3,
      'text-anchor': Math.abs(Math.cos(a)) < 0.25 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end'),
    }, String(v)));
    pts.push({ k, v, x, y });
  }
  g.append(s('text', { class: 'cap', x: C, y: C - 8, 'text-anchor': 'middle' }, `ψ = ${p.psi}`));
  g.append(s('text', { class: 'cap', x: C, y: C + 6, 'text-anchor': 'middle' }, `mod ${p.q}`));
  g.append(s('text', { class: 'cap', x: C, y: C + 20, 'text-anchor': 'middle' }, `${p.M} points`));

  return s('svg', {
    width: 2 * C, height: 2 * C, viewBox: `0 0 ${2 * C} ${2 * C}`, class: 'circle',
    role: 'img',
    'aria-label': `The ${p.M} powers of psi on a circle. The odd powers are the `
      + 'evaluation points of the transform.',
  }, g);
}

export function mount(root) {
  clear(root);
  const host = h('div', { class: 'route' });
  root.append(host);

  function render() {
    const p = state.trace.params;
    const c = caseOf(state.trace, state.caseId);
    const sel = state.rootsSlot;
    const selExp = 2 * brev(sel, p.brevBits) + 1;
    clear(host);

    const g = generator(p.q);
    const sub = new Set();
    for (let k = 0; k < p.M; k++) sub.add(modPow(p.psi, k, p.q));

    const ladder = h('div', { class: 'ladder' });
    let x = 1;
    for (let k = 0; k < p.q - 1; k++) {
      x = (x * g) % p.q;
      ladder.append(h('i', {
        class: sub.has(x) ? 'sub' : '',
        title: `${g}^${k + 1} = ${x}` + (sub.has(x) ? `  — in the order-${p.M} subgroup` : ''),
      }, String(x)));
    }

    const cofactor = (p.q - 1) / p.M;

    // Primes either side of q, with the divisibility test that decides whether a
    // 2N-th root of unity exists at all. This is the part the default N=8, q=17
    // configuration cannot show on its own, because there the cofactor is 1 and
    // the subgroup is the whole group.
    const isPrime = (n) => {
      if (n < 2) return false;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
      return true;
    };
    const primes = [p.q];
    for (let d = 1; primes.length < 10 && d < 400; d++) {
      for (const cand of [p.q - d, p.q + d]) {
        if (cand > 2 && isPrime(cand) && !primes.includes(cand)) primes.push(cand);
      }
    }
    primes.sort((a, b) => a - b);
    const nearby = h('table', { class: 'slotmap' },
      h('thead', {}, h('tr', {}, h('th', {}, 'prime'), h('th', {}, `(prime−1) mod ${p.M}`),
        h('th', {}, `${p.M}-th root of unity?`))),
      h('tbody', {}, ...primes.map((pr) => {
        const rem = (pr - 1) % p.M;
        return h('tr', { class: pr === p.q ? 'sel' : '' },
          h('td', {}, String(pr) + (pr === p.q ? ' ← in use' : '')),
          h('td', {}, String(rem)),
          h('td', { style: rem === 0 ? 'color:var(--settled)' : 'color:var(--warn)' },
            rem === 0 ? 'yes' : 'no'));
      })));

    const map = h('table', { class: 'slotmap' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'slot p'), h('th', {}, 'brev(p)'), h('th', {}, 'exponent'),
        h('th', {}, 'point'), h('th', {}, 'value there'))),
      h('tbody', {}, ...c.evalPoints.map((e) => h('tr', {
        class: e.slot === sel ? 'sel' : '',
        style: 'cursor:pointer',
        onclick: () => set({ rootsSlot: e.slot }),
      },
      h('td', {}, String(e.slot)),
      h('td', {}, String(e.brev)),
      h('td', {}, '2·' + e.brev + '+1 = ' + e.exp),
      h('td', { class: 'pt' }, 'ψ' + sup(e.exp) + ' = ' + e.point),
      h('td', {}, String(e.value))))));

    host.append(
      h('div', { class: 'route-prose', style: 'padding-left:0;padding-top:0' },
        h('h1', {}, 'The evaluation points of the transform'),
        h('p', {}, 'The values at ', h('b', {}, p.N),
          ' different points define a polynomial of degree less than ', h('b', {}, p.N),
          ' completely. The transform calculates the value at ', String(p.N),
          ' specific points. The selection of those points makes the transform fast.')),

      h('div', { class: 'roots-grid' },
        panel(`The ${p.M} powers of ψ`, h('span', { class: 'badge' }, `q = ${p.q}`),
          circle(p, selExp),
          h('div', { class: 'legend-inline' },
            h('span', { style: 'color:var(--twiddle)' }, '● odd powers — the evaluation points'),
            h('span', { style: 'color:var(--settled)' }, '● even powers — the N-th roots'),
            h('span', { style: 'color:var(--warn)' }, `● ψ${sup(p.N)} = ${p.negOne} = −1`)),
          h('p', { class: 'hint', style: 'margin-top:.5rem' },
            'A multiplication by ψ moves one step around this circle. After ',
            String(p.M), ' steps the value is 1 again. At the middle of the cycle the '
            + 'value is −1. That middle point gives the ring X', h('sup', {}, p.N),
            ' + 1 and not X', h('sup', {}, p.N), ' − 1.')),

        h('div', {},
          panel('Which slot holds which point', null,
            h('p', { class: 'hint' }, 'Select a row to see its point on the circle. '
              + 'The exponents are not in numerical order. This is the bit-reversal.'),
            h('div', { class: 'panel-scroll' }, map)),

          panel(`The condition q ≡ 1 (mod ${p.M})`, null,
            h('p', {}, 'Below is every non-zero residue mod ', String(p.q),
              '. Each value is the previous value multiplied by ',
              String(g), ' (a generator). There are ', String(p.q - 1), ' values.'),
            h('p', {}, 'Highlighted are the ', String(p.M), ' powers of ψ — one in every ',
              h('b', {}, String(cofactor)), ', at equal intervals. Those equal intervals '
              + 'are possible only because ', String(p.M), ' divides ', String(p.q - 1), ': ',
              h('b', {}, `(${p.q} − 1) / ${p.M} = ${cofactor}`), '.'),
            cofactor === 1
              ? h('p', { class: 'hint' }, 'At this modulus the cofactor is 1. The '
                + `${p.M} powers of ψ are therefore the complete group, and every cell is `
                + 'highlighted. Select a larger modulus above to see a smaller subgroup.')
              : null,
            h('div', { class: 'panel-scroll' }, ladder),
            h('h4', { style: 'margin-top:.9rem' }, 'A prime that does not satisfy the condition'),
            h('p', { class: 'hint' }, 'Primes either side of ', String(p.q),
              ', with the test for a ', String(p.M),
              '-th root of unity. Only the rows with remainder 0 support a transform of '
              + 'this size. OpenFHE therefore searches for the modulus. You do not select it.'),
            h('div', { class: 'panel-scroll' }, nearby)))));
  }

  const ready = () => state.trace && state.trace.params.N === state.N
    && state.trace.params.bits === state.bits;
  const unsubs = [
    on('structure', () => { if (state.route === 'roots' && ready()) render(); }),
    on('step', () => { if (state.route === 'roots' && ready()) render(); }),
  ];
  render();

  return {
    unmount() { for (const off of unsubs) off(); },
    keys(e) {
      const n = state.trace.params.N;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { set({ rootsSlot: (state.rootsSlot + 1) % n }); return true; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { set({ rootsSlot: (state.rootsSlot + n - 1) % n }); return true; }
      return false;
    },
  };
}
