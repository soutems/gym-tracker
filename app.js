'use strict';

/* ============================================================
   Gym Tracker — workout logging app
   Data: localStorage (Google Drive sync comes next)
   ============================================================ */

const IMG_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
const STORAGE_KEY = 'muscu-tracker:v1';
const LIST_PAGE = 60;

const GROUPS = [
  ['chest', 'Chest'], ['back', 'Back'], ['shoulders', 'Shoulders'], ['biceps', 'Biceps'],
  ['triceps', 'Triceps'], ['forearms', 'Forearms'], ['abs', 'Abs'], ['quads', 'Quads'],
  ['hamstrings', 'Hamstrings'], ['glutes', 'Glutes'], ['calves', 'Calves'],
  ['cardio', 'Cardio'], ['stretch', 'Stretching'],
];
const GROUP_LABEL = Object.fromEntries(GROUPS);

const MUSCLE_GROUP = {
  chest: 'chest', lats: 'back', 'middle back': 'back', 'lower back': 'back', traps: 'back',
  shoulders: 'shoulders', neck: 'shoulders', biceps: 'biceps', triceps: 'triceps',
  forearms: 'forearms', abdominals: 'abs', quadriceps: 'quads', hamstrings: 'hamstrings',
  glutes: 'glutes', abductors: 'glutes', adductors: 'glutes', calves: 'calves',
};
const EQUIP_LABEL = {
  'body only': 'Bodyweight', machine: 'Machine', other: 'Other', 'foam roll': 'Foam roller',
  kettlebells: 'Kettlebell', dumbbell: 'Dumbbell', cable: 'Cable', barbell: 'Barbell',
  bands: 'Bands', 'medicine ball': 'Medicine ball', 'exercise ball': 'Exercise ball',
  'e-z curl bar': 'EZ bar',
};
const REST_CHOICES = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];

// Theme presets — colors live in styles.css under [data-theme="…"]
const THEMES = [
  { id: 'auto', name: 'Auto', note: 'Follows your phone', bg: '#0e1013', surface: '#f3f4f6', accent: '#4c8dff' },
  { id: 'midnight', name: 'Midnight', bg: '#0e1013', surface: '#171a1f', accent: '#4c8dff' },
  { id: 'daylight', name: 'Daylight', bg: '#f3f4f6', surface: '#ffffff', accent: '#2563eb' },
  { id: 'black', name: 'True black', bg: '#000000', surface: '#111111', accent: '#4c8dff' },
  { id: 'slate', name: 'Slate', bg: '#0f172a', surface: '#1e293b', accent: '#38bdf8' },
  { id: 'ember', name: 'Ember', bg: '#140f0c', surface: '#211913', accent: '#f97316' },
  { id: 'forest', name: 'Forest', bg: '#0b1310', surface: '#13201a', accent: '#34d399' },
  { id: 'sakura', name: 'Sakura', bg: '#fdf2f4', surface: '#ffffff', accent: '#e11d48' },
];
const ACCENTS = ['#4c8dff', '#38bdf8', '#14b8a6', '#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7'];

// [exercise id, sets, target reps, rest in seconds]
const SAMPLE_PPL = [
  { name: 'Push', items: [
    ['Barbell_Bench_Press_-_Medium_Grip', 4, '6-8', 150], ['Incline_Dumbbell_Press', 3, '8-10', 120],
    ['Standing_Military_Press', 3, '8-10', 120], ['Side_Lateral_Raise', 3, '12-15', 60],
    ['Triceps_Pushdown', 3, '10-12', 60],
  ] },
  { name: 'Pull', items: [
    ['Pullups', 4, '6-10', 150], ['Bent_Over_Barbell_Row', 3, '8-10', 120],
    ['Wide-Grip_Lat_Pulldown', 3, '10-12', 90], ['Face_Pull', 3, '12-15', 60],
    ['Barbell_Curl', 3, '8-12', 60], ['Hammer_Curls', 2, '10-12', 60],
  ] },
  { name: 'Legs', items: [
    ['Barbell_Squat', 4, '6-8', 180], ['Romanian_Deadlift', 3, '8-10', 120],
    ['Leg_Press', 3, '10-12', 120], ['Lying_Leg_Curls', 3, '10-12', 90],
    ['Standing_Calf_Raises', 4, '12-15', 60], ['Plank', 3, '', 60],
  ] },
];

/* ---------- State and persistence ---------- */

const defaultState = () => ({
  version: 1,
  settings: { defaultRest: 90, theme: 'auto', accent: null },
  customExercises: [],
  exerciseSettings: {},   // { [exId]: { mode, rest } }
  favorites: [],          // exercise ids
  templates: [],          // { id, name, items: [{ exId, sets, target, rest }] }
  sessions: [],           // finished workouts, oldest first
  active: null,           // workout in progress
});

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      const base = defaultState();
      return Object.assign(base, data, { settings: Object.assign(base.settings, data.settings) });
    }
  } catch (e) {
    console.warn('Could not read saved data', e);
  }
  return defaultState();
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}
function saveNow() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Could not save on this device');
  }
}
window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveNow();
});

const ui = {
  tab: 'workout',
  editTemplateId: null,
  draft: null,          // copy of a finished workout being edited (or a past workout being logged)
  libQuery: '',
  libGroup: null,       // a group key, 'fav', or null for all
  libLimit: LIST_PAGE,
  modals: [],
  restDoneUntil: 0,
};

/* ---------- Theme ---------- */

const lightQuery = window.matchMedia('(prefers-color-scheme: light)');

function hexAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function onColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#111418' : '#ffffff';
}

function applyTheme() {
  const root = document.documentElement;
  const t = state.settings.theme || 'auto';
  root.dataset.theme = t === 'auto' ? (lightQuery.matches ? 'daylight' : 'midnight') : t;
  const acc = state.settings.accent;
  if (acc) {
    root.style.setProperty('--accent', acc);
    root.style.setProperty('--accent-bg', hexAlpha(acc, 0.16));
    root.style.setProperty('--on-accent', onColor(acc));
  } else {
    ['--accent', '--accent-bg', '--on-accent'].forEach(p => root.style.removeProperty(p));
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim();
}
if (lightQuery.addEventListener) lightQuery.addEventListener('change', applyTheme);

/* ---------- Exercise library ---------- */

let LIB = new Map();

function guessMode(e) {
  if (e.category === 'cardio' || e.category === 'stretching') return 'time';
  if (/plank|hold|wall sit|isometric/i.test(e.name)) return 'time';
  return 'reps';
}

function rebuildLibrary() {
  LIB = new Map();
  for (const c of state.customExercises) {
    LIB.set(c.id, {
      id: c.id, name: c.name, group: c.group, primary: [], secondary: [], equipment: '',
      instructions: c.instructions ? [c.instructions] : [], images: [], defaultMode: c.mode, custom: true,
    });
  }
  for (const e of window.EXERCISES || []) {
    const group = e.category === 'stretching' ? 'stretch'
      : e.category === 'cardio' ? 'cardio'
      : MUSCLE_GROUP[e.primaryMuscles[0]] || 'other';
    LIB.set(e.id, {
      id: e.id, name: e.name, group,
      primary: e.primaryMuscles, secondary: e.secondaryMuscles, equipment: e.equipment || '',
      instructions: e.instructions, images: e.images.map(p => IMG_BASE + p),
      defaultMode: guessMode(e), custom: false,
    });
  }
}

function getEx(id, fallbackName) {
  return LIB.get(id) || {
    id, name: fallbackName || 'Deleted exercise', group: 'other', primary: [], secondary: [],
    equipment: '', instructions: [], images: [], defaultMode: 'reps', custom: true,
  };
}
const exMode = id => (state.exerciseSettings[id] && state.exerciseSettings[id].mode) || getEx(id).defaultMode;
const exSetting = id => (state.exerciseSettings[id] = state.exerciseSettings[id] || {});
const isFav = id => state.favorites.includes(id);

function filterExercises(query, group) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const ex of LIB.values()) {
    if (group === 'fav' ? !isFav(ex.id) : group && ex.group !== group) continue;
    const name = ex.name.toLowerCase();
    if (tokens.every(t => name.includes(t))) out.push(ex);
  }
  // Favorites first, then custom exercises, then alphabetical
  return out.sort((a, b) => (isFav(b.id) - isFav(a.id)) || (b.custom - a.custom) || a.name.localeCompare(b.name));
}

/* ---------- Helpers ---------- */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// "1:30" → 90 ; "130" → 90 (last two digits are seconds) ; "45" → 45
function parseTime(str) {
  const s = String(str).trim();
  if (!s) return null;
  if (s.includes(':')) {
    const [m, sec] = s.split(':');
    const v = (parseInt(m, 10) || 0) * 60 + (parseInt(sec, 10) || 0);
    return v || null;
  }
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  const v = digits.length <= 2 ? n : Math.floor(n / 100) * 60 + (n % 100);
  return v || null;
}

