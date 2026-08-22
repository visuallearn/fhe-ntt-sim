// Bootstrap and hash router.

import { state, set, on, emit } from './store.js';
import { loadManifest, loadSource, loadTrace, configFor } from './traceLoader.js';
import { h, clear } from './dom.js';

const ROUTES = ['tour', 'transform', 'roots', 'convolution', 'about'];
const loaders = {
  tour: () => import('./routes/tour.js'),
  transform: () => import('./routes/transform.js'),
  roots: () => import('./routes/roots.js'),
  convolution: () => import('./routes/convolution.js'),
  about: () => import('./routes/about.js'),
};

const main = document.getElementById('main');
let active = null;
let activeRoute = null;
let syncing = false;

// ---------------------------------------------------------------- hash <-> state

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const route = ROUTES.includes(path) ? path : null;
  const q = new URLSearchParams(qs || '');
  const num = (k) => (q.has(k) ? Number(q.get(k)) : undefined);
  return {
    route,
    N: num('N'), bits: num('bits'), step: num('step'),
    caseId: q.get('case') || undefined,
    dir: q.get('dir') === 'inverse' ? 'inverse' : (q.get('dir') === 'forward' ? 'forward' : undefined),
    convId: q.get('conv') || undefined,
    tourStep: num('t'),
  };
}

function writeHash() {
  if (syncing) return;
  const q = new URLSearchParams();
  if (state.route === 'transform') {
    q.set('N', state.N); q.set('bits', state.bits);
    q.set('case', state.caseId); q.set('dir', state.dir); q.set('step', state.step);
  } else if (state.route === 'convolution') {
    q.set('N', state.N); q.set('bits', state.bits); q.set('conv', state.convId);
  } else if (state.route === 'roots') {
    q.set('N', state.N); q.set('bits', state.bits);
  } else if (state.route === 'tour') {
    q.set('t', state.tourStep);
  }
  const s = q.toString();
  const next = '#/' + state.route + (s ? '?' + s : '');
  if (location.hash !== next) {
    syncing = true;
    history.replaceState(null, '', next);
    syncing = false;
  }
}

// ---------------------------------------------------------------- chrome

