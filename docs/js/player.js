// Playback over a trace's event list.

import { state, set } from './store.js';

const BASE_MS = 750;

export function makePlayer(getFrame) {
  let timer = null;

  const total = () => getFrame().total;
  const starts = () => getFrame().stageStarts.map((s) => s.step);

  function goto(i) {
    const t = total();
    const clamped = Math.max(0, Math.min(i, t - 1));
    set({ step: clamped });
    return clamped;
  }

  function nextIndex(from) {
    if (state.granularity === 'stage') {
      const s = starts().find((x) => x > from);
      return s === undefined ? total() - 1 : s;
    }
    return from + 1;
  }

  function prevIndex(from) {
    if (state.granularity === 'stage') {
      const before = starts().filter((x) => x < from);
      return before.length ? before[before.length - 1] : 0;
    }
    return from - 1;
  }

  function tick() {
    const t = total();
    const nxt = nextIndex(state.step);
    if (nxt >= t - 1) {
      goto(t - 1);
      pause();
      return;
    }
    goto(nxt);
  }

  function play() {
    if (timer) return;
    if (state.step >= total() - 1) set({ step: 0 });
    set({ playing: true });
    timer = setInterval(tick, BASE_MS / state.speed);
  }

  function pause() {
    if (timer) { clearInterval(timer); timer = null; }
    if (state.playing) set({ playing: false });
  }

  function restartTimerIfPlaying() {
    if (timer) { clearInterval(timer); timer = setInterval(tick, BASE_MS / state.speed); }
  }

  return {
    play,
    pause,
    toggle() { if (state.playing) pause(); else play(); },
    next() { pause(); goto(nextIndex(state.step)); },
    prev() { pause(); goto(prevIndex(state.step)); },
    home() { pause(); goto(0); },
    end() { pause(); goto(total() - 1); },
    nextStage() {
      pause();
      const s = starts().find((x) => x > state.step);
      goto(s === undefined ? total() - 1 : s);
    },
    prevStage() {
      pause();
      const before = starts().filter((x) => x < state.step);
      goto(before.length ? before[before.length - 1] : 0);
    },
    restartTimerIfPlaying,
  };
}
