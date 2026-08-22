// Left column: what you are looking at (ring dimension, modulus size, input
// case, direction) and the parameters that follow from it.

import { h, clear, panel } from '../dom.js';
import { set } from '../store.js';
import { sup, psiPow } from '../fmt.js';

export function make() {
  const el = h('div', { class: 'tx-col' });

  function matrix(vm) {
    const { manifest, state } = vm;
    const head = h('tr', {}, h('th', {}, 'bits'),
      ...manifest.ringDimensions.map((n) => h('th', {}, 'N=' + n)));
    const rows = manifest.modulusBits.map((b) => h('tr', {},
      h('th', {}, String(b)),
      ...manifest.ringDimensions.map((n) => {
        const cfg = manifest.configs.find((c) => c.N === n && c.bits === b);
        if (!cfg || !cfg.feasible) {
          return h('td', {
            class: 'no',
            title: `No prime of exactly ${b} bits is ≡ 1 (mod ${2 * n}), so this ring `
              + `dimension does not work at this modulus size.\n\nOpenFHE: `
              + (cfg && cfg.reason ? cfg.reason : 'LastPrime throws'),
          }, '—');
        }
        const sel = state.N === n && state.bits === b;
        return h('td', { class: sel ? 'sel' : '' },
          h('button', {
            type: 'button',
            'aria-pressed': String(sel),
            title: `N=${n}, ${b}-bit modulus q=${cfg.q}, ψ=${cfg.psi}`,
            onclick: () => set({ N: n, bits: b, step: 0, playing: false }),
          }, String(cfg.q)));
      })));
    return h('table', { class: 'matrix' }, h('tbody', {}, head, ...rows));
  }

  function params(vm) {
    const p = vm.params;
    const q = p.q;
    const rows = [
      ['ring', h('span', {}, 'Z', h('sub', {}, q), '[X] / (X', h('sup', {}, p.N), ' + 1)')],
      ['N', `${p.N}   (ring dimension)`],
      ['M = 2N', `${p.M}   (cyclotomic order)`],
      ['q', `${q}   (${p.bits} bits)`],
      ['ψ', `${p.psi}   (primitive ${p.M}-th root)`],
      ['ψ⁻¹', String(p.psiInv)],
      ['ω = ψ²', `${p.omegaN}   (primitive ${p.N}-th root)`],
      ['N⁻¹', String(p.nInv)],
      ['log₂N', String(p.logN)],
    ];
    const dl = h('dl', { class: 'params-list' });
    for (const [k, v] of rows) dl.append(h('dt', {}, k), h('dd', {}, v));

    const checks = h('div', {},
      h('div', { class: 'params-check' }, `✓ (q−1) mod ${p.M} = ${(q - 1) % p.M} — so a ${p.M}-th root exists`),
      h('div', { class: 'params-check' }, `✓ ψ${sup(p.N)} = ${p.negOne} = −1 mod ${q}`),
      h('div', { class: 'params-check' }, `✓ ψ${sup(p.M)} = 1 mod ${q}`),
      h('div', { class: 'params-check' }, `✓ ψ · ψ⁻¹ = ${(p.psi * p.psiInv) % q} mod ${q}`));

    const how = h('details', { class: 'note' },
      h('summary', {}, 'The origin of these numbers'),
      h('p', {}, 'OpenFHE selects both of these values. The modulus is ',
        h('code', {}, p.modulusSelector),
        ': the largest prime below 2', h('sup', {}, p.bits),
        ' that is ≡ 1 (mod ', String(p.M), '). This condition is necessary. Without it, no ',
        String(p.M), '-th root of unity exists, and the transform is not possible.'),
      h('p', {}, 'The root is ', h('code', {}, p.rootSelector),
        '. It gives the smallest primitive ', String(p.M),
        '-th root. The same parameters therefore always give the same ψ.'));

    const adv = h('details', { class: 'note' },
      h('summary', {}, 'Advanced: reduction constants'),
      h('p', {}, 'The simulator shows plain ', h('code', {}, '(a·ω) mod q'),
        '. OpenFHE gets the same values with reduction constants that it calculates first:'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Barrett μ'), h('dd', {}, p.mu),
        h('dt', {}, 'ω₁⁻¹ (fused)'), h('dd', {}, String(vm.tables.omega1Inv.v)),
        h('dt', {}, 'coi index'), h('dd', {}, String(p.coiIndex)),
        h('dt', {}, 'NATIVE_SIZE'), h('dd', {}, String(vm.manifest.openfhe.nativeInt)),
        h('dt', {}, 'MAX_MODULUS_SIZE'), h('dd', {}, String(p.maxModulusSize))),
      h('p', { class: 'hint' }, 'See “How OpenFHE actually multiplies” in the working panel.'));

    return panel('Parameters', null, dl, checks, how, adv);
  }

  function cases(vm) {
    const list = h('div', { class: 'case-list' });
    for (const c of vm.trace.cases) {
      const on = c.id === vm.state.caseId;
      list.append(h('button', {
        type: 'button', 'aria-pressed': String(on), title: c.note,
        onclick: () => set({ caseId: c.id, step: 0, playing: false }),
      }, h('span', {}, c.label), ' ', h('span', { class: 'case-id' }, c.id)));
    }
    const note = h('p', { class: 'hint', style: 'margin:.4rem 0 0' }, vm.case.note);
    return panel('Input polynomial', null, list, note);
  }

  function direction(vm) {
    const mk = (id, label, title) => h('button', {
      type: 'button', 'aria-pressed': String(vm.state.dir === id), title,
      // twTab back to 'auto': a pinned tab should not outlive the direction
      // change that made the other table the relevant one.
      onclick: () => set({ dir: id, step: 0, playing: false, twTab: 'auto' }),
    }, label);
    return panel('Direction', null,
      h('div', { class: 'tabs' },
        mk('forward', 'Forward NTT', 'Coefficients → evaluations. Cooley–Tukey butterflies.'),
        mk('inverse', 'Inverse NTT', 'Evaluations → coefficients. Gentleman–Sande butterflies, then ÷N.')),
      h('p', { class: 'hint' }, vm.state.dir === 'forward'
        ? `This transform reads the ${vm.params.N} coefficients. It calculates the value at `
          + `${vm.params.N} points. The output is in bit-reversed order.`
        : `This transform changes the ${vm.params.N} values back into coefficients. Its input `
          + `is the output of the forward transform. A correct round trip gives the original values.`));
  }

  function config(vm) {
    const feasN = (b) => vm.manifest.ringDimensions.filter((n) =>
      vm.manifest.configs.some((c) => c.N === n && c.bits === b && c.feasible));
    const feasB = (n) => vm.manifest.modulusBits.filter((b) =>
      vm.manifest.configs.some((c) => c.N === n && c.bits === b && c.feasible));

    const selN = h('select', {
      'aria-label': 'Ring dimension N',
      onchange: (e) => {
        const n = Number(e.target.value);
        const bs = feasB(n);
        set({ N: n, bits: bs.includes(vm.state.bits) ? vm.state.bits : bs[0], step: 0, playing: false });
      },
    }, ...vm.manifest.ringDimensions.map((n) => h('option', {
      value: String(n), selected: n === vm.state.N ? true : null,
      disabled: feasB(n).length ? null : true,
    }, 'N = ' + n)));

    const selB = h('select', {
      'aria-label': 'Modulus bit size',
      onchange: (e) => set({ bits: Number(e.target.value), step: 0, playing: false }),
    }, ...vm.manifest.modulusBits.map((b) => h('option', {
      value: String(b), selected: b === vm.state.bits ? true : null,
      disabled: feasN(b).includes(vm.state.N) ? null : true,
    }, b + '-bit q')));

    return panel('Configuration', null,
      h('div', { class: 'cfg-row' }, selN, selB),
      h('p', { class: 'hint', style: 'margin:.1rem 0 .4rem' },
        'OpenFHE selected every modulus below. A dash shows that no prime of that bit '
        + 'length is ≡ 1 (mod 2N). That combination is therefore not possible.'),
      matrix(vm));
  }

  function build(vm) {
    clear(el);
    // Marker classes let the narrow-screen layout reorder these individually:
    // on a phone the diagram should not sit below four panels of setup.
    const parts = [
      [config(vm), 'p-config'],
      [direction(vm), 'p-dir'],
      [cases(vm), 'p-input'],
      [params(vm), 'p-params'],
    ];
    for (const [node, cls] of parts) {
      node.classList.add(cls);
      el.append(node);
    }
  }

  // Nothing in this column depends on the current step.
  function update() {}

  return { el, build, update };
}
