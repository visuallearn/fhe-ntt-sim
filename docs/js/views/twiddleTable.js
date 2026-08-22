// The root-of-unity table, in the order OpenFHE actually stores it.
//
// This panel exists because the table is the single most confusing thing about a
// production NTT: it is not psi^0, psi^1, psi^2, ... but psi^brev(j), so reading
// entry j tells you nothing until you reverse the bits of j.

import { h, clear, panel } from '../dom.js';
import { set } from '../store.js';
import { bin, sup } from '../fmt.js';

export function make() {
  const el = h('div', { class: 'p-twiddles' });
  let rows = [];
  let which = 'fwd';

  function table(vm, kind) {
    const p = vm.params;
    const entries = vm.tables[kind];
    const inv = kind === 'inv';
    const body = h('tbody', {});
    rows = [];
    entries.forEach((e, j) => {
      // Index 0 is never read by the forward transform: the loops start at m+i
      // with m >= 1, so slot 0 just holds psi^0 = 1 and is skipped.
      const unused = !inv && j === 0;
      const tr = h('tr', { class: unused ? 'unused' : '' },
        h('td', {}, String(j)),
        h('td', {}, bin(j, p.brevBits)),
        h('td', {}, bin(e.brev, p.brevBits)),
        h('td', {}, 'ψ' + sup((inv ? '-' : '') + e.exp)),
        h('td', { class: 'v' }, String(e.v)));
      body.append(tr);
      rows.push(tr);
    });
    return h('table', { class: 'tw-table' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'j'), h('th', {}, 'bin j'), h('th', {}, 'brev'), h('th', {}, 'power'), h('th', {}, 'value'))),
      body);
  }

  function build(vm) {
    clear(el);
    which = vm.state.twTab === 'auto' ? (vm.state.dir === 'forward' ? 'fwd' : 'inv') : vm.state.twTab;
    const p = vm.params;
    const mk = (id, label) => h('button', {
      type: 'button', 'aria-pressed': String(which === id),
      onclick: () => set({ twTab: id }),
    }, label);

    const explain = h('details', { class: 'note' },
      h('summary', {}, 'The reason for this order'),
      h('p', {}, 'Slot ', h('em', {}, 'j'), ' holds ',
        h('span', { class: 'm' }, 'ψ'), ' raised to ',
        h('em', {}, 'the bit-reversal of j'), ', not to ', h('em', {}, 'j'),
        '. With ', String(p.brevBits), ' bits, slot 1 = ', bin(1, p.brevBits),
        ' reversed is ', bin(vm.tables.fwd[1].brev, p.brevBits), ' = ',
        String(vm.tables.fwd[1].brev), ', so slot 1 holds ψ',
        h('sup', {}, String(vm.tables.fwd[1].exp)), ' = ', String(vm.tables.fwd[1].v), '.'),
      h('p', {}, 'This order is intentional. The butterflies read the table in sequence: '
        + 'slot 1, then slot 2, then slot 3. The bit-reversed order gives the correct '
        + 'twiddle at each read. The table also includes the '
        + '“negacyclic twist” (the part that makes X', h('sup', {}, 'N'),
        ' = −1 and not +1). A separate operation for that condition is not necessary.'));

    const fused = h('p', { class: 'hint' },
      which === 'inv'
        ? `The last stage of the inverse transform does not read a table entry directly. `
          + `It uses ω₁⁻¹ = TableI[1] · N⁻¹ = ${vm.tables.inv[1].v} · ${p.nInv} = `
          + `${vm.tables.omega1Inv.v} mod ${p.q}.`
        : `No butterfly reads slot 0 (ψ⁰ = 1). The loops start at slot 1.`);

    el.append(panel('Twiddle table', h('span', { class: 'badge' }, which === 'fwd' ? 'forward' : 'inverse'),
      h('div', { class: 'tabs' }, mk('fwd', 'ψ powers'), mk('inv', 'ψ⁻¹ powers')),
      h('div', { class: 'panel-scroll' }, table(vm, which)),
      fused, explain));
  }

  function update(vm) {
    const active = vm.ctx.twIndex;
    const fused = vm.ctx.fused;
    rows.forEach((tr, j) => {
      tr.classList.toggle('active', !fused && j === active);
    });
  }

  return { el, build, update };
}
