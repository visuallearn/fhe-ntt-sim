// The working: the current step written out with the actual numbers in it.

import { h, clear, panel, frag } from '../dom.js';
import { mathLine, mOp, mTw, mRes, mIn, sup, bin, brev, num } from '../fmt.js';

/** The one note the whole simulator hangs its honesty on. */
function shoupNote(vm, tw) {
  const p = vm.params;
  const entry = vm.tables.fwd.concat(vm.tables.inv).find((e) => e.v === tw);
  const precon = entry ? entry.precon : null;
  return h('details', { class: 'note' },
    h('summary', {}, 'How OpenFHE actually multiplies'),
    h('p', {}, 'The lines above use the simple method: multiply, then take the remainder '
      + 'mod ', String(p.q), '. OpenFHE gets the same value faster. Many butterflies use '
      + 'the same twiddle, so OpenFHE calculates ',
      h('span', { class: 'm' }, '⌊ω·2', h('sup', {}, '64'), '/q⌋'),
      ' one time. Each multiplication then needs one 64-bit multiply-high, two '
      + 'low multiplies, a subtraction and one conditional addition. It needs no '
      + 'division, which is the part that matters. This is the method of Shoup from '
      + 'NTL. It is Algorithm 2, lines 5–7 of ',
      h('a', { href: 'https://arxiv.org/abs/1205.2926', rel: 'noopener' },
        'Harvey, “Faster arithmetic for number-theoretic transforms”'),
      '. In other places it uses Barrett reduction with ',
      h('span', { class: 'm' }, 'μ = ⌊2', h('sup', {}, '2·bitlen(q)+3'), '/q⌋'), ' = ', p.mu, '.'),
    precon
      ? h('p', {}, 'These are methods of reduction, not different arithmetic. The result '
        + 'is the same as the result above. For ω = ', String(tw), ' and q = ', String(p.q),
        ', OpenFHE keeps the constant ', h('code', {}, precon), '.')
      : h('p', {}, 'These are methods of reduction, not different arithmetic. The result '
        + 'is the same as the result above.'),
  );
}

