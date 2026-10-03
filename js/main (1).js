// UI wiring for the learner (choose surah -> ayah or whole surah -> recite with hidden text -> word-by-word result)
// and for the team (record references, mark word starts, label tests, thresholds, export).
import { startTracker } from './tracker.js';
import { trim, hasHands, bestDistance, bestLinear, wordScores } from './dtw.js';
import { playSequence, stopPlayback, currentFrame } from './replay.js';
import { ICON, paintIcons } from './icons.js';
import { state, save, loadBase, refsFor, addRef, removeLastRef, marksFor, setMarks,
  addLog, addHist, exportData, importData, evaluate } from './store.js';

const MIN_FRAMES = 8;        // shortest usable take (sampled frames)
const MIN_COVERAGE = .7;     // share of frames with visible hands needed before judging
const SAMPLE_MS = 66;        // ~15 frames per second
const HANDS_DOWN_MS = 1200;  // hands out of view this long = end of the ayah
const REVEAL_MS = 350;       // delay between revealed words
const CHIP_LIMIT = 12;       // surahs up to this many ayat get number buttons; longer ones get a compact picker

// Learner-facing wording: short, plain, no technical terms.
const VERDICT = {
  ok: { cls: 'ok', icon: 'check', title: 'أحسنت! الإشارة صحيحة', sub: '' },
  rv: { cls: 'wn', icon: 'alert', title: 'قريب! راجِع الكلمات الحمراء', sub: '' },
  rt: { cls: 'er', icon: 'retry', title: 'لنحاول مرة أخرى', sub: '' },
};
const SHORT = { ok: 'صحيحة', rv: 'تحتاج مراجعة', rt: 'أعد المحاولة' };

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const au = $('#au');

let SURAHS = [], AUDIO = '', VIDEO_SOURCE = '';
let surahId = null, ayahKey = null, mode = 'ayah';         // mode: 'ayah' | 'surah' | 'ref'
let tracking = false, recording = false, counting = false;
let buf = [], lastSample = 0, seen = 0, lastHand = 0;
let takeMode = 'ayah', session = null, last = null, marking = null;
let team = false;
let goNextOnClick = false;   // after a correct ayah, the main button moves on to the next ayah

const surah = () => SURAHS.find(s => s.id === surahId);
const ayah = () => surah().ayat.find(a => a.key === ayahKey);
const available = a => refsFor(a.key).length > 0;
const isPhone = () => matchMedia('(max-width: 820px)').matches;
/** Arabic counted noun: 3–10 take the plural. */
const refCount = n => n === 0 ? 'لا مراجع' : n === 1 ? 'مرجع واحد' : n === 2 ? 'مرجعان' : n <= 10 ? `${n} مراجع` : `${n} مرجعاً`;
const ayatCount = n => n === 1 ? 'آية واحدة' : n === 2 ? 'آيتان' : n <= 10 ? `${n} آيات` : `${n} آية`;

/** Words of an ayah as shown on screen. A token that is only a Quranic mark (e.g. a pause sign)
 *  stays attached to the word before it, so the displayed text is never altered. */
function wordsOf(a) {
  const out = [];
  for (const t of a.text.split(/\s+/)) {
    if (/[\u0621-\u064A\u0671]/.test(t) || !out.length) out.push(t);
    else out[out.length - 1] += ' ' + t;
  }
  return out;
}

// ---------- messages ----------
function result(cls, icon, title, sub = '') {
  const r = $('#res');
  r.className = 'res ' + cls; r.hidden = false;
  r.innerHTML = `${ICON[icon]}<div><strong>${title}</strong>${sub ? `<span>${sub}</span>` : ''}</div>`;
}
const info = (title, sub) => result('info', 'info', title, sub);
const clearResult = () => { $('#res').hidden = true; $('#actions').hidden = true; $('#lab').hidden = true; };
function setGo(icon, text, disabled = false) {
  $('#go').innerHTML = `${ICON[icon]}<span>${text}</span>`;
  $('#go').disabled = disabled;
}
const idleGo = () => { goNextOnClick = false; setGo('play', mode === 'ref' ? 'سجّل مرجعاً' : 'ابدأ التسميع'); };