function parseNum(str) {
  const n = parseFloat(String(str).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function parseIntOrNull(str) {
  const n = parseInt(str, 10);
  return Number.isFinite(n) ? n : null;
}
const fmtW = n => String(Math.round(n * 100) / 100);
const fmtBig = n => Math.round(n).toLocaleString('en-GB');

const fmtDate = ts => new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDateShort = ts => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtDateLong = ts => new Date(ts).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const fmtClock = ts => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

// Values for <input type="date"> / <input type="time">, in local time
const pad2 = n => String(n).padStart(2, '0');
const toDateInput = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const toTimeInput = ts => { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
function fromInputs(date, time) {
  const [y, mo, d] = String(date).split('-').map(Number);
  const [h, mi] = String(time || '00:00').split(':').map(Number);
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d, h || 0, mi || 0).getTime();
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function setShort(s, mode) {
  if (mode === 'time') return fmtTime(s.t);
  return s.w ? `${fmtW(s.w)}kg×${s.r ?? 0}` : `${s.r ?? 0} reps`;
}
function setLong(s, mode) {
  if (mode === 'time') return fmtTime(s.t);
  return s.w ? `${fmtW(s.w)} kg × ${s.r ?? 0}` : `${s.r ?? 0} reps`;
}

function summarizeSets(sets, mode) {
  if (!sets.length) return '';
  if (mode === 'time') {
    const ts = sets.map(s => fmtTime(s.t));
    return ts.every(t => t === ts[0]) ? `${sets.length} × ${ts[0]}` : ts.join(' · ');
  }
  const first = sets[0];
  if (sets.every(s => s.w === first.w && s.r === first.r)) {
    return `${sets.length} × ${first.r ?? 0}` + (first.w ? ` @ ${fmtW(first.w)} kg` : '');
  }
  return sets.map(s => setShort(s, mode)).join(' · ');
}

// Most recent finished workout containing this exercise (optionally before a date)
function lastPerf(exId, before = Infinity) {
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const s = state.sessions[i];
    if (s.start >= before) continue;
    const e = s.exercises.find(x => x.exId === exId);
    if (e && e.sets.length) return { date: s.start, sets: e.sets };
  }
  return null;
}

// Suggested values for a set: same set last time, otherwise the previous set of this workout
function hintFor(e, j, last = lastPerf(e.exId)) {
  if (last) return last.sets[j] || last.sets[last.sets.length - 1];
  for (let k = j - 1; k >= 0; k--) {
    const s = e.sets[k];
    if (s.r != null || s.t != null) return s;
  }
  return null;
}

// Every finished workout containing this exercise, oldest first
function exHistory(exId) {
  const out = [];
  for (const s of state.sessions) {
    const e = s.exercises.find(x => x.exId === exId);
    if (e && e.sets.length) out.push({ date: s.start, sets: e.sets });
  }
  return out;
}

/* ---------- Personal records ---------- */

// Heavier weight wins; at equal weight, more reps wins. Duration: longer wins.
function setBeats(s, best, mode) {
  if (mode === 'time') return (s.t || 0) > (best.t || 0);
  const w = s.w || 0, bw = best.w || 0;
  if (w !== bw) return w > bw;
  return (s.r || 0) > (best.r || 0);
}
function bestOf(sets, mode, best = null) {
  for (const s of sets) if (!best || setBeats(s, best, mode)) best = s;
  return best;
}
function historyBest(exId, mode, before = Infinity) {
  let best = null;
  for (const s of state.sessions) {
    if (s.start >= before) continue;
    const e = s.exercises.find(x => x.exId === exId);
    if (e) best = bestOf(e.sets, mode, best);
  }
  return best;
}

// Keys "i:j" of the done sets in the live workout that beat the previous best.
// An exercise done for the first time sets a baseline, not a record.
function livePRs(a) {
  const flags = new Set();
  const best = {};
  a.exercises.forEach((e, i) => {
    const mode = exMode(e.exId);
    if (!(e.exId in best)) best[e.exId] = historyBest(e.exId, mode, a.start);
    e.sets.forEach((s, j) => {
      if (!s.done) return;
      const b = best[e.exId];
      if (b && setBeats(s, b, mode)) {
        flags.add(`${i}:${j}`);
        best[e.exId] = s;
      }
    });
  });
  return flags;
}

// Same rule as livePRs, replayed over the whole history. Needed whenever a workout
// is edited, deleted or inserted in the past, since later records may change.
function recomputePRs() {
  const best = {};
  for (const s of state.sessions) {
    const firstTime = new Set(s.exercises.map(e => e.exId).filter(id => !best[id]));
    for (const e of s.exercises) {
      const mode = exMode(e.exId);
      for (const x of e.sets) {
        delete x.pr;
        const b = best[e.exId];
        if (!firstTime.has(e.exId) && b && setBeats(x, b, mode)) {
          x.pr = true;
          best[e.exId] = x;
        }
      }
    }
    for (const e of s.exercises) {
      if (firstTime.has(e.exId)) best[e.exId] = bestOf(e.sets, exMode(e.exId), best[e.exId]);
    }
  }
}

// Keep history in date order (a past workout can be added after newer ones)
function sortSessions() {
  state.sessions.sort((a, b) => a.start - b.start);
  recomputePRs();
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ---------- End-of-rest sound and vibration ---------- */

let audioCtx = null;
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* no audio available */ }
}
function beep() {
  if (!audioCtx) return;
  [0, 0.25, 0.5].forEach(offset => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 880;
    o.connect(g);
    g.connect(audioCtx.destination);
    const t = audioCtx.currentTime + offset;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.start(t);
    o.stop(t + 0.2);
  });
}
function notifyRestDone() {
  beep();
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

/* ---------- Rendering ---------- */

const $view = document.getElementById('view');
const TITLES = { workout: 'Workout', programs: 'Programs', library: 'Exercises', history: 'History', settings: 'Settings' };

function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === ui.tab));
  let title = TITLES[ui.tab];
  let html = '';
  if (ui.tab === 'workout') html = viewWorkout();
  else if (ui.tab === 'programs') {
    const t = currentTemplate();
    html = t ? viewTemplateEditor(t) : viewPrograms();
    if (t) title = 'Edit program';
  } else if (ui.tab === 'library') html = viewLibrary();
  else if (ui.tab === 'history') {
    html = ui.draft ? viewSessionEditor(ui.draft) : viewHistory();
    if (ui.draft) title = ui.draft.id ? 'Edit workout' : 'Log a past workout';
  }
  else html = viewSettings();
  document.getElementById('title').textContent = title;
  $view.innerHTML = html;
  if (ui.tab === 'library') renderLibList();
  renderModal();
  tick();
}

/* ----- Workout tab ----- */

function viewWorkout() {
  const a = state.active;
  if (!a) {
    const tpls = state.templates.map(t => `
      <div class="card tpl">
        <div class="tpl-main" data-action="editTemplate" data-id="${t.id}">
          <div class="tpl-name">${esc(t.name)}</div>
          <div class="muted small ellipsis">${templateSummary(t)}</div>
        </div>
        <button class="btn primary" data-action="startTemplate" data-id="${t.id}">Start</button>
      </div>`).join('');
    const last = state.sessions[state.sessions.length - 1];
    return `<section class="stack">
      <button class="btn primary big block" data-action="startEmpty">Start an empty workout</button>
      <h2 class="section-title">My programs</h2>
      ${tpls || emptyPrograms()}
      ${last ? `<h2 class="section-title">Last workout</h2>${historyCard(last)}` : ''}
    </section>`;
  }

  const done = a.exercises.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0);
  const prs = livePRs(a);
  return `<section class="stack">
    <div class="card session-head">
      <div>
        <div class="session-name">${esc(a.name)}</div>
        <div class="muted small"><span data-elapsed>0:00</span> · ${plural(done, 'set')} done${prs.size ? ` · 🏆 ${prs.size}` : ''}</div>
        <button class="when-btn" data-action="editWhen">📅 ${fmtDate(a.start)}, ${fmtClock(a.start)} <span class="muted">✎</span></button>
      </div>
      <button class="btn primary" data-action="finishSession">Finish</button>
    </div>
    ${a.exercises.map((e, i) => exerciseCard(e, i, prs)).join('') || '<p class="muted center">Add a first exercise to get started.</p>'}
    <button class="btn block" data-action="addToSession">+ Add exercises</button>
    <button class="btn danger-text block" data-action="cancelSession">Discard workout</button>
  </section>`;
}

function templateSummary(t) {
  if (!t.items.length) return 'No exercises';
  const names = t.items.map(i => getEx(i.exId).name);
  return `${plural(t.items.length, 'exercise')} · ${esc(names.join(', '))}`;
}

function emptyPrograms() {
  return `<div class="card empty">
    <p class="muted">No programs yet.</p>
    <button class="btn primary block" data-action="newTemplate">Create a program</button>
    <button class="btn block" data-action="loadSample">Load a Push / Pull / Legs example</button>
  </div>`;
}

function exerciseCard(e, i, prs) {
  const ex = getEx(e.exId, e.name);
  const mode = exMode(e.exId);
  const last = lastPerf(e.exId, state.active.start);
  const head = mode === 'time'
    ? '<span>Set</span><span>Previous</span><span>Time</span><span>Timer</span><span>✓</span>'
    : '<span>Set</span><span>Previous</span><span>kg</span><span>Reps</span><span>✓</span>';
  const rows = e.sets.map((s, j) => setRow(e, s, i, j, mode, last, prs.has(`${i}:${j}`))).join('');
  return `<div class="card">
    <div class="ex-head">
      <button class="ex-title" data-action="showExercise" data-id="${esc(e.exId)}">${isFav(e.exId) ? '<span class="star-inline">★</span> ' : ''}${esc(ex.name)}</button>
      <button class="icon-btn" data-action="exMenu" data-i="${i}" aria-label="Options">⋯</button>
    </div>
    <div class="last">${e.target ? `Target: <b>${esc(e.target)}</b> · ` : ''}${last
      ? `Last time (${fmtDate(last.date)}): <b>${esc(summarizeSets(last.sets, mode))}</b>`
      : 'First time doing this exercise'}</div>
    <div class="set-grid ${mode === 'time' ? 'time' : ''} set-head">${head}</div>
    ${rows}
    <div class="ex-foot">
      <button class="btn small" data-action="addSet" data-i="${i}">+ Add set</button>
      <button class="btn small ghost" data-action="setRest" data-i="${i}">Rest ${e.rest ? fmtTime(e.rest) : 'off'}</button>
    </div>
  </div>`;
}