export function make() {
  const el = h('div', { class: 'p-math' });
  const head = h('div', { class: 'math-head' });
  const body = h('div', { class: 'math-lines' });
  const extra = h('div', {});

  function build(vm) {
    clear(el);
    el.append(panel('Working', h('span', { class: 'badge', id: 'math-region' }, ''),
      head, body, extra));
    void vm;
  }

  function regionLabel(r) {
    return { main: 'main loop', inner: 'main loop', peeledFirst: 'unrolled first stage',
      peeledLast: 'unrolled last stage', scale: 'final scaling' }[r] || '';
  }

  function update(vm) {
    const p = vm.params;
    const q = p.q;
    const ev = vm.ev;
    const ctx = vm.ctx;
    clear(head); clear(body); clear(extra);

    const badge = el.querySelector('#math-region');
    if (badge) {
      badge.textContent = regionLabel(ctx.region);
      badge.className = 'badge ' + (ctx.region === 'main' || ctx.region === 'inner' ? 'main' : 'peeled');
    }

    if (!ev) { body.append(h('p', { class: 'math-empty' }, 'Nothing to show.')); return; }

    const stageStr = ctx.stage ? `stage ${ctx.stage} of ${ctx.stages}` : '';
    const inv = vm.state.dir === 'inverse';

    if (ev.k === 'begin') {
      head.append(h('span', {}, 'Starting.'));
      body.append(
        mathLine('input', h('span', {}, '[ ' + vm.case.input.join(', ') + ' ]')),
        mathLine('as', h('span', {}, polyText(vm.case.input))),
        mathLine('modulus', h('span', {}, 'q = ' + q)));
      extra.append(h('p', { class: 'hint' }, inv
        ? 'These values are in bit-reversed slot order. The transform changes them back into coefficients.'
        : `The transform calculates the value of this polynomial at ${p.N} points. It writes the results into the same array.`));
      return;
    }

    if (ev.k === 'stage') {
      if (ctx.scaling) {
        head.append(h('span', {}, 'Final pass: divide everything by N.'));
        body.append(
          mathLine('N⁻¹', h('span', {}, `${p.N}⁻¹ = ${p.nInv} mod ${q}`)),
          mathLine('check', h('span', {}, `${p.N} · ${p.nInv} = ${p.N * p.nInv} = ${(p.N * p.nInv) % q} mod ${q}`)));
        extra.append(h('p', { class: 'hint' },
          `This operation multiplies only slots 0…${p.N / 2 - 1}. The twiddle of the previous `
          + `stage already includes N⁻¹ for the upper half.`));
        return;
      }
      head.append(h('span', {}, `Beginning ${stageStr}.`));
      body.append(
        mathLine('stride', h('span', {}, `t = ${ctx.t}  → pairs (i, i+${ctx.t})`)),
        mathLine('blocks', h('span', {}, `m = ${ctx.m}  → ${ctx.m} twiddle${ctx.m === 1 ? '' : 's'}, `
          + `table slots ${ctx.m}…${ctx.m + ctx.m - 1}`)),
        mathLine('work', h('span', {}, `${p.N / 2} butterflies`)));
      extra.append(h('p', { class: 'hint' }, inv
        ? 'The inverse transform takes the stages in the opposite order. The first stride '
          + 'is 1. Each stage then makes the stride two times larger.'
        : 'The forward transform starts with the largest stride. Each stage then makes the stride two times smaller.'));
      return;
    }

    if (ev.k === 'tw') {
      head.append(h('span', {}, 'Loading the twiddle factor.'));
      const tbl = inv ? 'Ψ⁻¹rev' : 'Ψrev';
      if (ev.fused) {
        body.append(
          mathLine('ω', mTw(String(ev.tw)), mOp('='), h('span', {}, `${tbl}[1] · N⁻¹`)),
          mathLine('', h('span', {}, `= ${vm.tables.inv[1].v} · ${p.nInv} = `
            + `${vm.tables.inv[1].v * p.nInv} = ${ev.tw} mod ${q}`)),
          mathLine('i.e.', h('span', {}, `ψ${sup('-' + (p.N / 2))} · N⁻¹`)));
        extra.append(h('details', { class: 'note' },
          h('summary', {}, 'The reason this twiddle is not a simple power of ψ⁻¹'),
          h('p', {}, 'OpenFHE puts the division by N into the twiddle of this last stage, '
            + 'for the upper half of the array. This saves N/2 multiplications. It then '
            + 'multiplies only the lower half separately. The operation is still a division '
            + 'of every value by N, in a different order. See OpenFHE issue ',
            h('a', { href: 'https://github.com/openfheorg/openfhe-development/issues/872', rel: 'noopener' }, '#872'),
            '.')));
        return;
      }
      body.append(
        mathLine('slot', h('span', {}, `${tbl}[m+i] = ${tbl}[${ev.twIndex}]`)),
        mathLine('reverse', h('span', {}, `brev(${ev.twIndex}) : ${bin(ev.twIndex, p.brevBits)} → `
          + `${bin(ev.twExp, p.brevBits)} = ${ev.twExp}`)),
        mathLine('so ω', mTw(`ψ${sup((inv ? '-' : '') + ev.twExp)}`), mOp('='),
          h('span', {}, `${inv ? p.psiInv : p.psi}${sup(ev.twExp)} mod ${q}`), mOp('='), mRes(String(ev.tw))));
      extra.append(h('p', { class: 'hint' },
        'The table is in bit-reversed order. The slot number and the power of ψ are '
        + 'therefore different numbers. The bit-reversal of the slot number gives the exponent.'));
      return;
    }

    if (ev.k === 'bfly_ct') {
      head.append(h('span', {}, `${stageStr} · butterfly on slots ${ev.lo} and ${ev.hi}`),
        h('span', { class: 'badge' }, `t = ${ctx.t}`));
      body.append(
        mathLine('u', h('span', {}, `X[${ev.lo}]`), mOp('='), mIn(String(ev.u))),
        mathLine('v', h('span', {}, `X[${ev.hi}]`), mOp('='), mIn(String(ev.v))),
        mathLine('ω', mTw(String(ev.tw)), mOp('='),
          h('span', {}, `ψ${sup(brev(ev.twIndex, p.brevBits))}`),
          mOp('='), h('span', {}, `${p.psi}${sup(brev(ev.twIndex, p.brevBits))} mod ${q}`)),
        mathLine('v·ω', h('span', {}, `${ev.v} · ${ev.tw} = ${ev.v * ev.tw}`), mOp('='),
          mRes(String(ev.prod)), mOp(`mod ${q}`)),
        mathLine(`X[${ev.lo}] ←`, h('span', {}, `u + v·ω = ${ev.u} + ${ev.prod} = ${ev.u + ev.prod}`),
          mOp('='), mRes(String(ev.outLo)), mOp(`mod ${q}`)),
        mathLine(`X[${ev.hi}] ←`, h('span', {}, `u − v·ω = ${ev.u} − ${ev.prod} = ${num(ev.u - ev.prod)}`),
          mOp('='), mRes(String(ev.outHi)), mOp(`mod ${q}`)));
      extra.append(shoupNote(vm, ev.tw));
      return;
    }

    if (ev.k === 'bfly_gs') {
      head.append(h('span', {}, `${stageStr} · butterfly on slots ${ev.lo} and ${ev.hi}`),
        h('span', { class: 'badge' }, `t = ${ctx.t}`),
        frag(ev.fused ? h('span', { class: 'badge fused' }, 'twiddle carries ÷N') : null));
      body.append(
        mathLine('u', h('span', {}, `X[${ev.lo}]`), mOp('='), mIn(String(ev.u))),
        mathLine('v', h('span', {}, `X[${ev.hi}]`), mOp('='), mIn(String(ev.v))),
        mathLine('ω', mTw(String(ev.tw)), mOp('='),
          h('span', {}, ev.fused
            ? `ψ${sup('-' + (p.N / 2))} · N⁻¹`
            : `ψ${sup('-' + brev(ev.twIndex, p.brevBits))}`)),
        mathLine(`X[${ev.lo}] ←`, h('span', {}, `u + v = ${ev.u} + ${ev.v} = ${ev.u + ev.v}`),
          mOp('='), mRes(String(ev.sum)), mOp(`mod ${q}`)),
        mathLine('u − v', h('span', {}, `${ev.u} − ${ev.v} = ${num(ev.u - ev.v)}`), mOp('='),
          mRes(String(ev.diff)), mOp(`mod ${q}`)),
        mathLine(`X[${ev.hi}] ←`, h('span', {}, `(u−v)·ω = ${ev.diff} · ${ev.tw} = ${ev.diff * ev.tw}`),
          mOp('='), mRes(String(ev.outHi)), mOp(`mod ${q}`)));
      extra.append(h('p', { class: 'hint' },
        'The shape is important. The sum has no twiddle. The multiplication is on the '
        + 'difference. This is the Gentleman–Sande butterfly, the mirror image of the forward one.'),
        shoupNote(vm, ev.tw));
      return;
    }

    if (ev.k === 'scale') {
      head.append(h('span', {}, `Scaling slot ${ev.idx} by N⁻¹`));
      body.append(
        mathLine('before', mIn(String(ev.in))),
        mathLine('N⁻¹', h('span', {}, String(ev.factor))),
        mathLine(`X[${ev.idx}] ←`, h('span', {}, `${ev.in} · ${ev.factor} = ${ev.in * ev.factor}`),
          mOp('='), mRes(String(ev.out)), mOp(`mod ${q}`)));
      extra.append(shoupNote(vm, ev.factor));
      return;
    }

    if (ev.k === 'end') {
      head.append(h('span', {}, 'Done.'));
      body.append(mathLine('result', h('span', {}, '[ ' + vm.direction.expected.join(', ') + ' ]')));
      if (!inv) {
        const ep = vm.case.evalPoints;
        body.append(mathLine('meaning', h('span', {}, `slot p holds a(ψ${sup('2·brev(p)+1')})`)));
        extra.append(h('p', { class: 'hint' },
          `Slot 0 holds the value at ψ${sup(ep[0].exp)} = ${ep[0].point}. Slot 1 holds the `
          + `value at ψ${sup(ep[1].exp)} = ${ep[1].point}. The exponents are not in numerical order. `
          + 'This is the bit-reversal. OpenFHE keeps the output in this order, because the '
          + 'inverse transform expects it.'));
      } else {
        const ok = vm.direction.expected.join(',') === vm.case.input.join(',');
        body.append(mathLine('original', h('span', {}, '[ ' + vm.case.input.join(', ') + ' ]')));
        extra.append(h('p', { class: ok ? 'params-check' : 'hint' },
          ok ? '✓ The round trip is exact. The inverse transform gave the original coefficients.'
            : 'The round trip gave different values.'));
      }
      return;
    }

    body.append(h('p', { class: 'math-empty' }, ev.k));
  }

  return { el, build, update };
}

function polyText(a) {
  const parts = [];
  for (let i = 0; i < a.length; i++) {
    if (!a[i]) continue;
    if (i === 0) parts.push(String(a[i]));
    else parts.push((a[i] === 1 ? '' : a[i]) + 'X' + (i === 1 ? '' : sup(i)));
  }
  return parts.length ? 'a(X) = ' + parts.join(' + ') : 'a(X) = 0';
}