// ---------- setup ----------
async function boot() {
  paintIcons();
  // Team tools are opened only from a private link: add ?team to the address (?team=0 or «خروج» closes them).
  const q = new URLSearchParams(location.search);
  if (q.has('team')) localStorage.setItem('ms2_team', q.get('team') === '0' ? '0' : '1');
  team = localStorage.getItem('ms2_team') === '1';
  document.body.classList.toggle('team', team);
  const data = await (await fetch('data/ayat.json')).json();
  AUDIO = data.audioBase; VIDEO_SOURCE = data.videoSource || '';
  for (const a of data.ayat) {
    const id = a.key.split(':')[0];
    let s = SURAHS.find(x => x.id === id);
    if (!s) SURAHS.push(s = { id, name: a.surah, ayat: [] });
    s.ayat.push(a);
  }
  await loadBase();
  buildSurahs();
  selectSurah((SURAHS.find(s => s.ayat.some(available)) || SURAHS[0]).id);
  $('#help').open = !state.hist.length;
  if (localStorage.getItem('ms2_welcomed') !== '1') showWelcome();
  if (location.hash === '#progress') showView('progress');
  showStats(); showHist();
}

function buildSurahs() {
  $('#surah').innerHTML = SURAHS.map(s => {
    const ready = team || s.ayat.some(available);
    return `<option value="${s.id}" ${ready ? '' : 'disabled'}>سورة ${s.name} (${ayatCount(s.ayat.length)})${ready ? '' : '، غير متاحة بعد'}</option>`;
  }).join('');
}

function selectSurah(id) {
  surahId = id; $('#surah').value = id;
  const s = surah();
  ayahKey = (s.ayat.find(a => team || available(a)) || s.ayat[0]).key;
  buildChips(); render();
}

function buildChips() {
  const list = surah().ayat, ok = a => team || available(a);
  const long = list.length > CHIP_LIMIT;
  $('#chips').hidden = long; $('#pick').hidden = !long;
  if (long) {
    $('#ayahSel').innerHTML = list.map(a =>
      `<option value="${a.key}" ${ok(a) ? '' : 'disabled'}>الآية ${a.n}${ok(a) ? '' : '، غير متاحة بعد'}</option>`).join('');
  } else {
    $('#chips').innerHTML = list.map(a =>
      `<button data-key="${a.key}" aria-pressed="${a.key === ayahKey}" ${ok(a) ? '' : 'disabled title="غير متاحة بعد"'}
        aria-label="الآية ${a.n}">${a.n}</button>`).join('');
  }
  syncPicker();
}

/** Keeps the number buttons / compact picker in step with the selected ayah. */
function syncPicker() {
  $('#chips').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.key === ayahKey));
  const list = surah().ayat, i = list.findIndex(a => a.key === ayahKey);
  $('#ayahSel').value = ayahKey;
  const step = d => { for (let j = i + d; j >= 0 && j < list.length; j += d) if (team || available(list[j])) return list[j]; return null; };
  $('#prevA').disabled = !step(-1); $('#nextA').disabled = !step(1);
  $('#prevA').onclick = () => { const a = step(-1); if (a) selectAyah(a.key); };
  $('#nextA').onclick = () => { const a = step(1); if (a) selectAyah(a.key); };
}

function selectAyah(key) {
  ayahKey = key;
  syncPicker();
  render();
}

function setMode(m) {
  mode = m;
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-checked', b.dataset.mode === m));
  $('#ayahField').hidden = m === 'surah';
  render();
}

/** Redraws the title, the ayah area and the team counters for the current selection. */
function render() {
  stopPlayback(); closeSource(); clearResult(); $('#report').hidden = true; au.hidden = true; au.pause();
  const s = surah(), a = ayah();
  $('#title').textContent = mode === 'surah'
    ? `سورة ${s.name} كاملة، ${ayatCount(s.ayat.length)}`
    : `سورة ${s.name}، الآية ${a.n}`;
  if (mode === 'surah') $('#ayah').innerHTML = '';
  else renderAyah(a);
  idleGo();
  $('#hint').hidden = mode === 'ref' || state.hist.length > 0;
  updateTeam();
}

function updateTeam() {
  if (!team) return;
  const a = ayah(), refs = refsFor(a.key), n = wordsOf(a).length;
  const marked = refs.filter(r => (marksFor(a.key, r) || []).length === n).length;
  $('#cnt').textContent = `الآية ${a.n}: ${refCount(refs.length)}، منها ${marked} محدّدة الكلمات.`;
  $('#mark').disabled = !refs.length;
}

