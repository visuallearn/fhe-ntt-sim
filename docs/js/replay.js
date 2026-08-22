// Fold a recorded event stream into the array state at a given step.
//
// The traces carry no per-event array snapshot -- that would multiply the data
// size by N. They carry a keyframe at every stage boundary instead, and the
// arithmetic needed to get from one to the next is a handful of adds and one
// multiply per butterfly, so replaying forward from the nearest keyframe is
// instant even while scrubbing.

/** Number of "positions" in a direction: one per event. */
export function stepCount(dir) { return dir.events.length; }

/**
 * State after applying events[0..step] inclusive.
 * Returns { array, ev, ctx } where ctx accumulates the loop variables that the
 * code panel and math box need.
 */
export function stateAt(direction, step, q) {
  const evs = direction.events;
  const n = Math.max(0, Math.min(step, evs.length - 1));

  // Nearest keyframe at or before n.
  let kfIdx = 0;
  for (let i = 0; i < direction.keyframes.length; i++) {
    if (direction.keyframes[i].s <= n) kfIdx = i; else break;
  }
  const kf = direction.keyframes[kfIdx];
  const array = kf.array.slice();

  // Loop context has to be recovered from the start: it is set by `stage` and
  // `tw` events, which are cheap to rescan (a few hundred at N=32).
  const ctx = {
    stage: 0, stages: 0, region: null, m: null, t: null, logt: null,
    tw: null, twIndex: null, twExp: null, fused: false,
    lo: null, hi: null, scaling: false,
  };
  for (let i = 0; i <= n; i++) {
    const e = evs[i];
    if (e.k === 'stage') {
      ctx.region = e.region;
      ctx.scaling = e.region === 'scale';
      if (!ctx.scaling) {
        ctx.stage = e.stage; ctx.m = e.m; ctx.t = e.t; ctx.logt = e.logt;
      }
    } else if (e.k === 'tw') {
      ctx.tw = e.tw; ctx.twIndex = e.twIndex; ctx.twExp = e.twExp; ctx.fused = !!e.fused;
    }
  }
  ctx.stages = direction.events.filter((e) => e.k === 'stage' && e.region !== 'scale').length;

  // Apply the value-changing events between the keyframe and n.
  for (let i = kf.s; i <= n; i++) {
    const e = evs[i];
    if (e.k === 'bfly_ct' || e.k === 'bfly_gs') {
      array[e.lo] = e.outLo;
      array[e.hi] = e.outHi;
    } else if (e.k === 'scale') {
      array[e.idx] = e.out;
    }
  }

  const ev = evs[n];
  if (ev && (ev.k === 'bfly_ct' || ev.k === 'bfly_gs')) { ctx.lo = ev.lo; ctx.hi = ev.hi; }
  else if (ev && ev.k === 'scale') { ctx.lo = ev.idx; ctx.hi = null; }

  void q;
  return { array, ev, ctx, index: n };
}

/**
 * Column snapshots for the dataflow diagram: keyframes are exactly the stage
 * boundaries, so keyframes[i].array is the array entering column i.
 */
export function columns(direction) {
  return direction.keyframes.map((k) => k.array);
}

/** All butterflies, grouped by stage, with the step that performs each. */
export function butterflies(direction) {
  const out = [];
  for (let i = 0; i < direction.events.length; i++) {
    const e = direction.events[i];
    if (e.k === 'bfly_ct' || e.k === 'bfly_gs') {
      out.push({ step: i, stage: e.stage, lo: e.lo, hi: e.hi, tw: e.tw, twIndex: e.twIndex, fused: !!e.fused, kind: e.k });
    }
  }
  return out;
}

/** The trailing n^-1 multiplications, if any (inverse only). */
export function scales(direction) {
  const out = [];
  for (let i = 0; i < direction.events.length; i++) {
    const e = direction.events[i];
    if (e.k === 'scale') out.push({ step: i, idx: e.idx, factor: e.factor, in: e.in, out: e.out });
  }
  return out;
}

/** Steps at which each stage begins, for the stage ribbon and jump buttons. */
export function stageStarts(direction) {
  const out = [];
  for (let i = 0; i < direction.events.length; i++) {
    const e = direction.events[i];
    if (e.k === 'stage') out.push({ step: i, stage: e.stage ?? null, region: e.region });
  }
  return out;
}
