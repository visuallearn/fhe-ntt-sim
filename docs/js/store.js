// One mutable state object plus subscribers. Two notification kinds:
//   'structure' -- the thing being viewed changed (config, case, direction, route),
//                  so views rebuild their DOM;
//   'step'      -- only the position in the trace moved, so views just retint.
// Keeping those apart is what makes playback smooth without a virtual DOM.

const listeners = { structure: [], step: [] };

export const state = {
  manifest: null,
  source: null,
  route: 'tour',
  N: 8,
  bits: 5,
  trace: null,
  caseId: 'delta1',
  dir: 'forward',
  step: 0,
  playing: false,
  speed: 1,
  granularity: 'butterfly', // 'butterfly' | 'stage'
  showAllValues: false,
  showAdvanced: false,
  showClang: false,
  twTab: 'auto', // 'auto' | 'fwd' | 'inv'
  convId: 'wrap',
  convPart: 'forwardA',
  rootsSlot: 0,
  tourStep: 0,
};

/**
 * Subscribe. Returns an unsubscribe function -- routes MUST call it from their
 * unmount(), or navigating away and back leaves the old route's handlers running
 * against detached DOM for the rest of the session.
 */
export function on(kind, fn) {
  listeners[kind].push(fn);
  return function off() {
    const i = listeners[kind].indexOf(fn);
    if (i >= 0) listeners[kind].splice(i, 1);
  };
}

export function emit(kind) {
  // Iterate a copy: a handler is allowed to unsubscribe (or subscribe) while we
  // are notifying, and splicing the live array mid-loop would skip a listener.
  for (const fn of listeners[kind].slice()) fn(state);
}

/** Number of live subscribers, for leak checks. */
export function listenerCount() {
  return listeners.structure.length + listeners.step.length;
}

/** Merge patch into state and notify. Any key outside STEP_ONLY implies a rebuild. */
const STEP_ONLY = new Set(['step', 'playing', 'rootsSlot']);

export function set(patch) {
  let structural = false;
  for (const [k, v] of Object.entries(patch)) {
    if (state[k] === v) continue;
    state[k] = v;
    if (!STEP_ONLY.has(k)) structural = true;
  }
  emit(structural ? 'structure' : 'step');
}
