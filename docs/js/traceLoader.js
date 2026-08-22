// Fetch and cache the generated data. Relative paths only: the site lives under
// /<repo>/ on GitHub Pages, never at a domain root.

const cache = new Map();

async function getJSON(path) {
  if (cache.has(path)) return cache.get(path);
  const p = fetch(path, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  });
  cache.set(path, p);
  return p;
}

export function loadManifest() {
  return getJSON('data/manifest.json');
}

export async function loadSource() {
  const [forward, inverse, precompute, citations] = await Promise.all([
    getJSON('data/source/forward.json'),
    getJSON('data/source/inverse.json'),
    getJSON('data/source/precompute.json'),
    getJSON('data/source/citations.json'),
  ]);
  return { forward, inverse, precompute, citations };
}

export function configFor(manifest, N, bits) {
  return manifest.configs.find((c) => c.N === N && c.bits === bits && c.feasible);
}

export async function loadTrace(manifest, N, bits) {
  const cfg = configFor(manifest, N, bits);
  if (!cfg) throw new Error(`no feasible trace for N=${N}, bits=${bits}`);
  const t = await getJSON('data/' + cfg.file);
  // Cheap shape check: a corrupted or half-written file should say so loudly
  // rather than render as a blank diagram.
  if (t.schemaVersion !== 1) throw new Error(`${cfg.file}: unexpected schemaVersion`);
  if (t.params.N !== N || t.params.bits !== bits) throw new Error(`${cfg.file}: params do not match request`);
  if (t.tables.fwd.length !== N) throw new Error(`${cfg.file}: forward table length`);
  return t;
}

export function caseOf(trace, id) {
  return trace.cases.find((c) => c.id === id) || trace.cases[0];
}

export function convOf(trace, id) {
  return trace.convolutions.find((c) => c.id === id) || trace.convolutions[0];
}
