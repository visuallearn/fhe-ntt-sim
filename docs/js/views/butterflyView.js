// The dataflow diagram: N rows, one column per stage, and the butterflies that
// connect them.
//
// This is the shape of the algorithm. Each column is the whole array at one
// moment; each crossing pair of lines is one butterfly. Reading left to right is
// reading the transform.

import { h, s, clear, panel } from '../dom.js';
import { set } from '../store.js';
import { sup } from '../fmt.js';

const NODE_W = 34;
const NODE_H = 15;
const GUT_L_PLAIN = 44;   // just the [i] row labels
const GUT_L_EXP = 100;    // row labels + evaluation-point exponents
const GUT_R = 104;

export function make() {
  const el = h('div', { class: 'p-flow' });
  let nodes = [];      // nodes[col][row] = {rect, text, owner}
  let wings = [];      // per butterfly: {b, edges:[...], twLab}
  let scaleWings = []; // per row in the scale column
  let cols = 0;
  let colX = [];
  let rowY = [];
  let alwaysLabels = false;
  let gutL = GUT_L_PLAIN;

  function geom(vm) {
    const p = vm.params;
    cols = vm.columns.length;
    // The inverse annotates its input column, which is on the left.
    gutL = vm.state.dir === 'forward' ? GUT_L_PLAIN : GUT_L_EXP;
    const rowH = p.N > 16 ? 18 : (p.N > 8 ? 21 : 26);
    const colW = 122;
    rowY = [];
    for (let i = 0; i < p.N; i++) rowY.push(34 + i * rowH + NODE_H / 2);
    colX = [];
    for (let c = 0; c < cols; c++) colX.push(gutL + NODE_W / 2 + c * colW);
    return {
      w: gutL + NODE_W + (cols - 1) * colW + (vm.state.dir === 'forward' ? GUT_R : 30),
      h: 34 + p.N * rowH + 14,
      rowH, colW,
    };
  }

  function colTitle(vm, c) {
    const logN = vm.params.logN;
    const fwd = vm.state.dir === 'forward';
    if (c === 0) return fwd ? 'input' : 'input';
    if (c <= logN) return 'stage ' + c;
    return '× N⁻¹';
  }

  function colSub(vm, c) {
    const logN = vm.params.logN;
    const fwd = vm.state.dir === 'forward';
    if (c === 0) return fwd ? 'coefficients' : 'bit-reversed';
    if (c === cols - 1) return fwd ? 'output' : 'coefficients';
    const st = vm.stageRegion.get(c);
    if (st === 'peeledFirst' || st === 'peeledLast') return 'unrolled';
    return 't = ' + (fwd ? vm.params.N / Math.pow(2, c) : Math.pow(2, c - 1));
  }

  function build(vm) {
    clear(el);
    nodes = []; wings = []; scaleWings = [];
    const p = vm.params;
    const g = geom(vm);
    // Up to N=16 every value fits without crowding. At N=32 we show the column
    // being computed and the one it reads from, which is what you actually need
    // to follow a butterfly, and offer the rest behind a toggle.
    alwaysLabels = p.N <= 16 || vm.state.showAllValues;

    const svg = s('svg', {
      width: g.w, height: g.h, viewBox: `0 0 ${g.w} ${g.h}`,
      role: 'img', 'aria-label': `Dataflow diagram: ${p.N} values across ${p.logN} stages`,
    });

    // Tint the columns produced by an unrolled (peeled) loop.
    for (let c = 1; c < cols; c++) {
      const r = vm.stageRegion.get(c);
      if (r === 'peeledFirst' || r === 'peeledLast') {
        svg.append(s('rect', {
          class: 'peelbox', x: colX[c] - NODE_W / 2 - 7, y: 22,
          width: NODE_W + 14, height: g.h - 32, rx: 4,
        }));
      }
    }

    // Column headers.
    for (let c = 0; c < cols; c++) {
      svg.append(s('text', { class: 'col-head', x: colX[c], y: 12, 'text-anchor': 'middle' }, colTitle(vm, c)));
      svg.append(s('text', { class: 'col-sub', x: colX[c], y: 23, 'text-anchor': 'middle' }, colSub(vm, c)));
    }

    // Row labels.
    for (let i = 0; i < p.N; i++) {
      svg.append(s('text', { class: 'rowlab', x: gutL - 8, y: rowY[i] + 3, 'text-anchor': 'end' }, '[' + i + ']'));
    }

    // Edges first so nodes sit on top.
    const edgeLayer = s('g', {});
    const labelLayer = s('g', {});
    svg.append(edgeLayer, labelLayer);

    const fwd = vm.state.dir === 'forward';
    for (const b of vm.butterflies) {
      const c = b.stage;
      const x0 = colX[c - 1] + NODE_W / 2;
      const x1 = colX[c] - NODE_W / 2;
      const yl = rowY[b.lo];
      const yh = rowY[b.hi];
      // Cooley-Tukey multiplies the *incoming* hi value; Gentleman-Sande
      // multiplies the *outgoing* hi value. So the dashed "x omega" edges hang
      // off different ends depending on direction.
      const mk = (ya, yb, mul) => {
        const e = s('path', {
          class: 'edge' + (mul ? ' mul' : ''),
          d: `M${x0} ${ya} C${x0 + 26} ${ya} ${x1 - 26} ${yb} ${x1} ${yb}`,
        });
        edgeLayer.append(e);
        return e;
      };
      const edges = [
        mk(yl, yl, false),
        mk(yh, yl, fwd),
        mk(yl, yh, !fwd),
        mk(yh, yh, true),
      ];
      // Nudge the label off the exact midpoint: that is where the densest
      // bundle of crossing edges sits.
      const twLab = s('text', {
        class: 'twlab', x: x0 + (x1 - x0) * 0.66, y: (yl + yh) / 2 - 2, 'text-anchor': 'middle',
      }, '×' + b.tw);
      labelLayer.append(twLab);
      wings.push({ b, edges, twLab });
    }

    // The trailing n^-1 pass, if present: only the lower half is multiplied,
    // because the upper half already absorbed n^-1 into the last twiddle.
    if (vm.scales.length) {
      const c = cols - 1;
      const x0 = colX[c - 1] + NODE_W / 2;
      const x1 = colX[c] - NODE_W / 2;
      for (let i = 0; i < p.N; i++) {
        const sc = vm.scales.find((z) => z.idx === i);
        const e = s('path', {
          class: 'edge' + (sc ? ' mul' : ''),
          d: `M${x0} ${rowY[i]} L${x1} ${rowY[i]}`,
        });
        edgeLayer.append(e);
        let lab = null;
        if (sc) {
          lab = s('text', {
            class: 'twlab', x: (x0 + x1) / 2, y: rowY[i] - 3, 'text-anchor': 'middle',
          }, '×' + sc.factor);
          labelLayer.append(lab);
        }
        scaleWings.push({ idx: i, edge: e, lab, step: sc ? sc.step : vm.scaleStart });
      }
    }

    // Nodes.
    for (let c = 0; c < cols; c++) {
      nodes.push([]);
      for (let i = 0; i < p.N; i++) {
        const rect = s('rect', {
          class: 'node', x: colX[c] - NODE_W / 2, y: rowY[i] - NODE_H / 2,
          width: NODE_W, height: NODE_H, rx: 3,
        });
        const text = s('text', { class: 'nval', x: colX[c], y: rowY[i] + 0.5 }, '');
        const owner = vm.owner[c][i];
        const g2 = s('g', {
          style: owner >= 0 ? 'cursor:pointer' : '',
          onclick: owner >= 0 ? () => set({ step: owner, playing: false }) : null,
        }, rect, text);
        svg.append(g2);
        nodes[c].push({ rect, text, owner });
      }
    }

    // Evaluation-point annotations on whichever end is bit-reversed.
    const ep = vm.case && vm.case.evalPoints;
    if (ep) {
      const atEnd = fwd;
      // On the left, sit clear of the row labels rather than on top of them.
      const x = atEnd ? colX[cols - 1] + NODE_W / 2 + 24 : gutL - 42;
      for (let i = 0; i < p.N; i++) {
        svg.append(s('text', {
          class: 'outexp', x, y: rowY[i] + 3,
          'text-anchor': atEnd ? 'start' : 'end',
        }, 'ψ' + sup(ep[i].exp)));
      }
      // Always start-anchored: right-anchored in the left gutter clipped the word.
      svg.append(s('text', {
        class: 'col-head', x: atEnd ? x : 2, y: 12, 'text-anchor': 'start',
      }, 'evaluated at'));
    }

    const legend = h('div', { class: 'flow-legend' },
      h('span', { class: 'l-pend' }, 'not computed yet'),
      h('span', { class: 'l-set' }, 'computed'),
      h('span', { class: 'l-act' }, 'current butterfly'),
      h('span', { class: 'l-mul' }, 'multiplied by a twiddle'),
      p.N > 8 ? h('button', {
        type: 'button', 'aria-pressed': String(vm.state.showAllValues),
        style: 'margin-left:auto',
        onclick: () => set({ showAllValues: !vm.state.showAllValues }),
      }, 'show every value') : null);

    const peeled = h('details', { class: 'note' },
      h('summary', {}, 'The reason one column looks different'),
      h('p', {}, 'OpenFHE writes the shaded column as a separate loop, outside the main '
        + 'loop. Engineers call this method “peeling”. It makes the code faster. The '
        + 'mathematics is the same as an ordinary stage, with the same butterflies. '
        + 'The code cursor moves to that loop when you reach this column.'),
      vm.state.dir === 'inverse'
        ? h('p', {}, 'The inverse peels its ', h('em', {}, 'first'),
          ' stage. Its last stage also does the division by N. The twiddle there is ω₁⁻¹ = ',
          String(vm.tables.omega1Inv.v), '. That value is ψ⁻', h('sup', {}, String(p.N / 2)),
          ' and N⁻¹ combined into one number. Only the lower half then needs a separate ×N⁻¹.')
        : h('p', {}, 'The forward transform peels its ', h('em', {}, 'last'), ' stage.'));

    el.append(panel('Dataflow',
      h('span', { class: 'badge' }, vm.state.dir === 'forward' ? 'Cooley–Tukey' : 'Gentleman–Sande'),
      h('div', { class: 'flow-wrap' }, h('div', { class: 'flow' }, svg)),
      legend, peeled));
  }

  function update(vm) {
    const cur = vm.index;
    const curEv = vm.ev;
    const activeIsBfly = curEv && (curEv.k === 'bfly_ct' || curEv.k === 'bfly_gs');

    // Nodes: value + state.
    for (let c = 0; c < cols; c++) {
      for (let i = 0; i < vm.params.N; i++) {
        const nd = nodes[c][i];
        const done = nd.owner <= cur;
        const active = activeIsBfly && nd.owner === cur;
        nd.rect.setAttribute('class', 'node' + (active ? ' active' : done ? ' settled' : ''));
        nd.text.setAttribute('class', 'nval' + (active ? ' active' : done ? ' settled' : ''));
        const stage = vm.ctx.stage;
        const show = done && (alwaysLabels || active || c === 0 || c === cols - 1
          || nd.owner === cur || c === stage || c === stage - 1);
        nd.text.textContent = show ? String(vm.columns[c][i]) : (done ? '·' : '');
      }
    }

    // Butterfly wings.
    for (const w of wings) {
      const done = w.b.step <= cur;
      const active = w.b.step === cur;
      for (const e of w.edges) {
        const mul = e.getAttribute('class').includes('mul');
        e.setAttribute('class', 'edge' + (mul ? ' mul' : '')
          + (active ? ' active' : done ? ' settled' : ''));
      }
      w.twLab.style.display = (alwaysLabels || active) && done ? '' : 'none';
    }

    // Scale pass.
    for (const w of scaleWings) {
      const done = w.step <= cur;
      const active = w.step === cur && curEv && curEv.k === 'scale';
      const mul = w.edge.getAttribute('class').includes('mul');
      w.edge.setAttribute('class', 'edge' + (mul ? ' mul' : '')
        + (active ? ' active' : done ? ' settled' : ''));
      if (w.lab) w.lab.style.display = (alwaysLabels || active) && done ? '' : 'none';
    }
  }

  return { el, build, update };
}