// ---------- ayah text: visible when recording a reference, hidden while reciting ----------
/** res: null = all hidden, or one boolean per word (true = shown in green, false = shown in red). */
function wordsHtml(a, res) {
  return wordsOf(a).map((w, i) =>
    `<span class="w ${res ? (res[i] ? 'good' : 'miss') : 'hid'}">${w}</span>`).join(' ');
}
function renderAyah(a, res = null, animate = false) {
  const el = $('#ayah');
  if (mode === 'ref') { el.textContent = a.text; return; }
  if (!animate) { el.innerHTML = wordsHtml(a, res); return; }
  el.innerHTML = wordsHtml(a, null);
  el.querySelectorAll('.w').forEach((s, i) =>
    setTimeout(() => { s.className = 'w ' + (res[i] ? 'good' : 'miss'); }, (i + 1) * REVEAL_MS));
}
/** Word results for display: per-word when word starts are marked, otherwise the ayah verdict for every word. */
function resultWords(a, r) {
  if (r.unclear || r.k === 'none') return null;
  return r.words || wordsOf(a).map(() => r.k === 'ok');
}

// ---------- camera ----------
function cameraError(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError') return 'اسمح للموقع باستخدام الكاميرا من أيقونة القفل بجانب الرابط، ثم اضغط «ابدأ التسميع» مرة أخرى.';
  if (n === 'NotFoundError') return 'لم نجد كاميرا متصلة بهذا الجهاز.';
  if (n === 'NotReadableError') return 'الكاميرا مستخدمة في برنامج آخر. أغلقه ثم حاول مرة أخرى.';
  return 'تأكد من اتصال الإنترنت، ثم حدّث الصفحة وحاول مرة أخرى.';
}
async function ensureCamera() {
  if (tracking) return true;
  setGo('camera', 'جارٍ تجهيز الكاميرا…', true);
  $('#camMsg').textContent = 'جارٍ تجهيز الكاميرا. قد يستغرق ذلك نصف دقيقة في المرة الأولى.';
  try {
    await startTracker($('#v'), $('#c'), onFrame);
    tracking = true; $('#camOff').hidden = true;
    fitFrame();
    return true;
  } catch (e) {
    console.error(e);
    $('#camMsg').textContent = 'الكاميرا لا تعمل.';
    result('er', 'alert', 'تعذّر تشغيل الكاميرا', cameraError(e));
    idleGo();
    return false;
  }
}

/** Shape the camera box like the camera itself (portrait on most phones), so the picture fills it. */
function fitFrame() {
  const v = $('#v'), r = v.videoWidth / v.videoHeight;
  if (!r) return;
  const box = $('.vw');
  box.style.aspectRatio = r;
  box.style.width = `min(100%, calc(52vh * ${r.toFixed(4)}))`;
}
$('#v').addEventListener('resize', fitFrame);   // fires when the camera size changes (e.g. phone rotated)

// ---------- recording (hands-free: lowering the hands ends the take) ----------
function onFrame(frame, ts) {
  if (!recording) return;
  if (ts - lastSample > SAMPLE_MS) { lastSample = ts; buf.push(frame); }
  if (hasHands(frame)) { seen++; lastHand = ts; }
  else if (seen >= MIN_FRAMES && ts - lastHand > HANDS_DOWN_MS) endTake();
}

const lock = v => document.querySelectorAll('#surah, .seg button, #chips button, #ayahSel, #prevA, #nextA, .tabs button').forEach(x => {
  if (v) { x.dataset.was = x.disabled ? '1' : ''; x.disabled = true; } else x.disabled = x.dataset.was === '1';
});