function paintChrome() {
  const of = state.manifest.openfhe;
  document.getElementById('topbar-sub').textContent =
    `OpenFHE ${of.version} · ${of.tag} @ ${of.commitShort} · single modulus, no RNS`;
  document.getElementById('foot-version').textContent = `v${of.version} (${of.tag}, ${of.commitShort})`;
  for (const a of document.querySelectorAll('.topbar-nav a')) {
    if (a.dataset.route === state.route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

// A blank page is the worst possible failure mode for a teaching site, so any
// uncaught error becomes a visible, quotable banner. It also gives headless
// checks something to assert on.
function clearBanner() {
  const el = document.getElementById('errbanner');
  if (el) el.remove();
}

function banner(msg) {
  let el = document.getElementById('errbanner');
  if (!el) {
    el = h('div', {
      id: 'errbanner', role: 'alert',
      style: 'position:sticky;top:0;z-index:50;padding:.6rem 1rem;'
        + 'background:var(--warn-soft);color:var(--warn);border-bottom:2px solid var(--warn);'
        + 'font-family:var(--mono);font-size:.78rem;white-space:pre-wrap',
    });
    document.body.insertBefore(el, document.body.firstChild);
  }
  el.textContent = 'Error: ' + msg;
}

window.addEventListener('error', (e) => banner(e.message || String(e.error)));
window.addEventListener('unhandledrejection', (e) => banner(
  'unhandled rejection: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason))));

function fail(err) {
  banner(String(err && err.message ? err.message : err));
  clear(main);
  main.append(h('div', { class: 'route-prose' },
    h('h1', {}, 'The trace data did not load'),
    h('p', {}, String(err && err.message ? err.message : err)),
    h('p', { class: 'hint' },
      'A browser blocks module and fetch requests on file:// URLs. If you opened this '
      + 'page from a local copy, serve the docs directory over HTTP. For example: ',
      h('code', {}, 'python3 -m http.server -d docs'), '.')));
  // eslint-disable-next-line no-console
  console.error(err);
}

// ---------------------------------------------------------------- trace loading

/** Force every selection to something the loaded trace actually contains. */
function normaliseSelection() {
  const t = state.trace;
  if (!t) return;
  if (!t.cases.some((c) => c.id === state.caseId)) state.caseId = t.cases[0].id;
  if (!t.convolutions.some((c) => c.id === state.convId)) state.convId = t.convolutions[0].id;
  if (state.dir !== 'forward' && state.dir !== 'inverse') state.dir = 'forward';
  const total = t.cases[0][state.dir].events.length;
  if (!Number.isFinite(state.step) || state.step < 0) state.step = 0;
  if (state.step > total) state.step = 0;
  if (!Number.isFinite(state.rootsSlot) || state.rootsSlot < 0 || state.rootsSlot >= t.params.N) {
    state.rootsSlot = 0;
  }
}

async function ensureTrace() {
  if (!configFor(state.manifest, state.N, state.bits)) {
    const d = state.manifest.default;
    state.N = d.N; state.bits = d.bits;
  }
  if (!state.trace || state.trace.params.N !== state.N || state.trace.params.bits !== state.bits) {
    state.trace = await loadTrace(state.manifest, state.N, state.bits);
  }
  // Run every time, not just after a fetch: a hand-edited URL can name a case
  // that does not exist while the right trace is already loaded, which used to
  // leave the picker with nothing selected and echo the bad id back to the hash.
  normaliseSelection();
}

// ---------------------------------------------------------------- routing

async function go() {
  const want = parseHash();
  const route = want.route || state.manifest.default.route || 'tour';

  const patch = {};
  if (want.N !== undefined) patch.N = want.N;
  if (want.bits !== undefined) patch.bits = want.bits;
  if (want.caseId !== undefined) patch.caseId = want.caseId;
  if (want.dir !== undefined) patch.dir = want.dir;
  if (want.convId !== undefined) patch.convId = want.convId;
  if (want.tourStep !== undefined) patch.tourStep = want.tourStep;
  Object.assign(state, patch);
  state.route = route;

  try {
    await ensureTrace();
  } catch (e) { fail(e); return; }

  if (want.step !== undefined) state.step = want.step;
  normaliseSelection();

  paintChrome();

  if (activeRoute !== route) {
    if (active && active.unmount) active.unmount();
    const mod = await loaders[route]();
    active = mod.mount(main);
    activeRoute = route;
  } else {
    // Same route, different parameters. state was assigned directly above (to
    // avoid a notification storm mid-load), so nudge the views once now.
    emit('structure');
  }
  document.body.dataset.ready = route;
  // A route mounted successfully, so whatever the last complaint was, it is over.
  // Without this a single transient failure stayed on screen for the session.
  clearBanner();
  writeHash();
}

// ---------------------------------------------------------------- keyboard

function isTyping(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
}

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || isTyping(document.activeElement)) return;
  if (active && active.keys && active.keys(e)) e.preventDefault();
});

window.addEventListener('hashchange', () => { if (!syncing) go(); });
on('structure', writeHash);
on('step', writeHash);

// ---------------------------------------------------------------- start

(async () => {
  try {
    const [manifest, source] = await Promise.all([loadManifest(), loadSource()]);
    state.manifest = manifest;
    state.source = source;
    const d = manifest.default || {};
    state.N = d.N ?? 8;
    state.bits = d.bits ?? 5;
    state.caseId = d.case ?? 'delta1';
    state.dir = d.dir ?? 'forward';
    if (!location.hash) location.replace('#/tour');
    await go();
  } catch (e) { fail(e); }
})();

// A view can change the route, or the ring dimension / modulus, straight through
// the store. A route change needs a remount; a configuration change needs the
// matching trace file, which is a fetch. Without this, picking a new N updated
// the hash and the pickers but left every panel rendering the previous trace.
let loadingTrace = false;

function traceMatches() {
  const t = state.trace;
  return !!t && t.params.N === state.N && t.params.bits === state.bits;
}

on('structure', async () => {
  if (!state.manifest) return;
  if (state.route !== activeRoute) { go(); return; }
  if (traceMatches() || loadingTrace) return;
  loadingTrace = true;
  try {
    await ensureTrace();
  }
  catch (e) { fail(e); return; }
  finally { loadingTrace = false; }
  // Now that the right trace is in hand, let the views draw it.
  emit('structure');
});

export { traceMatches };

export { set };