function setRow(e, s, i, j, mode, last, isPR) {
  const p = hintFor(e, j, last);
  const prevTxt = last && last.sets[j] ? setShort(last.sets[j], mode) : '–';
  const at = `data-i="${i}" data-j="${j}"`;
  let inputs;
  if (mode === 'time') {
    const c = state.active.chrono;
    const running = c && c.i === i && c.j === j;
    inputs = `<input class="in" inputmode="numeric" data-field="t" ${at} value="${s.t != null ? fmtTime(s.t) : ''}" placeholder="${p ? fmtTime(p.t) : '0:00'}">
      <button class="icon-btn chrono-btn ${running ? 'running' : ''}" data-action="chrono" ${at} aria-label="Timer">${running ? '■' : '▶'}</button>`;
  } else {
    inputs = `<input class="in" inputmode="decimal" data-field="w" ${at} value="${s.w != null ? fmtW(s.w) : ''}" placeholder="${p && p.w != null ? fmtW(p.w) : '–'}">
      <input class="in" inputmode="numeric" data-field="r" ${at} value="${s.r != null ? s.r : ''}" placeholder="${p && p.r != null ? p.r : '–'}">`;
  }
  return `<div class="set-grid ${mode === 'time' ? 'time' : ''} set-row ${s.done ? 'done' : ''}">
    <button class="set-num" data-action="setMenu" ${at} aria-label="Set ${j + 1}${isPR ? ', personal record' : ''}">${isPR ? '<span class="pr-badge" title="Personal record">🏆</span>' : j + 1}</button>
    <span class="prev">${esc(prevTxt)}</span>
    ${inputs}
    <button class="check" data-action="toggleSet" ${at} aria-label="Complete set">✓</button>
  </div>`;
}

/* ----- Programs tab ----- */

function currentTemplate() {
  return ui.editTemplateId ? state.templates.find(t => t.id === ui.editTemplateId) : null;
}

function viewPrograms() {
  const list = state.templates.map(t => `
    <div class="card tpl">
      <div class="tpl-main" data-action="editTemplate" data-id="${t.id}">
        <div class="tpl-name">${esc(t.name)}</div>
        <div class="muted small ellipsis">${templateSummary(t)}</div>
      </div>
      <button class="btn small" data-action="editTemplate" data-id="${t.id}">Edit</button>
    </div>`).join('');
  return `<section class="stack">
    ${list ? `${list}<button class="btn primary block" data-action="newTemplate">+ New program</button>` : emptyPrograms()}
  </section>`;
}

function viewTemplateEditor(t) {
  const items = t.items.map((it, k) => `
    <div class="card">
      <div class="ex-head">
        <button class="ex-title" data-action="showExercise" data-id="${esc(it.exId)}">${esc(getEx(it.exId).name)}</button>
        <button class="icon-btn" data-action="tplMove" data-k="${k}" data-d="-1" aria-label="Move up" ${k === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-btn" data-action="tplMove" data-k="${k}" data-d="1" aria-label="Move down" ${k === t.items.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="icon-btn" data-action="tplRemove" data-k="${k}" aria-label="Remove">✕</button>
      </div>
      <div class="item-fields">
        <label><span>Sets</span>
          <div class="stepper">
            <button data-action="tplSets" data-k="${k}" data-d="-1">−</button><span>${it.sets}</span><button data-action="tplSets" data-k="${k}" data-d="1">+</button>
          </div>
        </label>
        <label><span>${exMode(it.exId) === 'time' ? 'Target time' : 'Target reps'}</span>
          <input class="in" data-tfield="target" data-k="${k}" value="${esc(it.target || '')}" placeholder="${exMode(it.exId) === 'time' ? '0:45' : '8-12'}">
        </label>
        <label><span>Rest</span>
          <button class="btn small" data-action="tplRest" data-k="${k}">${it.rest ? fmtTime(it.rest) : 'off'}</button>
        </label>
      </div>
    </div>`).join('');
  return `<section class="stack">
    <button class="link" data-action="closeEditor">‹ All programs</button>
    <label class="field"><span>Program name</span>
      <input class="in left" id="tplName" data-tfield="name" value="${esc(t.name)}">
    </label>
    ${items || '<p class="muted center">No exercises yet.</p>'}
    <button class="btn block" data-action="tplAdd">+ Add exercises</button>
    <button class="btn primary block" data-action="startTemplate" data-id="${t.id}" ${t.items.length ? '' : 'disabled'}>Start this program</button>
    <button class="btn danger-text block" data-action="deleteTemplate">Delete program</button>
  </section>`;
}

/* ----- Exercises tab ----- */

function groupChips(active, action) {
  return `<div class="chips">
    <button class="chip ${!active ? 'active' : ''}" data-action="${action}" data-g="">All</button>
    <button class="chip ${active === 'fav' ? 'active' : ''}" data-action="${action}" data-g="fav"><span class="star-inline">★</span> Favorites</button>
    ${GROUPS.map(([k, l]) => `<button class="chip ${active === k ? 'active' : ''}" data-action="${action}" data-g="${k}">${l}</button>`).join('')}
  </div>`;
}

function viewLibrary() {
  return `<section class="stack">
    <input type="search" class="in left" id="libSearch" placeholder="Search: bench, squat, curl…" value="${esc(ui.libQuery)}" autocomplete="off">
    ${groupChips(ui.libGroup, 'libGroup')}
    <div id="libList"></div>
    <button class="btn block" data-action="newCustomExercise">+ Create a custom exercise</button>
  </section>`;
}

function exerciseRows(items, limit, opts = {}) {
  if (!items.length) {
    return opts.group === 'fav' && !opts.query
      ? '<p class="muted center">No favorites yet. Tap ☆ next to an exercise to add it here.</p>'
      : '<p class="muted center">No exercises found.</p>';
  }
  const rows = items.slice(0, limit).map(ex => {
    const fav = isFav(ex.id);
    const selected = opts.selected && opts.selected.includes(ex.id);
    const thumb = ex.images[0]
      ? `<img class="thumb" loading="lazy" src="${ex.images[0]}" alt="" onerror="this.style.visibility='hidden'">`
      : `<div class="thumb">${esc(ex.name.charAt(0).toUpperCase())}</div>`;
    const meta = [GROUP_LABEL[ex.group], EQUIP_LABEL[ex.equipment], ex.custom ? 'Custom' : ''].filter(Boolean).join(' · ');
    const end = opts.pick
      ? `<button class="icon-btn" data-action="showExercise" data-id="${esc(ex.id)}" aria-label="Details">ⓘ</button><span class="tick">✓</span>`
      : `<button class="icon-btn star-btn ${fav ? 'on' : ''}" data-action="toggleFav" data-id="${esc(ex.id)}" aria-label="${fav ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${fav}">${fav ? '★' : '☆'}</button>`;
    return `<div class="ex-row ${selected ? 'selected' : ''}" data-action="${opts.pick ? 'pickToggle' : 'showExercise'}" data-id="${esc(ex.id)}">
      ${thumb}
      <div class="ex-row-text"><div class="ex-row-name">${opts.pick && fav ? '<span class="star-inline">★</span> ' : ''}${esc(ex.name)}</div><div class="muted small">${meta}</div></div>
      ${end}
    </div>`;
  }).join('');
  const more = items.length > limit
    ? `<button class="btn block ghost" data-action="${opts.pick ? 'pickMore' : 'libMore'}">Show more (${items.length - limit} left)</button>`
    : '';
  return `<div class="ex-list">${rows}</div>${more}`;
}

function renderLibList() {
  const el = document.getElementById('libList');
  if (el) el.innerHTML = exerciseRows(filterExercises(ui.libQuery, ui.libGroup), ui.libLimit, { group: ui.libGroup, query: ui.libQuery });
}

/* ----- History tab ----- */

function sessionStats(s) {
  let sets = 0, volume = 0, prs = 0;
  for (const e of s.exercises) for (const st of e.sets) {
    sets++;
    if (st.w && st.r) volume += st.w * st.r;
    if (st.pr) prs++;
  }
  return { sets, volume, prs, duration: Math.round((s.end - s.start) / 1000) };
}

function historyCard(s) {
  const st = sessionStats(s);
  return `<div class="card hist" data-action="openSession" data-id="${s.id}">
    <div class="hist-top"><strong>${esc(s.name)}</strong><span class="muted small">${fmtDate(s.start)}</span></div>
    <div class="muted small">${fmtTime(st.duration)} · ${plural(s.exercises.length, 'exercise')} · ${plural(st.sets, 'set')}${st.volume ? ` · ${fmtBig(st.volume)} kg` : ''}${st.prs ? ` · 🏆 ${st.prs}` : ''}</div>
    <div class="small ellipsis" style="margin-top:6px">${esc(s.exercises.map(e => getEx(e.exId, e.name).name).join(', '))}</div>
  </div>`;
}

