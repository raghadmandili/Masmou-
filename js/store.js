// Persistence (browser localStorage) + shipped references from data/references.json.
// Everything is keyed by ayah key "surah:ayah", e.g. "112:1".
const read = (k, d) => { try { return JSON.parse(localStorage.getItem('ms2_' + k)) ?? d; } catch { return d; } };

export const state = {
  refs: read('refs', {}),                          // references recorded on this device
  base: {},                                        // references shipped with the app (data/references.json)
  log: read('log', []),                            // labeled test attempts: {key, d, d0, truth, ts}
  hist: read('hist', []),                          // recitation history: {key, d, k, ts}
  marks: read('marks', {}),                        // word starts per reference: {key: {signature: [frame, ...]}}
  baseMarks: {},                                   // word starts shipped with the app
  th: { ok: .18, rv: .30, w: .32, ...read('th', {}) }, // thresholds: ayah match / ayah review / word correct
};
export const save = name => localStorage.setItem('ms2_' + name, JSON.stringify(state[name]));

export async function loadBase() {
  try {
    const r = await fetch('data/references.json');
    if (r.ok) { const j = await r.json(); state.base = j.refs || {}; state.baseMarks = j.marks || {}; }
  } catch { /* no shipped references yet */ }
}

/** Cheap signature so the same reference is not counted twice (shipped file + this device). */
export const sig = s => s.length + ':' + s[s.length >> 1].slice(0, 8).join(',');

/** All references for an ayah: shipped first, then this device's, without duplicates. */
export function refsFor(key) {
  const seen = new Set();
  return [...(state.base[key] || []), ...(state.refs[key] || [])].filter(s => {
    const g = sig(s);
    if (seen.has(g)) return false;
    seen.add(g); return true;
  });
}

export function addRef(key, seq) { (state.refs[key] = state.refs[key] || []).push(seq); save('refs'); }

/** Removes the last reference recorded on this device for an ayah (shipped references are not touched). */
export function removeLastRef(key) {
  if (!state.refs[key] || !state.refs[key].length) return false;
  state.refs[key].pop(); save('refs'); return true;
}
/** Word starts marked for this reference, or null. */
export function marksFor(key, seq) {
  const g = sig(seq);
  return (state.marks[key] || {})[g] || (state.baseMarks[key] || {})[g] || null;
}
export function setMarks(key, seq, cuts) { (state.marks[key] = state.marks[key] || {})[sig(seq)] = cuts; save('marks'); }

export function addLog(entry) { state.log.push(entry); save('log'); }
export function addHist(entry) { state.hist.unshift(entry); state.hist = state.hist.slice(0, 50); save('hist'); }

/** Downloads references.json (shipped + local references and the test log). Place it in data/. */
export function exportData() {
  const all = {};
  for (const k of new Set([...Object.keys(state.base), ...Object.keys(state.refs)])) all[k] = refsFor(k);
  const marks = {};
  for (const k of new Set([...Object.keys(state.baseMarks), ...Object.keys(state.marks)]))
    marks[k] = { ...(state.baseMarks[k] || {}), ...(state.marks[k] || {}) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ refs: all, marks, log: state.log })], { type: 'application/json' }));
  a.download = 'references.json';
  a.click();
}
export async function importData(file) {
  const j = JSON.parse(await file.text());
  for (const k in j.refs || {}) state.refs[k] = (state.refs[k] || []).concat(j.refs[k]);
  for (const k in j.marks || {}) state.marks[k] = { ...(state.marks[k] || {}), ...j.marks[k] };
  state.log = state.log.concat(j.log || []);
  save('refs'); save('marks'); save('log');
}

const pct = (a, b) => b ? Math.round(a / b * 100) : 0;

/** Best accuracy any single threshold can reach for a distance field (used to compare methods fairly). */
function sweep(L, dist) {
  const cuts = [0, ...[...new Set(L.map(dist))].sort((a, b) => a - b).map(v => v + 1e-6)];
  let best = { hit: -1, t: 0 };
  for (const t of cuts) {
    const hit = L.filter(z => (dist(z) < t) === z.truth).length;
    if (hit > best.hit) best = { hit, t };
  }
  return { acc: pct(best.hit, L.length), t: +best.t.toFixed(3) };
}

/**
 * Test results from the labeled log:
 * - at the current "match" threshold: accuracy, false accept (wrong attempts accepted), false reject (correct attempts rejected)
 * - comparison with the baseline (no time warping): best reachable accuracy for each method on the same attempts.
 */
export function evaluate() {
  const L = state.log;
  if (!L.length) return null;
  const accepted = z => z.d < state.th.ok;
  const right = L.filter(z => z.truth), wrong = L.filter(z => !z.truth);
  const both = L.filter(z => z.d0 != null);
  return {
    n: L.length, right: right.length, wrong: wrong.length,
    acc: pct(L.filter(z => accepted(z) === z.truth).length, L.length),
    fa: pct(wrong.filter(accepted).length, wrong.length),
    fr: pct(right.filter(z => !accepted(z)).length, right.length),
    cmp: both.length ? { n: both.length, dtw: sweep(both, z => z.d), lin: sweep(both, z => z.d0) } : null,
  };
}
