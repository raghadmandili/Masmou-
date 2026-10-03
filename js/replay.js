// Plays a recorded reference back as an animated hand skeleton, so the user can SEE the correct signing.
// Frames use the same layout as tracker.js: [left hand 42 | right hand 42], relative to the shoulders.

const LINKS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
const SHOULDER = .25; // typical shoulder width as a fraction of the frame, used to scale back to pixels

let timer = null, frame = -1, canvasRef = null, done = null;

/** Index of the reference frame currently on screen (used to mark word starts). */
export const currentFrame = () => frame;

/** Stops playback, hides the replay canvas, and resolves the pending playSequence promise. */
export function stopPlayback() {
  if (timer) { clearInterval(timer); timer = null; }
  if (canvasRef) canvasRef.hidden = true;
  if (done) { const d = done; done = null; d(); }
}

/** Draws one feature frame: a simple head and shoulders, plus both hands if present. */
function drawFrame(ctx, f, W, H) {
  const cx = W / 2, cy = H * .58, sx = SHOULDER * W, sy = SHOULDER * H;
  ctx.fillStyle = 'rgba(10,31,30,.94)'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#5d8f89'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(cx - sx / 2, cy); ctx.lineTo(cx + sx / 2, cy); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy - sy * 1.1, sx * .3, 0, 7); ctx.stroke();
  for (const slot of [0, 1]) {
    const o = slot * 42, pts = [];
    let present = false;
    for (let j = 0; j < 21; j++) {
      const x = f[o + j * 2], y = f[o + j * 2 + 1];
      if (x || y) present = true;
      pts.push([cx + x * sx, cy + y * sy]);
    }
    if (!present) continue;
    ctx.strokeStyle = '#cfae70'; ctx.lineWidth = 2.5; ctx.beginPath();
    for (const [a, b] of LINKS) { ctx.moveTo(...pts[a]); ctx.lineTo(...pts[b]); }
    ctx.stroke();
    ctx.fillStyle = '#eef5f2';
    for (const p of pts) { ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, 7); ctx.fill(); }
  }
}

/** Shows the canvas and plays the sequence (one frame every stepMs). Resolves when it ends or is stopped. */
export function playSequence(canvas, seq, stepMs) {
  stopPlayback();
  canvasRef = canvas;
  const ctx = canvas.getContext('2d');
  canvas.hidden = false;
  return new Promise(resolve => {
    done = resolve;
    let i = 0;
    const tick = () => {
      if (i >= seq.length) {
        clearInterval(timer); timer = null;
        setTimeout(() => { if (!timer) stopPlayback(); }, 700);
        return;
      }
      frame = i;
      drawFrame(ctx, seq[i++], canvas.width, canvas.height);
    };
    tick();
    timer = setInterval(tick, stepMs);
  });
}