function viewHistory() {
  const list = state.sessions.slice().reverse().map(historyCard).join('');
  return `<section class="stack">
    <button class="btn block" data-action="logPastSession">+ Log a past workout</button>
    ${list || '<div class="card empty"><p class="muted">No finished workouts yet. They will show up here.</p></div>'}
  </section>`;
}

// Date, start time and duration fields, shared by the live workout and the editor
function whenFields(start, duration) {
  return `<div class="when-grid">
    <label class="field"><span>Date</span><input type="date" class="in left" id="whenDate" data-when value="${toDateInput(start)}"></label>
    <label class="field"><span>Start</span><input type="time" class="in left" id="whenTime" data-when value="${toTimeInput(start)}"></label>
    <label class="field"><span>Duration (min)</span><input class="in left" inputmode="numeric" id="whenDur" data-when value="${duration != null ? Math.round(duration / 60) : ''}" placeholder="live"></label>
  </div>`;
}

// Reads whenFields back; null (with a message) when the date is missing or in the future
function readWhen() {
  const start = fromInputs(document.getElementById('whenDate').value, document.getElementById('whenTime').value);
  const min = parseIntOrNull(document.getElementById('whenDur').value);
  if (!start) { toast('Pick a date'); return null; }
  if (start > Date.now() + 60000) { toast('The start can’t be in the future'); return null; }
  return { start, duration: min > 0 ? min * 60 : null };
}

// Editor for a finished workout (or a past workout being logged)
function viewSessionEditor(d) {
  const cards = d.exercises.map((e, i) => {
    const mode = exMode(e.exId);
    const at = j => `data-i="${i}" data-j="${j}"`;
    const rows = e.sets.map((s, j) => `<div class="edit-grid ${mode === 'time' ? 'time' : ''} set-row">
      <span class="set-num">${j + 1}</span>
      ${mode === 'time'
        ? `<input class="in" inputmode="numeric" data-dfield="t" ${at(j)} value="${s.t != null ? fmtTime(s.t) : ''}" placeholder="0:00">`
        : `<input class="in" inputmode="decimal" data-dfield="w" ${at(j)} value="${s.w != null ? fmtW(s.w) : ''}" placeholder="–">
           <input class="in" inputmode="numeric" data-dfield="r" ${at(j)} value="${s.r != null ? s.r : ''}" placeholder="–">`}
      <button class="icon-btn" data-action="draftDelSet" ${at(j)} aria-label="Delete set ${j + 1}">✕</button>
    </div>`).join('');
    return `<div class="card">
      <div class="ex-head">
        <button class="ex-title" data-action="showExercise" data-id="${esc(e.exId)}">${esc(getEx(e.exId, e.name).name)}</button>
        <button class="icon-btn" data-action="draftExMenu" data-i="${i}" aria-label="Options">⋯</button>
      </div>
      <div class="edit-grid ${mode === 'time' ? 'time' : ''} set-head">${mode === 'time'
        ? '<span>Set</span><span>Time</span><span></span>'
        : '<span>Set</span><span>kg</span><span>Reps</span><span></span>'}</div>
      ${rows}
      <div class="ex-foot"><button class="btn small" data-action="draftAddSet" data-i="${i}">+ Add set</button></div>
    </div>`;
  }).join('');
  return `<section class="stack">
    <button class="link" data-action="cancelDraft">‹ Back to history</button>
    <div class="card stack">
      <label class="field"><span>Name</span><input class="in left" data-dfield="name" value="${esc(d.name)}"></label>
      ${whenFields(d.start, d.duration)}
    </div>
    ${cards || '<p class="muted center">No exercises yet.</p>'}
    <button class="btn block" data-action="draftAddEx">+ Add exercises</button>
    <button class="btn primary block" data-action="saveDraft">${d.id ? 'Save changes' : 'Save workout'}</button>
    <button class="btn ghost block" data-action="cancelDraft">Cancel</button>
  </section>`;
}

function draftExercise(exId, nSets) {
  return { exId, name: getEx(exId).name, sets: Array.from({ length: nSets }, () => ({ w: null, r: null, t: null })) };
}

/* ----- Settings tab ----- */

function viewSettings() {
  const cur = state.settings.theme || 'auto';
  const acc = state.settings.accent;
  const themes = THEMES.map(t => `
    <button class="theme-card ${cur === t.id ? 'active' : ''}" data-action="setTheme" data-id="${t.id}" aria-pressed="${cur === t.id}">
      <span class="theme-preview" style="background:${t.id === 'auto' ? `linear-gradient(135deg, ${t.bg} 50%, ${t.surface} 50%)` : t.bg}">
        <span class="theme-bar" style="background:${t.surface}"></span>
        <span class="theme-dot" style="background:${t.accent}"></span>
      </span>
      <span class="theme-name">${t.name}</span>
      ${t.note ? `<span class="muted tiny">${t.note}</span>` : ''}
    </button>`).join('');
  const swatches = `
    <button class="swatch default ${!acc ? 'active' : ''}" data-action="setAccent" data-c="" aria-label="Theme default">A</button>
    ${ACCENTS.map(c => `<button class="swatch ${acc === c ? 'active' : ''}" data-action="setAccent" data-c="${c}" style="background:${c}" aria-label="Accent ${c}"></button>`).join('')}`;
  return `<section class="stack">
    <h2 class="section-title">Theme</h2>
    <div class="theme-grid">${themes}</div>
    <h2 class="section-title">Accent color</h2>
    <div class="card">
      <div class="swatches">${swatches}</div>
      <p class="muted small" style="margin:10px 0 0">“A” keeps the theme’s own accent.</p>
    </div>
    <h2 class="section-title">Workout</h2>
    <div class="card">
      <div class="hist-top"><span>Default rest time</span><button class="btn small" data-action="defaultRest">${fmtTime(state.settings.defaultRest)}</button></div>
    </div>
    <h2 class="section-title">Data</h2>
    <div class="card stack">
      <button class="btn block" data-action="exportData">Export my data (backup)</button>
      <button class="btn block" data-action="importData">Import a backup</button>
      <p class="muted small">Your data is currently stored on this device. Google Drive sync is the next step.</p>
    </div>
    <p class="muted small center">Exercises and images: <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener">free-exercise-db</a> (public domain).</p>
  </section>`;
}

/* ---------- Progress chart ---------- */

function chartKind(exId) {
  if (exMode(exId) === 'time') return 'time';
  return exHistory(exId).some(h => h.sets.some(s => s.w)) ? 'weight' : 'bodyweight';
}

const METRICS = {
  weight: [
    ['best', 'Top weight', sets => Math.max(...sets.map(s => s.w || 0)), v => `${fmtW(v)} kg`],
    ['e1rm', 'Est. 1RM', sets => Math.max(...sets.map(s => (s.w || 0) * (1 + (s.r || 0) / 30))), v => `${fmtW(Math.round(v * 2) / 2)} kg`],
    ['volume', 'Volume', sets => sets.reduce((n, s) => n + (s.w || 0) * (s.r || 0), 0), v => `${fmtBig(v)} kg`],
  ],
  bodyweight: [
    ['best', 'Max reps', sets => Math.max(...sets.map(s => s.r || 0)), v => `${v} reps`],
    ['total', 'Total reps', sets => sets.reduce((n, s) => n + (s.r || 0), 0), v => `${v} reps`],
  ],
  time: [
    ['best', 'Longest', sets => Math.max(...sets.map(s => s.t || 0)), v => fmtTime(v)],
    ['total', 'Total time', sets => sets.reduce((n, s) => n + (s.t || 0), 0), v => fmtTime(v)],
  ],
};