async function begin() {
  if (marking || counting) return;
  goNextOnClick = false;
  takeMode = mode; session = null;
  if (takeMode === 'surah') {
    const missing = surah().ayat.filter(a => !available(a));
    if (missing.length)
      return result('wn', 'alert', 'السورة غير مكتملة بعد', `الآية ${missing.map(a => a.n).join('، ')} غير متاحة للتسميع حتى الآن.`);
    session = { list: surah().ayat, i: 0, results: [] };
    ayahKey = session.list[0].key;
  } else if (takeMode === 'ayah' && !available(ayah())) {
    return result('wn', 'alert', 'هذه الآية غير متاحة للتسميع بعد');
  }
  stopPlayback(); closeSource(); clearResult(); $('#report').hidden = true; au.hidden = true; au.pause();
  if (!(await ensureCamera())) return;
  lock(true); $('#hint').hidden = true;
  if (isPhone()) $('.stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (session) showSessionAyah();
  else renderAyah(ayah());
  await take(isPhone() ? 5 : 3, null, 'ابتعد قليلاً حتى يظهر كتفاك ويداك');
}

function showSessionAyah() {
  const a = ayah();
  $('#title').textContent = `سورة ${surah().name}، الآية ${a.n} من ${session.list.length}`;
  renderAyah(a);
}

/** Countdown, then record. `before` runs right before recording starts (used to move to the next ayah). */
async function take(seconds, before, tip = '') {
  counting = true; setGo('play', 'استعد…', true);
  for (let i = seconds; i > 0; i--) {
    $('#big').innerHTML = `<span>${i}</span>${tip ? `<small>${tip}</small>` : ''}`;
    await sleep(1000);
  }
  $('#big').innerHTML = '';
  if (before) before();
  counting = false;
  buf = []; seen = 0; lastHand = 0; recording = true;
  $('#rec').hidden = false;
  setGo('stop', 'أنهيت');
}

function endTake() {
  if (!recording) return;
  recording = false; $('#rec').hidden = true;
  const seq = trim(buf), a = ayah();
  if (takeMode === 'ref') {
    lock(false); idleGo();
    if (seq.length < MIN_FRAMES) return result('wn', 'alert', 'لم يُحفظ المرجع', 'التسجيل قصير أو اليدان لم تظهرا. أعد التسجيل.');
    addRef(a.key, seq); buildSurahs(); buildChips(); updateTeam();
    return result('ok', 'check', `حُفظ مرجع للآية ${a.n}`, 'حدّد بدايات كلماته من «أدوات الفريق».');
  }
  const r = assess(seq, a);
  if (r.d != null) { addHist({ key: a.key, d: +r.d.toFixed(3), k: r.k, ts: Date.now() }); showHist(); }
  if (session) return nextInSurah(a, r);
  lock(false);
  showSingle(a, r);
}

// ---------- judging ----------
/**
 * Returns {k: 'ok'|'rv'|'rt'|'none', d, d0, words, unclear}. Never judges when the hands were not clearly visible.
 * Ayah verdict: best DTW distance over all references. Word verdicts: from the closest reference
 * whose word starts are marked; any failed word turns a "match" into "review".
 */
function assess(seq, a) {
  const refs = refsFor(a.key);
  if (!refs.length) return { k: 'none' };
  if (seq.length < MIN_FRAMES || seq.filter(hasHands).length / seq.length < MIN_COVERAGE)
    return { k: 'rt', unclear: true };
  const d = bestDistance(seq, refs), d0 = bestLinear(seq, refs);
  let k = d < state.th.ok ? 'ok' : d < state.th.rv ? 'rv' : 'rt';
  let words = null;
  const n = wordsOf(a).length;
  const marked = refs.map(r => ({ r, cuts: marksFor(a.key, r) })).filter(x => x.cuts && x.cuts.length === n);
  if (marked.length) {
    const best = marked.map(x => wordScores(seq, x.r, x.cuts)).reduce((p, q) => q.d < p.d ? q : p);
    words = best.score.map(c => c < state.th.w);
    if (k === 'ok' && words.includes(false)) k = 'rv';
  }
  return { k, d, d0, words };
}

const unclearMsg = () => result('wn', 'alert', 'لم تظهر يداك بوضوح',
  'قف في مكان مضيء، وابتعد قليلاً حتى يظهر كتفاك ويداك، ثم حاول مرة أخرى.');

function showSingle(a, r) {
  last = null;
  setGo('retry', 'حاول مرة أخرى');
  if (r.unclear) { renderAyah(a); return unclearMsg(); }
  const v = VERDICT[r.k], vid = hasVideo(a);
  const sub = r.k === 'ok' ? '' : vid ? 'شاهد فيديو المترجم، ثم حاول مرة أخرى.' : 'شاهد حركة اليدين الصحيحة، ثم حاول مرة أخرى.';
  const tech = team ? ` [المسافة ${r.d.toFixed(3)}${r.words ? '' : '، بلا تحديد كلمات'}]` : '';
  result(v.cls, v.icon, v.title, sub + tech);
  $('#source').classList.toggle('accent', r.k !== 'ok' && vid);
  $('#show').classList.toggle('accent', r.k !== 'ok' && !vid);
  $('#show').hidden = r.k === 'ok';   // no need to review the movement after a correct ayah
  renderAyah(a, resultWords(a, r), true);
  const idx = surah().ayat.indexOf(a), nextA = surah().ayat[idx + 1];
  goNextOnClick = r.k === 'ok' && !!nextA && available(nextA);
  if (goNextOnClick) setGo('next', `الآية التالية (${nextA.n})`);
  $('#again').hidden = !goNextOnClick;
  $('#source').hidden = !hasVideo(a);
  $('#actions').hidden = false;
  if (team) { last = { key: a.key, d: r.d, d0: r.d0 }; $('#lab').hidden = false; }
}

function nextInSurah(a, r) {
  session.results.push({ a, r });
  session.i++;
  const res = resultWords(a, r);
  if (res) renderAyah(a, res, true);
  const said = r.unclear ? 'لم تظهر اليدان بوضوح' : SHORT[r.k];
  if (session.i < session.list.length) {
    const nextA = session.list[session.i];
    result(r.k === 'ok' ? 'ok' : 'wn', r.k === 'ok' ? 'check' : 'alert', `الآية ${a.n}: ${said}`, `استعد للآية ${nextA.n}…`);
    return take(3, () => { ayahKey = nextA.key; clearResult(); showSessionAyah(); });
  }
  showReport();
}

function showReport() {
  const s = session; session = null;
  lock(false); setGo('retry', 'سمّع السورة مرة أخرى');
  $('#title').textContent = `سورة ${surah().name} كاملة، ${ayatCount(s.list.length)}`;
  $('#ayah').innerHTML = '';
  const need = s.results.filter(x => x.r.k !== 'ok' || x.r.unclear);
  if (need.length) result('wn', 'alert', 'انتهت السورة', `تحتاج مراجعة: ${need.map(x => 'الآية ' + x.a.n).join('، ')}.`);
  else result('ok', 'check', 'ما شاء الله! السورة كلها صحيحة');
  const box = $('#report');
  box.innerHTML = '<h2>نتيجة كل آية</h2><ol>' + s.results.map((x, i) => {
    const k = x.r.unclear ? 'rv' : x.r.k, v = VERDICT[k];
    return `<li><div class="head ${v.cls}">${ICON[v.icon]}الآية ${x.a.n}: ${x.r.unclear ? 'لم تظهر اليدان بوضوح' : SHORT[k]}</div>
      <div class="mini">${wordsHtml(x.a, resultWords(x.a, x.r))}</div>
      <div class="actions">
        ${hasVideo(x.a) ? `<button data-i="${i}" data-act="src">${ICON.video}فيديو المترجم</button>` : ''}
        <button data-i="${i}" data-act="show">${ICON.watch}حركة اليدين</button>
        ${k !== 'ok' ? `<button data-i="${i}" data-act="redo">${ICON.retry}سمّع هذه الآية</button>` : ''}
      </div></li>`;
  }).join('') + '</ol>';
  box.hidden = false;
  box.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const a = s.results[+b.dataset.i].a;
    if (b.dataset.act === 'show') return replay(a);
    if (b.dataset.act === 'src') return openSource(a);
    setMode('ayah'); selectAyah(a.key); buildChips();
  };
}

