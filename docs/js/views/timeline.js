// Transport controls: step, play, jump between stages.

import { h, clear } from '../dom.js';
import { set, state } from '../store.js';

export function make(player) {
  const el = h('div', { class: 'transport' });
  let count = null;
  let ribbon = null;
  let playBtn = null;
  let granBtn = null;
  let starts = [];

  function build(vm) {
    clear(el);
    starts = vm.stageStarts;

    const btn = (label, title, fn, key) => h('button', {
      type: 'button', title: title + (key ? `  (${key})` : ''), 'aria-label': title, onclick: fn,
    }, label);

    playBtn = h('button', {
      type: 'button', title: 'Play / pause  (Space)', 'aria-label': 'Play',
      onclick: () => player.toggle(),
    }, '▶');

    ribbon = h('div', { class: 'stage-ribbon', role: 'group', 'aria-label': 'Jump to stage' });
    for (const st of starts) {
      const label = st.region === 'scale' ? '×N⁻¹' : 'stage ' + st.stage;
      ribbon.append(h('button', {
        type: 'button',
        class: st.region === 'peeledFirst' || st.region === 'peeledLast' ? 'peeled' : '',
        title: st.region === 'scale' ? 'The trailing multiply by N⁻¹'
          : `Stage ${st.stage} — ${st.region === 'main' || st.region === 'inner' ? 'main loop' : 'unrolled in the source'}`,
        onclick: () => set({ step: st.step, playing: false }),
      }, label));
    }

    count = h('span', { class: 'transport-count' }, '');

    const speed = h('select', {
      'aria-label': 'Playback speed',
      onchange: (e) => set({ speed: Number(e.target.value) }),
    }, ...[0.25, 0.5, 1, 2, 4].map((v) => h('option', {
      value: String(v), selected: v === state.speed ? true : null,
    }, v + '×')));

    granBtn = h('button', {
      type: 'button', 'aria-pressed': String(state.granularity === 'stage'),
      title: 'Go forward one whole stage, not one butterfly',
      onclick: () => set({ granularity: state.granularity === 'stage' ? 'butterfly' : 'stage' }),
    }, 'stage steps');

    el.append(
      h('div', { class: 'transport-group' },
        btn('⏮', 'Back to the start', () => player.home(), 'Home'),
        btn('◀◀', 'Previous stage', () => player.prevStage(), '↑'),
        btn('◀', 'Previous step', () => player.prev(), '←'),
        playBtn,
        btn('▶', 'Next step', () => player.next(), '→'),
        btn('▶▶', 'Next stage', () => player.nextStage(), '↓'),
        btn('⏭', 'Jump to the end', () => player.end(), 'End')),
      ribbon,
      count,
      h('div', { class: 'transport-group' }, granBtn, speed));
  }

  function update(vm) {
    // Kept in update() rather than build(): toggling granularity does not change
    // the structure, so build() is not re-run and the button would look stuck.
    granBtn.setAttribute('aria-pressed', String(vm.state.granularity === 'stage'));
    playBtn.textContent = vm.state.playing ? '⏸' : '▶';
    playBtn.setAttribute('aria-label', vm.state.playing ? 'Pause' : 'Play');
    count.textContent = `step ${vm.index + 1} / ${vm.total}`;
    const kids = ribbon.children;
    for (let i = 0; i < starts.length; i++) {
      const from = starts[i].step;
      const to = i + 1 < starts.length ? starts[i + 1].step : Infinity;
      kids[i].classList.toggle('active', vm.index >= from && vm.index < to);
      kids[i].classList.toggle('done', vm.index >= to);
    }
  }

  return { el, build, update };
}