function chartHtml(m) {
  const kind = chartKind(m.id);
  const metrics = METRICS[kind];
  const metric = metrics.find(x => x[0] === m.metric) || metrics[0];
  const [, , calc, fmt] = metric;
  const points = exHistory(m.id).slice(-24).map(h => ({ date: h.date, v: calc(h.sets) }));
  const seg = `<div class="seg small-seg">${metrics.map(([k, label]) =>
    `<button class="${k === metric[0] ? 'active' : ''}" data-action="chartMetric" data-metric="${k}">${label}</button>`).join('')}</div>`;
  if (points.length < 2) {
    return `${seg}<p class="muted small chart-empty">${points.length
      ? `One workout logged (${fmt(points[0].v)}). Your progress chart appears after the next one.`
      : 'Your progress chart will appear once you have logged this exercise twice.'}</p>`;
  }

  const W = 340, H = 180, L = 46, R = 14, T = 16, B = 26;
  const vals = points.map(p => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.15 || Math.max(1, hi * 0.1);
  lo = Math.max(0, lo - pad);
  hi += pad;
  const step = (W - L - R) / (points.length - 1);
  const x = k => L + k * step;
  const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const ticks = [lo, (lo + hi) / 2, hi];
  const grid = ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
    <text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="axis">${esc(fmt(v))}</text>`).join('');
  const path = points.map((p, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const last = points.length - 1;
  const label = k => `${fmtDate(points[k].date)} · ${fmt(points[k].v)}`;
  const dots = points.map((p, k) =>
    `<circle class="pt" data-k="${k}" cx="${x(k)}" cy="${y(p.v)}" r="${k === last ? 6 : 4}"/>`).join('');
  const hits = points.map((p, k) =>
    `<rect class="hit" data-chart-k="${k}" data-x="${x(k)}" data-label="${esc(label(k))}" data-action="chartPoint" x="${x(k) - step / 2}" y="0" width="${step}" height="${H}"/>`).join('');
  return `${seg}
    <div class="chart">
      <div class="chart-tip">${esc(label(last))}</div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(metric[1])} over time">
        ${grid}
        <text x="${L}" y="${H - 6}" class="axis">${fmtDateShort(points[0].date)}</text>
        <text x="${W - R}" y="${H - 6}" text-anchor="end" class="axis">${fmtDateShort(points[last].date)}</text>
        <line class="xhair" x1="${x(last)}" x2="${x(last)}" y1="${T}" y2="${H - B}"/>
        <path d="${path}" class="line"/>
        ${dots}
        ${hits}
      </svg>
    </div>`;
}

function chartFocus(rect) {
  const svg = rect.closest('svg');
  const k = rect.dataset.chartK;
  svg.querySelectorAll('circle.pt').forEach(c => c.setAttribute('r', c.dataset.k === k ? 6 : 4));
  const xh = svg.querySelector('.xhair');
  xh.setAttribute('x1', rect.dataset.x);
  xh.setAttribute('x2', rect.dataset.x);
  svg.parentElement.querySelector('.chart-tip').textContent = rect.dataset.label;
}
document.addEventListener('pointerover', ev => {
  const r = ev.target.closest && ev.target.closest('[data-chart-k]');
  if (r) chartFocus(r);
});

/* ---------- Workout summary ---------- */

function previousComparable(s) {
  const idx = state.sessions.findIndex(x => x.id === s.id);
  for (let i = idx - 1; i >= 0; i--) {
    const p = state.sessions[i];
    if ((s.templateId && p.templateId === s.templateId) || p.name === s.name) return p;
  }
  return null;
}

function delta(cur, prev) {
  if (!prev) return '';
  if (cur === prev) return '<span class="delta">= same</span>';
  const pct = Math.round(((cur - prev) / prev) * 100);
  return cur > prev
    ? `<span class="delta up">↑ ${pct}%</span>`
    : `<span class="delta down">↓ ${Math.abs(pct)}%</span>`;
}

function summaryHtml(s) {
  const st = sessionStats(s);
  const prev = previousComparable(s);
  const ps = prev && sessionStats(prev);
  const records = [];
  for (const e of s.exercises) {
    const mode = exMode(e.exId);
    for (const x of e.sets) if (x.pr) records.push(`${getEx(e.exId, e.name).name} — ${setLong(x, mode)}`);
  }
  return `
    <div class="tiles">
      <div class="tile"><span class="muted tiny">Duration</span><strong>${fmtTime(st.duration)}</strong></div>
      <div class="tile"><span class="muted tiny">Sets</span><strong>${st.sets}</strong>${ps ? delta(st.sets, ps.sets) : ''}</div>
      <div class="tile"><span class="muted tiny">Volume</span><strong>${fmtBig(st.volume)}<small> kg</small></strong>${ps ? delta(st.volume, ps.volume) : ''}</div>
    </div>
    ${prev ? `<p class="muted tiny" style="margin:6px 0 0">Compared with ${esc(prev.name)} on ${fmtDate(prev.start)}</p>` : ''}
    ${records.length ? `<div class="card records"><strong>🏆 ${plural(records.length, 'new record')}</strong>
      <ul>${records.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}`;
}

/* ---------- Modals ---------- */

const topModal = () => ui.modals[ui.modals.length - 1];
function openModal(m) { ui.modals.push(m); renderModal(); }
function closeModal() { ui.modals.pop(); renderModal(); }

function renderModal() {
  const root = document.getElementById('modal');
  const m = topModal();
  document.body.classList.toggle('modal-open', !!m);
  if (!m) { root.hidden = true; root.innerHTML = ''; return; }
  root.hidden = false;
  root.innerHTML = `<div class="backdrop" data-action="backdrop"></div>${MODALS[m.type](m)}`;
  if (m.type === 'picker') renderPickList();
}

const closeBtn = '<button class="icon-btn" data-action="closeModal" aria-label="Close">✕</button>';

const MODALS = {
  sheet(m) {
    return `<div class="sheet">
      <div class="sheet-head"><h2>${esc(m.title)}</h2>${closeBtn}</div>
      ${m.text ? `<p class="muted">${esc(m.text)}</p>` : ''}
      <div class="sheet-opts">${m.options.map((o, k) =>
        `<button class="btn block ${o.style || ''}" data-action="sheetOpt" data-k="${k}">${esc(o.label)}</button>`).join('')}
      </div>
    </div>`;
  },

  rest(m) {
    return `<div class="sheet">
      <div class="sheet-head"><h2>${esc(m.title || 'Rest time')}</h2>${closeBtn}</div>
      <div class="rest-grid">${REST_CHOICES.map(v =>
        `<button class="btn ${v === m.value ? 'primary' : ''}" data-action="restChoice" data-v="${v}">${v ? fmtTime(v) : 'Off'}</button>`).join('')}
      </div>
    </div>`;
  },

  picker(m) {
    return `<div class="sheet tall">
      <div class="sheet-head"><h2>Add exercises</h2>${closeBtn}</div>
      <input type="search" class="in left" id="pickSearch" placeholder="Search…" value="${esc(m.query)}" autocomplete="off">
      <div style="margin:10px 0">${groupChips(m.group, 'pickGroup')}</div>
      <div class="sheet-body" id="pickList"></div>
      <div class="sheet-foot"><button class="btn primary block" id="pickDone" data-action="pickDone"></button></div>
    </div>`;
  },

  exercise(m) {
    const ex = getEx(m.id);
    const mode = exMode(m.id);
    const hist = exHistory(m.id);
    const best = hist.length ? bestOf(hist.flatMap(h => h.sets), mode) : null;
    const fav = isFav(m.id);
    const muscles = ex.primary.length
      ? `<p class="small"><span class="muted">Muscles: </span>${esc(ex.primary.join(', '))}${ex.secondary.length
        ? `<span class="muted"> · secondary: ${esc(ex.secondary.join(', '))}</span>` : ''}</p>`
      : '';
    return `<div class="sheet">
      <div class="sheet-head">
        <h2>${esc(ex.name)}</h2>
        ${LIB.has(m.id) ? `<button class="icon-btn star-btn ${fav ? 'on' : ''}" data-action="toggleFav" data-id="${esc(m.id)}" aria-label="${fav ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${fav}">${fav ? '★' : '☆'}</button>` : ''}
        ${closeBtn}
      </div>
      <div class="detail">
        ${ex.images.length ? `<div class="ex-img"><img src="${ex.images[0]}" data-anim="${ex.images.join('|')}" alt="${esc(ex.name)}"></div>` : ''}
        <div class="chips wrap">
          ${GROUP_LABEL[ex.group] ? `<span class="chip static">${GROUP_LABEL[ex.group]}</span>` : ''}
          ${EQUIP_LABEL[ex.equipment] ? `<span class="chip static">${EQUIP_LABEL[ex.equipment]}</span>` : ''}
        </div>
        ${muscles}
        <div>
          <div class="muted small" style="margin-bottom:6px">Track this exercise by:</div>
          <div class="seg">
            <button class="${mode === 'reps' ? 'active' : ''}" data-action="setMode" data-id="${esc(m.id)}" data-mode="reps">Weight × reps</button>
            <button class="${mode === 'time' ? 'active' : ''}" data-action="setMode" data-id="${esc(m.id)}" data-mode="time">Duration</button>
          </div>
        </div>
        <div>
          <h3>Progress</h3>
          ${best ? `<p class="small">🏆 Personal record: <b>${esc(setLong(best, mode))}</b></p>` : ''}
          <div id="chartBox">${chartHtml(m)}</div>
        </div>
        ${ex.instructions.length ? `<div><h3>How to</h3>${ex.custom
          ? `<p>${esc(ex.instructions[0])}</p>`
          : `<ol>${ex.instructions.map(t => `<li>${esc(t)}</li>`).join('')}</ol>`}</div>` : ''}
        <div>
          <h3>History</h3>
          ${hist.length ? hist.slice(-8).reverse().map(h => `<div class="hist-line"><span class="muted">${fmtDate(h.date)}</span><span>${esc(summarizeSets(h.sets, mode))}${h.sets.some(s => s.pr) ? ' 🏆' : ''}</span></div>`).join('')
            : '<p class="muted small">Not done yet.</p>'}
        </div>
        ${ex.custom && LIB.has(m.id) ? `<button class="btn danger-text block" data-action="deleteCustom" data-id="${esc(m.id)}">Delete this exercise</button>` : ''}
      </div>
    </div>`;
  },

  custom() {
    return `<div class="sheet">
      <div class="sheet-head"><h2>New exercise</h2>${closeBtn}</div>
      <div class="stack">
        <label class="field"><span>Name</span><input class="in left" id="cxName" placeholder="e.g. Smith machine bench press"></label>
        <label class="field"><span>Muscle group</span>
          <select class="in left" id="cxGroup">${GROUPS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        </label>
        <label class="field"><span>Track by</span>
          <select class="in left" id="cxMode"><option value="reps">Weight × reps</option><option value="time">Duration</option></select>
        </label>
        <label class="field"><span>Notes / cues (optional)</span><textarea class="in left" id="cxText"></textarea></label>
        <button class="btn primary block" data-action="saveCustom">Create exercise</button>
      </div>
    </div>`;
  },

  // Date and time of the live workout
  when() {
    const a = state.active;
    return `<div class="sheet">
      <div class="sheet-head"><h2>Date &amp; time</h2>${closeBtn}</div>
      <div class="stack">
        ${whenFields(a.start, a.duration)}
        <p class="muted small" style="margin:0">Logging a workout you already did? Set its day, start time and duration.
          Leave the duration empty to keep the live timer.</p>
        <button class="btn primary block" data-action="saveWhen">Save</button>
      </div>
    </div>`;
  },

  session(m) {
    const s = state.sessions.find(x => x.id === m.id);
    if (!s) return '';
    return `<div class="sheet">
      <div class="sheet-head"><h2>${m.justFinished ? 'Workout complete 💪' : esc(s.name)}</h2>${closeBtn}</div>
      <p class="muted small">${m.justFinished ? `${esc(s.name)} · ` : ''}${fmtDateLong(s.start)} · ${fmtClock(s.start)}</p>
      <div class="stack">
        ${summaryHtml(s)}
        ${s.exercises.map(e => {
          const mode = exMode(e.exId);
          const before = lastPerf(e.exId, s.start);
          const top = bestOf(e.sets, mode);
          const topBefore = before && bestOf(before.sets, mode);
          return `<div class="card">
            <button class="ex-title" data-action="showExercise" data-id="${esc(e.exId)}">${esc(getEx(e.exId, e.name).name)}</button>
            <div class="muted small">Best set: <b class="ink">${esc(setLong(top, mode))}</b>${topBefore ? ` · last time ${esc(setLong(topBefore, mode))}` : ''}</div>
            <ul class="set-list">${e.sets.map((x, j) => `<li><span>${j + 1}. ${esc(setLong(x, mode))}${x.pr ? ' 🏆' : ''}</span>
              <span class="muted small">${x.rest != null ? `rest ${fmtTime(x.rest)}` : ''}</span></li>`).join('')}</ul>
          </div>`;
        }).join('')}
        <button class="btn block" data-action="editSession" data-id="${s.id}">Edit this workout</button>
        <button class="btn block" data-action="saveAsTemplate" data-id="${s.id}">Create a program from this workout</button>
        <button class="btn danger-text block" data-action="deleteSession" data-id="${s.id}">Delete this workout</button>
      </div>
    </div>`;
  },
};

function openSheet(title, options, text) { openModal({ type: 'sheet', title, options, text }); }
function confirmBox(title, text, okLabel, onOk, danger) {
  openSheet(title, [
    { label: okLabel, style: danger ? 'danger' : 'primary', fn: onOk },
    { label: 'Cancel', style: 'ghost', fn: () => {} },
  ], text);
}
function openRestPicker(value, onPick, title) { openModal({ type: 'rest', value, onPick, title }); }

function openPicker(onDone) {
  openModal({ type: 'picker', query: '', group: null, limit: LIST_PAGE, selected: [], onDone });
}
function renderPickList() {
  const m = topModal();
  if (!m || m.type !== 'picker') return;
  const list = document.getElementById('pickList');
  if (list) list.innerHTML = exerciseRows(filterExercises(m.query, m.group), m.limit, { pick: true, selected: m.selected, group: m.group, query: m.query });
  updatePickButton();
}
function updatePickButton() {
  const m = topModal();
  const btn = document.getElementById('pickDone');
  if (!btn) return;
  btn.textContent = m.selected.length ? `Add (${m.selected.length})` : 'Select exercises';
  btn.disabled = !m.selected.length;
}

/* ---------- Live workout ---------- */

function newSessionExercise(exId, nSets, rest, target) {
  const last = lastPerf(exId);
  const n = nSets || (last ? last.sets.length : 3);
  const remembered = state.exerciseSettings[exId] && state.exerciseSettings[exId].rest;
  return {
    exId,
    name: getEx(exId).name,
    rest: rest ?? remembered ?? state.settings.defaultRest,
    target: target || '',
    sets: Array.from({ length: n }, () => ({ w: null, r: null, t: null, done: false })),
  };
}

function startSession(t) {
  if (state.active) {
    toast('A workout is already in progress');
    ui.tab = 'workout';
    render();
    return;
  }
  state.active = {
    id: uid(),
    name: t ? t.name : 'Workout',
    templateId: t ? t.id : null,
    start: Date.now(),
    exercises: t ? t.items.map(it => newSessionExercise(it.exId, it.sets, it.rest, it.target)) : [],
    restEnd: null, restTotal: 0, restNotified: true,
    chrono: null,
  };
  ui.tab = 'workout';
  ui.editTemplateId = null;
  unlockAudio();
  saveNow();
  render();
  window.scrollTo(0, 0);
}

function lastDoneAt(a, except) {
  let max = 0;
  for (const e of a.exercises) for (const s of e.sets) if (s.done && s !== except && s.doneAt > max) max = s.doneAt;
  return max || null;
}

function startRest(sec) {
  const a = state.active;
  a.restEnd = Date.now() + sec * 1000;
  a.restTotal = sec;
  a.restNotified = false;
  ui.restDoneUntil = 0;
}

function stopChrono() {
  const a = state.active;
  if (!a || !a.chrono) return;
  const { i, j, start } = a.chrono;
  const set = a.exercises[i] && a.exercises[i].sets[j];
  if (set) set.t = Math.round((Date.now() - start) / 1000);
  a.chrono = null;
}

function finishSession() {
  const a = state.active;
  stopChrono();
  const exercises = a.exercises
    .map(e => ({
      exId: e.exId,
      name: e.name,
      sets: e.sets.filter(s => s.done).map(s => ({ w: s.w, r: s.r, t: s.t, rest: s.rest ?? null })),
    }))
    .filter(e => e.sets.length);
  const end = a.duration != null ? a.start + a.duration * 1000 : Date.now();
  const record = { id: a.id, name: a.name, templateId: a.templateId, start: a.start, end, exercises };
  state.sessions.push(record);
  sortSessions();
  state.active = null;
  saveNow();
  ui.tab = 'history';
  render();
  openModal({ type: 'session', id: record.id, justFinished: true });
}

/* ---------- Actions (clicks) ---------- */

const A = () => state.active;

const actions = {
  tab(d) {
    ui.tab = d.tab;
    if (d.tab !== 'programs') ui.editTemplateId = null;
    render();
    window.scrollTo(0, 0);
  },

  // Modals
  backdrop() { closeModal(); },
  closeModal() { closeModal(); },
  sheetOpt(d) {
    const opt = topModal().options[+d.k];
    closeModal();
    opt.fn();
  },
  restChoice(d) {
    const m = topModal();
    closeModal();
    m.onPick(+d.v);
  },

  // Live workout
  startEmpty() { startSession(null); },
  startTemplate(d) {
    const t = state.templates.find(x => x.id === d.id);
    if (t) startSession(t);
  },
  toggleSet(d) {
    const a = A();
    const i = +d.i, j = +d.j;
    const e = a.exercises[i];
    const s = e.sets[j];
    const mode = exMode(e.exId);
    unlockAudio();
    if (s.done) {
      s.done = false;
      s.rest = null;
      s.doneAt = null;
      save();
      render();
      return;
    }
    const p = hintFor(e, j, lastPerf(e.exId, a.start));
    if (mode === 'time') {
      if (a.chrono && a.chrono.i === i && a.chrono.j === j) stopChrono();
      if (s.t == null && p) s.t = p.t;
      if (!s.t) { toast('Enter a duration (or use the ▶ timer)'); return; }
    } else {
      if (s.r == null && p) s.r = p.r;
      if (s.w == null && p && p.w != null) s.w = p.w;
      if (s.r == null) { toast('Enter the number of reps'); return; }
    }
    const now = Date.now();
    const prevDone = lastDoneAt(a, s);
    s.rest = prevDone ? Math.round((now - prevDone) / 1000) : null;
    s.doneAt = now;
    s.done = true;
    if (e.rest > 0) startRest(e.rest);
    if (livePRs(a).has(`${i}:${j}`)) toast(`🏆 New record: ${setLong(s, mode)}`);
    save();
    render();
  },
  addSet(d) {
    const e = A().exercises[+d.i];
    const prev = e.sets[e.sets.length - 1];
    e.sets.push({ w: prev ? prev.w : null, r: prev ? prev.r : null, t: prev ? prev.t : null, done: false });
    save();
    render();
  },
  setMenu(d) {
    const i = +d.i, j = +d.j;
    openSheet(`Set ${j + 1}`, [
      { label: 'Delete this set', style: 'danger', fn: () => {
        const a = A();
        if (a.chrono && a.chrono.i === i) a.chrono = null;
        a.exercises[i].sets.splice(j, 1);
        save();
        render();
      } },
      { label: 'Cancel', style: 'ghost', fn: () => {} },
    ]);
  },
  exMenu(d) {
    const i = +d.i;
    const a = A();
    const e = a.exercises[i];
    const move = delta => () => {
      const k = i + delta;
      if (k < 0 || k >= a.exercises.length) return;
      [a.exercises[i], a.exercises[k]] = [a.exercises[k], a.exercises[i]];
      a.chrono = null;
      save();
      render();
    };
    openSheet(getEx(e.exId, e.name).name, [
      { label: 'View details', fn: () => openModal({ type: 'exercise', id: e.exId }) },
      ...(i > 0 ? [{ label: 'Move up', fn: move(-1) }] : []),
      ...(i < a.exercises.length - 1 ? [{ label: 'Move down', fn: move(1) }] : []),
      { label: 'Remove from workout', style: 'danger', fn: () => {
        a.exercises.splice(i, 1);
        a.chrono = null;
        save();
        render();
      } },
    ]);
  },
  setRest(d) {
    const e = A().exercises[+d.i];
    openRestPicker(e.rest, v => {
      e.rest = v;
      exSetting(e.exId).rest = v;
      save();
      render();
    }, `Rest — ${getEx(e.exId, e.name).name}`);
  },
  chrono(d) {
    const a = A();
    const i = +d.i, j = +d.j;
    const running = a.chrono && a.chrono.i === i && a.chrono.j === j;
    stopChrono();
    if (!running) {
      a.chrono = { i, j, start: Date.now() };
      unlockAudio();
    }
    save();
    render();
  },
  addToSession() {
    openPicker(ids => {
      for (const id of ids) A().exercises.push(newSessionExercise(id));
      save();
      render();
    });
  },
  finishSession() {
    const a = A();
    const done = a.exercises.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0);
    const pending = a.exercises.reduce((n, e) => n + e.sets.filter(s => !s.done).length, 0);
    if (!done) {
      confirmBox('No completed sets', 'Tick your sets with ✓ to save them. Discard this workout?', 'Discard workout', () => {
        state.active = null; saveNow(); render();
      }, true);
      return;
    }
    confirmBox('Finish workout?',
      pending ? `${plural(pending, 'unticked set')} will not be saved.` : '',
      'Finish and save', finishSession);
  },
  cancelSession() {
    confirmBox('Discard workout?', 'Nothing will be saved.', 'Discard', () => {
      state.active = null; saveNow(); render();
    }, true);
  },
  editWhen() { openModal({ type: 'when' }); },
  saveWhen() {
    const w = readWhen();
    if (!w) return;
    const a = A();
    let duration = w.duration;
    // A workout moved hours into the past would otherwise last until "now"
    if (duration == null && Date.now() - w.start > 6 * 3600e3) {
      duration = 3600;
      toast('Duration set to 60 min — you can change it');
    }
    a.start = w.start;
    a.duration = duration;
    closeModal();
    save();
    render();
  },
  restAdjust(d) {
    const a = A();
    if (!a || !a.restEnd) return;
    a.restEnd += +d.d * 1000;
    a.restTotal = Math.max(1, a.restTotal + +d.d);
    if (a.restEnd <= Date.now()) a.restEnd = Date.now();
    save();
    tick();
  },
  restSkip() {
    const a = A();
    if (a) { a.restEnd = null; a.restNotified = true; }
    ui.restDoneUntil = 0;
    save();
    tick();
  },

  // Programs
  newTemplate() {
    const t = { id: uid(), name: 'New program', items: [] };
    state.templates.push(t);
    ui.tab = 'programs';
    ui.editTemplateId = t.id;
    save();
    render();
    const input = document.getElementById('tplName');
    if (input) { input.focus(); input.select(); }
  },
  loadSample() {
    for (const p of SAMPLE_PPL) {
      state.templates.push({
        id: uid(), name: p.name,
        items: p.items.filter(([id]) => LIB.has(id)).map(([exId, sets, target, rest]) => ({ exId, sets, target, rest })),
      });
    }
    save();
    render();
    toast('3 programs added: Push, Pull, Legs');
  },
  editTemplate(d) {
    ui.tab = 'programs';
    ui.editTemplateId = d.id;
    render();
    window.scrollTo(0, 0);
  },
  closeEditor() { ui.editTemplateId = null; render(); },
  tplMove(d) {
    const t = currentTemplate(), k = +d.k, n = k + +d.d;
    if (n < 0 || n >= t.items.length) return;
    [t.items[k], t.items[n]] = [t.items[n], t.items[k]];
    save();
    render();
  },
  tplRemove(d) { currentTemplate().items.splice(+d.k, 1); save(); render(); },
  tplSets(d) {
    const it = currentTemplate().items[+d.k];
    it.sets = Math.min(20, Math.max(1, it.sets + +d.d));
    save();
    render();
  },
  tplRest(d) {
    const it = currentTemplate().items[+d.k];
    openRestPicker(it.rest, v => { it.rest = v; save(); render(); });
  },
  tplAdd() {
    const t = currentTemplate();
    openPicker(ids => {
      for (const exId of ids) {
        const remembered = state.exerciseSettings[exId] && state.exerciseSettings[exId].rest;
        t.items.push({ exId, sets: 3, target: '', rest: remembered ?? state.settings.defaultRest });
      }
      save();
      render();
    });
  },
  deleteTemplate() {
    const t = currentTemplate();
    confirmBox(`Delete “${t.name}”?`, 'Your past workouts stay in your history.', 'Delete', () => {
      state.templates = state.templates.filter(x => x.id !== t.id);
      ui.editTemplateId = null;
      save();
      render();
    }, true);
  },

  // Library
  libGroup(d) { ui.libGroup = d.g || null; ui.libLimit = LIST_PAGE; render(); },
  libMore() { ui.libLimit += LIST_PAGE; renderLibList(); },
  showExercise(d) { openModal({ type: 'exercise', id: d.id }); },
  toggleFav(d) {
    const k = state.favorites.indexOf(d.id);
    if (k >= 0) state.favorites.splice(k, 1); else state.favorites.push(d.id);
    save();
    toast(k >= 0 ? 'Removed from favorites' : '★ Added to favorites');
    if (ui.tab === 'library') renderLibList();
    if (ui.tab === 'workout' && A()) render();
    else if (topModal()) {
      // Update the star in place so the sheet keeps its scroll position
      const btn = document.querySelector('#modal .star-btn');
      if (btn) {
        const fav = k < 0;
        btn.classList.toggle('on', fav);
        btn.textContent = fav ? '★' : '☆';
        btn.setAttribute('aria-pressed', fav);
      }
    }
  },
  setMode(d) {
    exSetting(d.id).mode = d.mode;
    recomputePRs();
    save();
    renderModal();
    if (ui.tab === 'workout' && A()) render();
  },
  chartMetric(d) {
    const m = topModal();
    m.metric = d.metric;
    document.getElementById('chartBox').innerHTML = chartHtml(m);
  },
  chartPoint(d, el) { chartFocus(el); },
  newCustomExercise() {
    openModal({ type: 'custom' });
    setTimeout(() => { const el = document.getElementById('cxName'); if (el) el.focus(); }, 50);
  },
  saveCustom() {
    const name = document.getElementById('cxName').value.trim();
    if (!name) { toast('Give the exercise a name'); return; }
    state.customExercises.push({
      id: 'c_' + uid(), name,
      group: document.getElementById('cxGroup').value,
      mode: document.getElementById('cxMode').value,
      instructions: document.getElementById('cxText').value.trim(),
    });
    rebuildLibrary();
    save();
    closeModal();
    render();
    toast('Exercise created');
  },
  deleteCustom(d) {
    confirmBox('Delete this exercise?', 'It stays visible in your past workouts.', 'Delete', () => {
      state.customExercises = state.customExercises.filter(c => c.id !== d.id);
      state.favorites = state.favorites.filter(id => id !== d.id);
      rebuildLibrary();
      save();
      ui.modals = [];
      render();
    }, true);
  },

  // Exercise picker
  pickGroup(d) {
    const m = topModal();
    m.group = d.g || null;
    m.limit = LIST_PAGE;
    renderModal();
  },
  pickMore() { topModal().limit += LIST_PAGE; renderPickList(); },
  pickToggle(d, el) {
    const m = topModal();
    const k = m.selected.indexOf(d.id);
    if (k >= 0) m.selected.splice(k, 1); else m.selected.push(d.id);
    el.classList.toggle('selected', k < 0);
    updatePickButton();
  },
  pickDone() {
    const m = topModal();
    closeModal();
    m.onDone(m.selected.slice());
  },

  // History
  openSession(d) { openModal({ type: 'session', id: d.id }); },
  deleteSession(d) {
    confirmBox('Delete this workout?', 'It will disappear from your history and your “last time” numbers.', 'Delete', () => {
      state.sessions = state.sessions.filter(s => s.id !== d.id);
      recomputePRs();
      save();
      ui.modals = [];
      render();
    }, true);
  },
  saveAsTemplate(d) {
    const s = state.sessions.find(x => x.id === d.id);
    const t = {
      id: uid(), name: s.name,
      items: s.exercises.map(e => {
        const restRemembered = state.exerciseSettings[e.exId] && state.exerciseSettings[e.exId].rest;
        return { exId: e.exId, sets: e.sets.length, target: '', rest: restRemembered ?? state.settings.defaultRest };
      }),
    };
    state.templates.push(t);
    save();
    ui.modals = [];
    ui.tab = 'programs';
    ui.editTemplateId = t.id;
    render();
    toast('Program created — you can rename it');
  },

  // Editing a finished workout / logging a past one
  editSession(d) {
    const s = state.sessions.find(x => x.id === d.id);
    ui.draft = {
      id: s.id, name: s.name, templateId: s.templateId, start: s.start,
      duration: Math.round((s.end - s.start) / 1000),
      exercises: s.exercises.map(e => ({ exId: e.exId, name: e.name, sets: e.sets.map(x => ({ w: x.w, r: x.r, t: x.t, rest: x.rest })) })),
    };
    ui.modals = [];
    ui.tab = 'history';
    render();
    window.scrollTo(0, 0);
  },
  logPastSession() {
    const open = t => {
      const start = new Date();
      start.setMinutes(0, 0, 0);
      ui.draft = {
        id: null, name: t ? t.name : 'Workout', templateId: t ? t.id : null,
        start: start.getTime() - 3600e3, duration: 3600,
        exercises: t ? t.items.map(it => draftExercise(it.exId, it.sets)) : [],
      };
      render();
      window.scrollTo(0, 0);
    };
    if (!state.templates.length) { open(null); return; }
    openSheet('Log a past workout', [
      ...state.templates.map(t => ({ label: t.name, fn: () => open(t) })),
      { label: 'Empty workout', style: 'ghost', fn: () => open(null) },
    ], 'Start from one of your programs?');
  },
  draftAddSet(d) {
    const e = ui.draft.exercises[+d.i];
    const prev = e.sets[e.sets.length - 1];
    e.sets.push({ w: prev ? prev.w : null, r: prev ? prev.r : null, t: prev ? prev.t : null });
    render();
  },
  draftDelSet(d) {
    ui.draft.exercises[+d.i].sets.splice(+d.j, 1);
    render();
  },
  draftExMenu(d) {
    const i = +d.i;
    const list = ui.draft.exercises;
    const move = delta => () => {
      [list[i], list[i + delta]] = [list[i + delta], list[i]];
      render();
    };
    openSheet(getEx(list[i].exId, list[i].name).name, [
      ...(i > 0 ? [{ label: 'Move up', fn: move(-1) }] : []),
      ...(i < list.length - 1 ? [{ label: 'Move down', fn: move(1) }] : []),
      { label: 'Remove from workout', style: 'danger', fn: () => { list.splice(i, 1); render(); } },
    ]);
  },
  draftAddEx() {
    openPicker(ids => {
      for (const id of ids) {
        const last = lastPerf(id, ui.draft.start);
        ui.draft.exercises.push(draftExercise(id, last ? last.sets.length : 3));
      }
      render();
    });
  },
  saveDraft() {
    const d = ui.draft;
    const w = readWhen();
    if (!w) return;
    // Sets left without reps (or without a duration) are dropped
    const exercises = d.exercises
      .map(e => {
        const mode = exMode(e.exId);
        return {
          exId: e.exId, name: e.name,
          sets: e.sets.filter(s => (mode === 'time' ? s.t : s.r != null))
            .map(s => ({ w: s.w, r: s.r, t: s.t, rest: s.rest ?? null })),
        };
      })
      .filter(e => e.sets.length);
    if (!exercises.length) { toast('Fill in at least one set'); return; }
    const record = {
      id: d.id || uid(), name: d.name.trim() || 'Workout', templateId: d.templateId || null,
      start: w.start, end: w.start + (w.duration ?? 3600) * 1000, exercises,
    };
    const k = state.sessions.findIndex(s => s.id === record.id);
    if (k >= 0) state.sessions[k] = record; else state.sessions.push(record);
    sortSessions();
    saveNow();
    ui.draft = null;
    render();
    openModal({ type: 'session', id: record.id });
    toast(d.id ? 'Workout updated' : 'Workout saved');
  },
  cancelDraft() {
    ui.draft = null;
    render();
    window.scrollTo(0, 0);
  },

  // Settings
  setTheme(d) {
    state.settings.theme = d.id;
    applyTheme();
    save();
    render();
  },
  setAccent(d) {
    state.settings.accent = d.c || null;
    applyTheme();
    save();
    render();
  },
  defaultRest() {
    openRestPicker(state.settings.defaultRest, v => { state.settings.defaultRest = v; save(); render(); }, 'Default rest time');
  },
  exportData() {
    saveNow();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gym-tracker-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  importData() { document.getElementById('importFile').click(); },
};

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  if (el.dataset.action === 'backdrop' && ev.target !== el) return;
  const fn = actions[el.dataset.action];
  if (fn) {
    ev.stopPropagation();
    fn(el.dataset, el, ev);
  }
});

