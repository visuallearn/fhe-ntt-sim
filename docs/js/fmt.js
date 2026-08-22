// Formatting helpers, including the little inline-maths vocabulary used by the
// math box. Everything is plain HTML: sub/sup and spans, no typesetting library.

import { h } from './dom.js';

export function bin(x, bits) {
  return x.toString(2).padStart(bits, '0');
}

export function brev(x, bits) {
  let r = 0;
  for (let i = 0; i < bits; i++) if ((x >> i) & 1) r |= 1 << (bits - 1 - i);
  return r;
}

export const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };

export function sup(n) { return String(n).split('').map((c) => SUP[c] || c).join(''); }
export function sub(n) { return String(n).split('').map((c) => SUB[c] || c).join(''); }

/** psi^e as a compact token, e.g. ψ⁻⁴ */
export function psiPow(e, inverse) {
  return 'ψ' + sup((inverse ? '-' : '') + e);
}

// --- math token builders -------------------------------------------------

export const mVar = (t) => h('span', { class: 'm-var' }, t);
export const mOp = (t) => h('span', { class: 'm-op' }, t);
export const mTw = (t) => h('span', { class: 'm-tw' }, t);
export const mRes = (t) => h('span', { class: 'm-res' }, t);
export const mIn = (t) => h('span', { class: 'm-in' }, t);

/** A whole maths line: <div class="math-line"><span class=lbl>..</span><span class=m>..</span></div> */
export function mathLine(label, ...tokens) {
  return h('div', { class: 'math-line' },
    h('span', { class: 'lbl' }, label || ''),
    h('span', { class: 'm' }, ...tokens));
}

/** "X[3]" with the index as a real subscript-free bracket, kept monospace. */
export function slot(name, i) {
  return h('span', {}, name, '[', String(i), ']');
}

export function modq(q) {
  return h('span', { class: 'm-op' }, ' mod ' + q);
}

/** Join tokens with an operator, e.g. joinOp(' + ', a, b) */
export function joinOp(op, ...tokens) {
  const out = [];
  tokens.forEach((t, i) => { if (i) out.push(mOp(op)); out.push(t); });
  return out;
}

export function commaList(arr) {
  return arr.join(', ');
}

/** Signed integers with a typographic minus, not a hyphen. */
export function num(v) {
  return v < 0 ? '\u2212' + String(-v) : String(v);
}

export function pct(v, q) {
  return Math.max(1.5, (100 * v) / (q - 1)).toFixed(1) + '%';
}