// ---------- review: see the correct signing, reveal the text, hear the recitation ----------
function replay(a) {
  const ref = refsFor(a.key)[0];
  closeSource();
  if (ref) playSequence($('#rp'), ref, SAMPLE_MS);
}

// ---------- source video: the human interpreter's signing of this ayah (YouTube embed, start..end only) ----------
const hasVideo = a => !!(a.video && /^[\w-]{11}$/.test(a.video.id));
function openSource(a) {
  if (!hasVideo(a)) return;
  stopPlayback();
  const v = a.video;
  $('#srcFrame').src = `https://www.youtube-nocookie.com/embed/${v.id}?start=${v.start}&end=${v.end}&autoplay=1&rel=0&playsinline=1`;
  $('#srcCap').textContent = `الآية ${a.n}، من ${VIDEO_SOURCE}`;
  $('#srcBox').hidden = false;
}
function closeSource() {
  if ($('#srcBox').hidden) return;
  $('#srcFrame').src = 'about:blank';
  $('#srcBox').hidden = true;
}
$('#source').onclick = () => openSource(ayah());
$('#srcClose').onclick = closeSource;
$('#show').onclick = () => replay(ayah());
$('#listen').onclick = () => { au.src = AUDIO + ayah().audio; au.hidden = false; au.play().catch(() => {}); };
function goNext() {
  const list = surah().ayat, nextA = list[list.indexOf(ayah()) + 1];
  if (nextA) { selectAyah(nextA.key); begin(); }
}
$('#again').onclick = () => begin();

