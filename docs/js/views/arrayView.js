// The in-place array: what actually sits in memory right now.
//
// A production NTT overwrites its input, so there is exactly one array and every
// butterfly rewrites two of its slots. Showing the binary index and its
// bit-reversal alongside each value is what makes the output ordering readable
// later on.

import { h, clear, panel } from '../dom.js';
import { bin, pct } from '../fmt.js';

export function make() {
  const el = h('div', { class: 'p-array' });
  let cells = [];
  let strideLine = null;

  function build(vm) {
    clear(el);
    cells = [];
    const p = vm.params;
    const grid = h('div', { class: 'arr' });
    grid.append(h('div', { class: 'arr-row head' },
      h('span', {}, 'slot'), h('span', {}, 'binary'), h('span', {}, 'reversed'),
      h('span', { class: 'val' }, 'value'), h('span', {}, `size (of q=${p.q})`)));

    for (let i = 0; i < p.N; i++) {
      const val = h('span', { class: 'val' }, '0');
      const bar = h('i', { style: 'width:0%' });
      const tag = h('span', { class: 'tag' }, '');
      const row = h('div', { class: 'arr-row' },
        h('span', { class: 'idx' }, '[' + i + ']'),
        h('span', { class: 'bin' }, bin(i, p.brevBits)),
        h('span', { class: 'brv' }, bin(vm.brev(i), p.brevBits)),
        val,
        h('span', { style: 'display:flex;gap:.35rem;align-items:center' },
          h('span', { class: 'bar', style: 'flex:1' }, bar), tag));
      grid.append(row);
      cells.push({ row, val, bar, tag });
    }

    strideLine = h('div', { class: 'arr-stride' }, '');
    el.append(panel('In-place array',
      h('span', { class: 'badge' }, vm.state.dir === 'forward' ? 'X[…]' : 'X̂[…]'),
      strideLine, grid,
      h('p', { class: 'hint', style: 'margin:.5rem 0 0' },
        'There is one array. Each butterfly writes into it. The two highlighted rows '
        + 'are the pair of the current butterfly. The stride is the distance between them.')));
  }

  function update(vm) {
    const { array, ctx, params, ev } = vm;
    // For the slots the current step just wrote, show "before → after": the row
    // is highlighted as the butterfly's input pair but already holds its output.
    const before = {};
    if (ev && (ev.k === 'bfly_ct' || ev.k === 'bfly_gs')) {
      before[ev.lo] = { was: ev.u, tag: 'u' };
      before[ev.hi] = { was: ev.v, tag: 'v' };
    } else if (ev && ev.k === 'scale') {
      before[ev.idx] = { was: ev.in, tag: '×N⁻¹' };
    }
    for (let i = 0; i < array.length; i++) {
      const c = cells[i];
      const b = before[i];
      c.val.textContent = b && b.was !== array[i] ? `${b.was} → ${array[i]}` : String(array[i]);
      c.bar.style.width = array[i] === 0 ? '0%' : pct(array[i], params.q);
      c.row.classList.toggle('lo', ctx.lo === i);
      c.row.classList.toggle('hi', ctx.hi === i);
      c.tag.textContent = b ? b.tag : '';
    }
    if (ctx.scaling) {
      strideLine.textContent = `last operation: multiply the lower half by N⁻¹ = ${params.nInv}`;
    } else if (ctx.t !== null) {
      strideLine.textContent = `stage ${ctx.stage} of ${ctx.stages} · stride t = ${ctx.t}`
        + ` · ${params.N / 2} butterflies · pairs (i, i+${ctx.t})`;
    } else {
      strideLine.textContent = 'before the first stage';
    }
  }

  return { el, build, update };
}