/* ---------- Inputs ---------- */

document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'libSearch') {
    ui.libQuery = t.value;
    ui.libLimit = LIST_PAGE;
    renderLibList();
    return;
  }
  if (t.id === 'pickSearch') {
    const m = topModal();
    m.query = t.value;
    m.limit = LIST_PAGE;
    renderPickList();
    return;
  }
  if (t.dataset.field && state.active) {
    const s = state.active.exercises[+t.dataset.i].sets[+t.dataset.j];
    if (t.dataset.field === 'w') s.w = parseNum(t.value);
    else if (t.dataset.field === 'r') s.r = parseIntOrNull(t.value);
    else if (t.dataset.field === 't') s.t = parseTime(t.value);
    save();
    return;
  }
  if (t.dataset.dfield && ui.draft) {
    if (t.dataset.dfield === 'name') { ui.draft.name = t.value; return; }
    const s = ui.draft.exercises[+t.dataset.i].sets[+t.dataset.j];
    if (t.dataset.dfield === 'w') s.w = parseNum(t.value);
    else if (t.dataset.dfield === 'r') s.r = parseIntOrNull(t.value);
    else s.t = parseTime(t.value);
    return;
  }
  // Keep the editor's date fields across re-renders (adding a set, an exercise…)
  if (t.dataset.when !== undefined && ui.draft && !topModal()) {
    const start = fromInputs(document.getElementById('whenDate').value, document.getElementById('whenTime').value);
    const min = parseIntOrNull(document.getElementById('whenDur').value);
    if (start) ui.draft.start = start;
    ui.draft.duration = min > 0 ? min * 60 : null;
    return;
  }
  if (t.dataset.tfield) {
    const tpl = currentTemplate();
    if (!tpl) return;
    if (t.dataset.tfield === 'name') tpl.name = t.value;
    else tpl.items[+t.dataset.k].target = t.value;
    save();
  }
});

