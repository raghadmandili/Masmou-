// Camera + MediaPipe hand/pose landmarks -> normalized feature vectors. Video never leaves the browser.
import { FilesetResolver, HandLandmarker, PoseLandmarker }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODELS = 'https://storage.googleapis.com/mediapipe-models/';
const HAND_MODEL = MODELS + 'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const POSE_MODEL = MODELS + 'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const POINTS = 21, SLOT = POINTS * 2; // per hand: 21 points x (x, y)

/** Feature frame = [left hand 42 | right hand 42], centered on the shoulders and scaled by shoulder width. Missing hand = zeros. */
export function toFeatures(hands, pose) {
  let cx = .5, cy = .4, scale = .25;
  const body = pose.landmarks && pose.landmarks[0];
  if (body) {
    const l = body[11], r = body[12];
    cx = (l.x + r.x) / 2; cy = (l.y + r.y) / 2;
    scale = Math.hypot(l.x - r.x, l.y - r.y) || .25;
  }
  const f = new Array(SLOT * 2).fill(0);
  const sides = hands.handedness || hands.handednesses || [];
  hands.landmarks.forEach((pts, i) => {
    const slot = sides[i] && sides[i][0].categoryName === 'Left' ? 0 : 1;
    pts.forEach((p, j) => {
      f[slot * SLOT + j * 2] = Math.round((p.x - cx) / scale * 1e3) / 1e3;
      f[slot * SLOT + j * 2 + 1] = Math.round((p.y - cy) / scale * 1e3) / 1e3;
    });
  });
  return f;
}

async function createModels(fileset, delegate) {
  const make = (Cls, path, extra) => Cls.createFromOptions(fileset,
    { baseOptions: { modelAssetPath: path, delegate }, runningMode: 'VIDEO', ...extra });
  return [await make(HandLandmarker, HAND_MODEL, { numHands: 2 }), await make(PoseLandmarker, POSE_MODEL)];
}

/** Opens the camera, loads the models, and calls onFrame(featureFrame, timestampMs) for every new video frame. */
export async function startTracker(video, canvas, onFrame) {
  video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
  await video.play();
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  let hand, pose;
  try { [hand, pose] = await createModels(fileset, 'GPU'); }
  catch { [hand, pose] = await createModels(fileset, 'CPU'); }

  let lastTime = -1;
  (function loop() {
    if (video.readyState >= 2 && video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      // keep the dot layer the same size as the camera frame (phones can report a new size or rotate)
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      }
      const ts = performance.now();
      const h = hand.detectForVideo(video, ts), p = pose.detectForVideo(video, ts);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#cfae70';
      h.landmarks.forEach(pts => pts.forEach(q => { ctx.beginPath(); ctx.arc(q.x * canvas.width, q.y * canvas.height, 3, 0, 7); ctx.fill(); }));
      onFrame(toFeatures(h, p), ts);
    }
    requestAnimationFrame(loop);
  })();
}