// ---------- team: marking word starts on a reference ----------
async function markWords() {
  if (recording || counting || marking) return;
  if (mode !== 'ref') setMode('ref');
  const a = ayah(), refs = refsFor(a.key), words = wordsOf(a);
  const target = refs.find(r => (marksFor(a.key, r) || []).length !== words.length) || refs[refs.length - 1];
  if (!target) return result('wn', 'alert', 'سجّل مرجعاً أولاً');
  if (words.length < 2) { setMarks(a.key, target, [0]); updateTeam(); return result('ok', 'check', 'الآية كلمة واحدة، حُفظت'); }
  document.activeElement.blur();
  marking = { a, target, words, cuts: [0] };
  lock(true); $('#markNext').hidden = false; $('#go').disabled = true; renderMarking();
  await playSequence($('#rp'), target, SAMPLE_MS * 2);   // half speed makes the starts easier to catch
  finishMarking();
}
function renderMarking() {
  const m = marking;
  $('#ayah').innerHTML = m.words.map((w, i) =>
    `<span class="w ${i < m.cuts.length ? 'good' : i === m.cuts.length ? 'next' : 'shown'}">${w}</span>`).join(' ');
  if (m.cuts.length < m.words.length)
    info(`اضغط المسافة عند بداية: «${m.words[m.cuts.length]}»`, 'أو اضغط «بدأت الكلمة». العرض بنصف السرعة.');
}
function markNext() {
  if (!marking) return;
  const f = currentFrame();
  if (f < marking.cuts[marking.cuts.length - 1]) return;
  marking.cuts.push(f); renderMarking();
  if (marking.cuts.length === marking.words.length) stopPlayback(); // ends playback -> finishMarking
}
function finishMarking() {
  if (!marking) return;
  const m = marking; marking = null;
  $('#markNext').hidden = true; lock(false); idleGo(); renderAyah(m.a);
  if (m.cuts.length < m.words.length)
    return result('wn', 'alert', `حُدّدت ${m.cuts.length} من ${m.words.length} كلمات فقط`, 'اضغط «حدّد بدايات الكلمات» وأعد المحاولة.');
  setMarks(m.a.key, m.target, m.cuts); updateTeam();
  result('ok', 'check', 'حُفظت بدايات الكلمات لهذا المرجع');
}
$('#mark').onclick = markWords;
$('#markNext').onclick = markNext;
$('#del').onclick = () => {
  const a = ayah(), done = removeLastRef(a.key);
  buildSurahs(); buildChips(); updateTeam();
  done ? result('ok', 'check', `حُذف آخر مرجع للآية ${a.n}`) : result('wn', 'alert', 'لا توجد مراجع محلية لهذه الآية');
};

