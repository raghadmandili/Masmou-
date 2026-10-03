// Sequence matching: Dynamic Time Warping over landmark feature frames.

/** True if the frame contains at least one detected hand. */
export const hasHands = f => f.some(z => z !== 0);

/** Drop leading/trailing frames where no hand is visible. */
export function trim(seq) {
  let s = 0, e = seq.length - 1;
  while (s <= e && !hasHands(seq[s])) s++;
  while (e >= s && !hasHands(seq[e])) e--;
  return seq.slice(s, e + 1);
}

/** Root-mean-square distance between two feature frames. */
function frameDist(a, b) {
  let sum = 0;
  for (let k = 0; k < a.length; k++) { const d = a[k] - b[k]; sum += d * d; }
  return Math.sqrt(sum / a.length);
}

/** DTW cost between two sequences, normalized by (n + m). Lower = more similar. */
export function dtw(a, b) {
  const n = a.length, m = b.length;
  const D = Array.from({ length: n + 1 }, () => new Float32Array(m + 1).fill(Infinity));
  D[0][0] = 0;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      D[i][j] = frameDist(a[i - 1], b[j - 1]) + Math.min(D[i - 1][j], D[i][j - 1], D[i - 1][j - 1]);
  return D[n][m] / (n + m);
}

/** Smallest DTW distance between an attempt and a set of reference sequences. */
export const bestDistance = (seq, refs) => Math.min(...refs.map(r => dtw(seq, r)));

// ---- Baseline for comparison (simpler alternative, no time warping) ----

/** Resample a sequence to exactly n frames by picking the nearest frame in time. */
function resample(seq, n) {
  return Array.from({ length: n }, (_, i) => seq[Math.round(i * (seq.length - 1) / (n - 1))]);
}

/** Baseline distance: stretch both sequences to the same length, then compare frame i with frame i. */
export function linearDistance(a, b, n = 32) {
  const A = resample(a, n), B = resample(b, n);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += frameDist(A[i], B[i]);
  return sum / n;
}

/** Smallest baseline distance between an attempt and a set of references. */
export const bestLinear = (seq, refs) => Math.min(...refs.map(r => linearDistance(seq, r)));

// ---- Word-level checking ----

/** DTW with the alignment path: which attempt frame was matched to which reference frame. */
export function align(a, b) {
  const n = a.length, m = b.length;
  const D = Array.from({ length: n + 1 }, () => new Float32Array(m + 1).fill(Infinity));
  D[0][0] = 0;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      D[i][j] = frameDist(a[i - 1], b[j - 1]) + Math.min(D[i - 1][j], D[i][j - 1], D[i - 1][j - 1]);
  const path = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    const diag = D[i - 1][j - 1], up = D[i - 1][j], left = D[i][j - 1];
    if (diag <= up && diag <= left) { i--; j--; } else if (up < left) i--; else j--;
  }
  return { d: D[n][m] / (n + m), path: path.reverse() };
}

/**
 * Per-word cost of an attempt against one reference whose word starts are marked.
 * cuts[w] = first reference frame of word w (cuts[0] = 0). Each aligned pair is charged to the
 * reference word it falls in; a word's score is its average frame distance (lower = closer).
 * Frames right at a word boundary are skipped: between two signs the hands are moving from one
 * to the next, and that transition belongs to neither word (kept only if a word would be left empty).
 * Two words marked at the same frame (one sign covering both) share the next word's score.
 */
export function wordScores(attempt, ref, cuts, edge = 1) {
  const { d, path } = align(attempt, ref);
  const W = cuts.length, end = w => (w + 1 < W ? cuts[w + 1] : ref.length);
  const all = Array.from({ length: W }, () => []), core = Array.from({ length: W }, () => []);
  for (const [i, j] of path) {
    let w = W - 1;
    while (w > 0 && j < cuts[w]) w--;
    const c = frameDist(attempt[i], ref[j]);
    all[w].push(c);
    const nearStart = w > 0 && j < cuts[w] + edge, nearEnd = w + 1 < W && j >= end(w) - edge;
    if (!nearStart && !nearEnd) core[w].push(c);
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const score = all.map((a, w) => core[w].length ? mean(core[w]) : a.length ? mean(a) : null);
  for (let w = W - 1; w >= 0; w--) if (score[w] == null) score[w] = w + 1 < W ? score[w + 1] : Infinity;
  return { d, score };
}
