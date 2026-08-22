// The main route: everything about one transform of one input, side by side.

import { h, clear } from '../dom.js';
import { state, set, on } from '../store.js';
import { stateAt, columns, butterflies, scales, stageStarts } from '../replay.js';
import { caseOf } from '../traceLoader.js';
import { brev } from '../fmt.js';
import { makePlayer } from '../player.js';

import { make as makeConfig } from '../views/configPanel.js';
import { make as makeTwiddles } from '../views/twiddleTable.js';
import { make as makeArray } from '../views/arrayView.js';
import { make as makeFlow } from '../views/butterflyView.js';
import { make as makeMath } from '../views/mathBox.js';
import { make as makeCode } from '../views/codePanel.js';
import { make as makeTimeline } from '../views/timeline.js';

/** Everything the panels need for the current step, computed once per frame. */
export function frame() {
  const trace = state.trace;
  const params = trace.params;
  const c = caseOf(trace, state.caseId);
  const direction = c[state.dir];
  const total = direction.events.length;
  const step = Math.max(0, Math.min(state.step, total - 1));
  const { array, ev, ctx, index } = stateAt(direction, step, params.q);

  const cols = columns(direction);
  const starts = stageStarts(direction);
  const bf = butterflies(direction);
  const sc = scales(direction);

  const stageRegion = new Map();
  for (let col = 1; col < cols.length; col++) {
    const st = starts[col - 1];
    stageRegion.set(col, st ? st.region : null);
  }
  const scaleStart = (starts.find((z) => z.region === 'scale') || {}).step;

  const owner = cols.map(() => new Array(params.N).fill(Infinity));
  owner[0].fill(-1);
  for (const b of bf) { owner[b.stage][b.lo] = b.step; owner[b.stage][b.hi] = b.step; }
  if (sc.length) {
    const last = cols.length - 1;
    for (let i = 0; i < params.N; i++) {
      const hit = sc.find((z) => z.idx === i);
      owner[last][i] = hit ? hit.step : scaleStart;
    }
  }

  return {
    state, manifest: state.manifest, source: state.source,
    trace, params, tables: trace.tables,
    case: c, direction, array, ev, ctx, index, total,
    columns: cols, butterflies: bf, scales: sc, stageStarts: starts,
    stageRegion, owner, scaleStart,
    brev: (x) => brev(x, params.brevBits),
  };
}

/** True when state.trace is the trace the current selection asks for. */
function stale() {
  const t = state.trace;
  return !!t && t.params.N === state.N && t.params.bits === state.bits;
}

export function mount(root) {
  clear(root);
  const player = makePlayer(frame);

  const panels = {
    config: makeConfig(),
    twiddles: makeTwiddles(),
    array: makeArray(),
    flow: makeFlow(),
    math: makeMath(),
    code: makeCode(),
  };
  const timeline = makeTimeline(player);

  // Left: what you are looking at. Middle: what is happening. Right: the
  // working and the code. Each column stacks on its own so a long panel on one
  // side never pushes another side out of view.
  const grid = h('div', { class: 'tx' },
    panels.config.el,
    h('div', { class: 'tx-col' },
      panels.flow.el,
      h('div', { class: 'tx-pair' }, panels.array.el, panels.twiddles.el)),
    h('div', { class: 'tx-col tx-right' }, panels.math.el, panels.code.el));

  const wrap = h('div', { class: 'route' }, grid, timeline.el);
  root.append(wrap);

  const live = document.getElementById('live');

  function narrate(vm) {
    const ev = vm.ev;
    if (!ev) return '';
    if (ev.k === 'bfly_ct') {
      return `Stage ${vm.ctx.stage}. The butterfly uses slots ${ev.lo} and ${ev.hi} `
        + `with twiddle ${ev.tw}. The results are ${ev.outLo} and ${ev.outHi}.`;
    }
    if (ev.k === 'bfly_gs') {
      return `Stage ${vm.ctx.stage}. The butterfly uses slots ${ev.lo} and ${ev.hi} `
        + `with twiddle ${ev.tw}. The sum is ${ev.sum}. The scaled difference is ${ev.outHi}.`;
    }
    if (ev.k === 'tw') return `The twiddle factor is ${ev.tw}, from table slot ${ev.twIndex}.`;
    if (ev.k === 'stage') {
      return ev.region === 'scale' ? 'The last operation multiplies by N inverse.'
        : `Stage ${ev.stage} of ${vm.ctx.stages}. The stride is ${ev.t}.`;
    }
    if (ev.k === 'scale') return `The value in slot ${ev.idx} becomes ${ev.out}.`;
    if (ev.k === 'end') return 'The transform is complete.';
    return '';
  }

  let structureToken = '';

  function rebuildIfNeeded() {
    const token = [state.N, state.bits, state.caseId, state.dir,
      state.showAllValues, state.showClang, state.twTab].join('|');
    if (token === structureToken) return false;
    structureToken = token;
    const vm = frame();
    for (const p of Object.values(panels)) p.build(vm);
    timeline.build(vm);
    return true;
  }

  function render() {
    // Skip a frame while a newly selected configuration is still loading: better
    // a held image than one that claims N=32 while showing N=8 numbers.
    if (!stale()) return;
    rebuildIfNeeded();
    const vm = frame();
    for (const p of Object.values(panels)) p.update(vm);
    timeline.update(vm);
    if (live) live.textContent = narrate(vm);
  }

  const unsubs = [
    on('structure', render),
    on('step', () => {
      if (!stale()) return;
      const vm = frame();
      for (const p of Object.values(panels)) p.update(vm);
      timeline.update(vm);
      if (live) live.textContent = narrate(vm);
    }),
    // Speed changes are structural in the store's terms, but the running timer
    // has to be re-armed for the new interval.
    on('structure', () => player.restartTimerIfPlaying()),
  ];

  render();

  return {
    unmount() {
      player.pause();
      for (const off of unsubs) off();
    },
    keys(e) {
      if (e.key === 'ArrowRight') { player.next(); return true; }
      if (e.key === 'ArrowLeft') { player.prev(); return true; }
      if (e.key === 'ArrowDown') { player.nextStage(); return true; }
      if (e.key === 'ArrowUp') { player.prevStage(); return true; }
      if (e.key === 'Home') { player.home(); return true; }
      if (e.key === 'End') { player.end(); return true; }
      if (e.key === ' ') { player.toggle(); return true; }
      if (e.key === 'f') { set({ dir: 'forward', step: 0, twTab: 'auto' }); return true; }
      if (e.key === 'i') { set({ dir: 'inverse', step: 0, twTab: 'auto' }); return true; }
      return false;
    },
  };
}