// ---------- controls ----------
$('#surah').onchange = e => selectSurah(e.target.value);
$('#ayahSel').onchange = e => selectAyah(e.target.value);
$('#chips').onclick = e => { const b = e.target.closest('button'); if (b && !b.disabled) selectAyah(b.dataset.key); };
document.querySelectorAll('.seg button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
function go() {
  if (counting || marking) return;
  if (recording) return endTake();
  if (goNextOnClick) return goNext();
  begin();
}
$('#go').onclick = go;
// Space bar: starts/ends a take, or marks the next word start. Ignored while typing or on a focused button.
document.addEventListener('keydown', e => {
  if (e.code !== 'Space' || !$('#welcome').hidden) return;
  if (['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  e.preventDefault();
  marking ? markNext() : go();
});
$('#teamExit').onclick = () => {
  team = false;
  localStorage.setItem('ms2_team', '0');
  history.replaceState(null, '', location.pathname);   // drop ?team from the address
  document.body.classList.remove('team');
  if (mode === 'ref') setMode('ayah');
  buildSurahs(); buildChips(); render();
};

// ---------- progress ----------
const DOT_LABEL = { ok: 'صحيحة', rv: 'تحتاج مراجعة', rt: 'أعد المحاولة' };
/** Per surah: the latest result of each ayah (from history), shown as a row of coloured dots. */
/** [1,2,3,5,7,8] -> "1 إلى 3، 5، 7 إلى 8" so long surahs stay short (words, not "-", read correctly in Arabic). */
function ranges(nums) {
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]} إلى ${nums[j]}` : `${nums[i]}`);
    i = j;
  }
  return out.join('، ');
}

/** Progress page: one row per surah the learner has recited (most recent first): a bar split by status,
 *  tap/click for the ayah list, and a button that jumps straight to what needs work. */
function showHist() {
  const latest = {}, order = [];
  for (const h of state.hist) {                 // hist is newest first
    if (!(h.key in latest)) latest[h.key] = h.k;
    const sid = h.key.split(':')[0];
    if (!order.includes(sid)) order.push(sid);
  }
  const open = new Set([...document.querySelectorAll('#progress details[open]')].map(d => d.dataset.id));
  const rows = order.map(id => SURAHS.find(s => s.id === id)).filter(Boolean).map(s => {
    const n = s.ayat.length, of = k => s.ayat.filter(a => (latest[a.key] || '') === k).map(a => a.n);
    const groups = { ok: of('ok'), rv: of('rv'), rt: of('rt'), '': of('') };
    const seg = k => groups[k].length ? `<i class="${k}" style="width:${(groups[k].length / n * 100).toFixed(2)}%"></i>` : '';
    const summary = [`أتقنت ${groups.ok.length}`, groups.rv.length && `تحتاج مراجعة ${groups.rv.length}`,
      groups.rt.length && `أعد ${groups.rt.length}`, groups[''].length && `لم تُسمَّع ${groups[''].length}`].filter(Boolean).join('، ');
    const line = (k, label) => groups[k].length
      ? `<li class="${k || 'none'}"><b>${label}:</b> ${groups[k].length > 1 ? 'الآيات' : 'الآية'} ${ranges(groups[k])}</li>` : '';
    // next step: first ayah that needs review, else the first one not recited yet, else the whole surah
    const usable = a => team || available(a);
    const review = s.ayat.find(a => ['rv', 'rt'].includes(latest[a.key]) && usable(a));
    const fresh = s.ayat.find(a => !latest[a.key] && usable(a));
    const next = review ? `<button data-surah="${s.id}" data-key="${review.key}" class="accent">${ICON.retry}راجِع الآية ${review.n}</button>`
      : fresh ? `<button data-surah="${s.id}" data-key="${fresh.key}">${ICON.play}سمّع الآية ${fresh.n}</button>`
      : `<button data-surah="${s.id}">${ICON.play}سمّع السورة كاملة</button>`;
    return `<div class="prow">
      <details data-id="${s.id}" ${open.has(s.id) ? 'open' : ''}>
        <summary title="${summary}">
          <span class="top"><span>سورة ${s.name}</span><small>أتقنت ${groups.ok.length} من ${n}</small></span>
          <span class="bar" aria-label="${summary}">${seg('ok')}${seg('rv')}${seg('rt')}</span>
        </summary>
        <ul class="pdetail">${line('ok', 'متقنة')}${line('rv', 'تحتاج مراجعة')}${line('rt', 'أعد')}${line('', 'لم تُسمَّع')}</ul>
      </details>
      <div class="act actions">${next}</div>
    </div>`;
  });
  $('#progress').innerHTML = rows.length
    ? rows.join('') + '<div class="legend"><span class="ok">صحيحة</span><span class="rv">تحتاج مراجعة</span><span class="rt">أعد</span><span>لم تُسمَّع</span></div>'
    : `<p class="mu" style="margin:0">لم تسمّع بعد. هنا سيظهر ما أتقنته من كل سورة وما يحتاج مراجعة.</p><div class="actions"><button data-start>${ICON.play}ابدأ أول تسميع</button></div>`;
  $('#lead').hidden = !rows.length;
  $('#histCard').hidden = !state.hist.length;

  const name = key => (SURAHS.find(s => s.id === key.split(':')[0]) || {}).name || '';
  const when = ts => new Date(ts).toLocaleString('ar-SA-u-nu-latn-ca-gregory', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).replace(',', '،');
  $('#hist').innerHTML = state.hist.slice(0, 15).map(h => {
    const v = VERDICT[h.k] || VERDICT.rt;
    return `<li class="${v.cls}">${ICON[v.icon]}<span>${name(h.key)}، الآية ${h.key.split(':')[1]}: ${SHORT[h.k] || ''}</span><small>${when(h.ts)}</small></li>`;
  }).join('') || '<li class="mu">لا توجد محاولات بعد.</li>';
}

// ---------- welcome screen: first visit, or tap the name in the header ----------
function showWelcome() {
  $('#welcome').hidden = false; document.body.classList.add('welcoming');
}
function hideWelcome() {
  $('#welcome').hidden = true; document.body.classList.remove('welcoming');
  localStorage.setItem('ms2_welcomed', '1');
}
$('#wStart').onclick = hideWelcome;
$('#home').onclick = () => { if (!recording && !counting && !marking) showWelcome(); };

// ---------- pages: recite / progress ----------
function showView(v) {
  if (recording || counting || marking) return;
  if (v !== 'progress') v = 'recite';
  $('#viewRecite').hidden = v !== 'recite';
  $('#viewProgress').hidden = v !== 'progress';
  document.querySelectorAll('.tabs button').forEach(b => b.toggleAttribute('aria-current', b.dataset.view === v));
  document.querySelectorAll('.tabs button[aria-current]').forEach(b => b.setAttribute('aria-current', 'page'));
  if (v === 'progress') { stopPlayback(); closeSource(); showHist(); }
  const hash = v === 'progress' ? '#progress' : '';
  if (location.hash !== hash) history.pushState(null, '', hash || location.pathname + location.search);
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showView(b.dataset.view));
window.addEventListener('popstate', () => showView(location.hash === '#progress' ? 'progress' : 'recite'));
$('#progress').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.hasAttribute('data-start')) return showView('recite');
  if (!b.dataset.surah) return;
  selectSurah(b.dataset.surah);
  if (b.dataset.key) { setMode('ayah'); selectAyah(b.dataset.key); } else setMode('surah');
  showView('recite');
});

// ---------- team: test labels and stats ----------
function label(truth) {
  if (!last) return;
  addLog({ key: last.key, d: +last.d.toFixed(3), d0: +last.d0.toFixed(3), truth, ts: Date.now() });
  last = null; $('#lab').hidden = true; showStats();
}
$('#tY').onclick = () => label(true);
$('#tN').onclick = () => label(false);

function showStats() {
  $('#t1').value = state.th.ok; $('#t2').value = state.th.rv; $('#t3').value = state.th.w;
  const s = evaluate();
  if (!s) { $('#stats').textContent = 'لا توجد اختبارات بعد.'; $('#cmp').textContent = ''; return; }
  $('#stats').textContent =
    `الاختبارات: ${s.n} (${s.right} صحيحة، ${s.wrong} خاطئة). عند العتبة الحالية: الدقة ${s.acc}٪، ` +
    `قبول خاطئ ${s.fa}٪، رفض خاطئ ${s.fr}٪.`;
  $('#cmp').textContent = s.cmp
    ? `المقارنة بالبديل الأبسط على ${s.cmp.n} محاولة (أفضل دقة ممكنة لكل طريقة): ` +
      `DTW ${s.cmp.dtw.acc}٪ (العتبة ${s.cmp.dtw.t}) مقابل المطابقة بلا محاذاة زمنية ${s.cmp.lin.acc}٪.`
    : '';
}
[['#t1', 'ok'], ['#t2', 'rv'], ['#t3', 'w']].forEach(([id, field]) => $(id).onchange = e => {
  state.th[field] = +e.target.value; save('th'); showStats();
});
$('#ex').onclick = exportData;
$('#im').onchange = async e => {
  try { await importData(e.target.files[0]); buildSurahs(); buildChips(); render(); showStats(); result('ok', 'check', 'تم الاستيراد'); }
  catch { result('er', 'alert', 'ملف غير صالح'); }
};

boot();