// Reformat durations as m:ss when leaving the field
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.dataset.field === 't' && state.active) {
    const s = state.active.exercises[+t.dataset.i].sets[+t.dataset.j];
    t.value = s.t != null ? fmtTime(s.t) : '';
  }
  if (t.dataset.dfield === 't' && ui.draft) {
    const s = ui.draft.exercises[+t.dataset.i].sets[+t.dataset.j];
    t.value = s.t != null ? fmtTime(s.t) : '';
  }
});

// Editing a running timer by hand stops it
document.addEventListener('focusin', ev => {
  const t = ev.target;
  const c = state.active && state.active.chrono;
  if (t.dataset.field === 't' && c && c.i === +t.dataset.i && c.j === +t.dataset.j) {
    stopChrono();
    save();
    render();
  }
});

document.getElementById('importFile').addEventListener('change', async ev => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.sessions) || !Array.isArray(data.templates)) throw new Error('format');
    confirmBox('Import this backup?',
      `${plural(data.sessions.length, 'workout')} and ${plural(data.templates.length, 'program')}. Your current data will be replaced.`,
      'Import', () => {
        const base = defaultState();
        state = Object.assign(base, data, { settings: Object.assign(base.settings, data.settings) });
        rebuildLibrary();
        applyTheme();
        saveNow();
        render();
        toast('Backup imported');
      }, true);
  } catch (e) {
    toast('This file is not a valid backup');
  }
});

/* ---------- Clock: elapsed time, timer, rest, animated images ---------- */

function updateRestBar(now) {
  const bar = document.getElementById('restBar');
  const a = state.active;
  let visible = false;
  if (a && a.restEnd) {
    const left = (a.restEnd - now) / 1000;
    if (left <= 0) {
      if (!a.restNotified) notifyRestDone();
      a.restNotified = true;
      a.restEnd = null;
      ui.restDoneUntil = now + 4000;
      save();
    } else {
      visible = true;
      bar.classList.remove('finished');
      document.getElementById('restLabel').textContent = 'Rest';
      document.getElementById('restTime').textContent = fmtTime(Math.ceil(left));
      document.getElementById('restFill').style.width = `${Math.min(100, 100 * (1 - left / a.restTotal))}%`;
    }
  }
  if (!visible && a && now < ui.restDoneUntil) {
    visible = true;
    bar.classList.add('finished');
    document.getElementById('restLabel').textContent = 'Rest over';
    document.getElementById('restTime').textContent = 'Go!';
  }
  bar.hidden = !visible;
  document.body.classList.toggle('resting', visible);
}

function tick() {
  const now = Date.now();
  const a = state.active;
  if (a) {
    const elapsed = a.duration != null ? a.duration : (now - a.start) / 1000;
    document.querySelectorAll('[data-elapsed]').forEach(el => { el.textContent = fmtTime(elapsed); });
    if (a.chrono) {
      const input = document.querySelector(`input[data-field="t"][data-i="${a.chrono.i}"][data-j="${a.chrono.j}"]`);
      if (input && document.activeElement !== input) input.value = fmtTime((now - a.chrono.start) / 1000);
    }
  }
  updateRestBar(now);
  document.querySelectorAll('img[data-anim]').forEach(img => {
    const srcs = img.dataset.anim.split('|');
    const src = srcs[Math.floor(now / 1000) % srcs.length];
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
  });
}

/* ---------- Start-up ---------- */

applyTheme();
rebuildLibrary();
render();
setInterval(tick, 250);
