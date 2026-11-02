/* Google Drive sync.
 *
 * The whole history lives in one JSON file in the user's Drive, created by this
 * app ("drive.file" scope: the app only sees files it created). Each device keeps
 * its own copy in localStorage and merges with the Drive copy, so it works offline
 * and two phones can both log workouts.
 *
 * Merge rules
 * - sessions / templates / custom exercises: by id, the most recently edited wins
 *   (field `u` = last edit time). Deletions leave a tombstone in `deleted`.
 * - favorites / exercise settings / settings: the most recently edited block wins
 *   (times in `syncMeta`).
 * - the workout in progress stays on its device.
 *
 * Sign-in uses Google's OAuth redirect flow (no popup, which home-screen apps on
 * iOS handle badly). The access token lasts one hour; when it has expired the app
 * gets a new one with a silent redirect.
 *
 * Loaded before app.js; the functions below only touch app.js globals when called.
 */

// From Google Cloud console → Google Auth Platform → Clients (not a secret)
const GOOGLE_CLIENT_ID = '1010087927957-gt24u9eimbumbskij1leevhoj097e551.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FILE_NAME = 'Gym Tracker data.json';
const AUTH_KEY = 'muscu-tracker:google';

const RECORD_LISTS = ['sessions', 'templates', 'customExercises'];
const BLOCKS = ['favorites', 'exerciseSettings', 'settings'];

const sync = {
  status: 'off',        // off | idle | syncing | offline | signin | error
  timer: null,
  running: null,        // promise of the sync in progress
  again: false,         // a change arrived during a sync
  dirty: false,         // local changes not yet uploaded
  lastAt: 0,
  error: '',
};

/* ---------- Change tracking ---------- */

// Last saved JSON of every record and block, to see what changed since
let stampCache = null;

const stripU = r => JSON.stringify(Object.assign({}, r, { u: undefined }));

function primeStamps() {
  stampCache = {};
  for (const key of RECORD_LISTS) for (const r of state[key]) stampCache[key + ':' + r.id] = stripU(r);
  for (const key of BLOCKS) stampCache['#' + key] = JSON.stringify(state[key]);
}

// Called on every local save: dates the edited records and remembers deletions.
// Returns true when something that is synced has changed.
function stampChanges() {
  if (!stampCache) { primeStamps(); return false; }
  const now = Date.now();
  state.deleted = state.deleted || {};
  state.syncMeta = state.syncMeta || {};
  let changed = false;
  const seen = new Set();
  for (const key of RECORD_LISTS) {
    for (const r of state[key]) {
      const k = key + ':' + r.id;
      seen.add(k);
      const json = stripU(r);
      if (stampCache[k] !== json) { r.u = now; stampCache[k] = json; changed = true; }
    }
  }
  for (const k of Object.keys(stampCache)) {
    if (k[0] === '#' || seen.has(k)) continue;
    state.deleted[k.slice(k.indexOf(':') + 1)] = now;
    delete stampCache[k];
    changed = true;
  }
  for (const key of BLOCKS) {
    const json = JSON.stringify(state[key]);
    if (stampCache['#' + key] !== json) { state.syncMeta[key] = now; stampCache['#' + key] = json; changed = true; }
  }
  return changed;
}

/* ---------- Merge ---------- */

function syncPayload(s) {
  const out = { version: 1, deleted: s.deleted || {}, syncMeta: s.syncMeta || {} };
  for (const key of RECORD_LISTS.concat(BLOCKS)) out[key] = s[key];
  return out;
}

function mergeData(local, remote) {
  const deleted = Object.assign({}, remote.deleted);
  for (const [id, t] of Object.entries(local.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, t);
  const out = { deleted, syncMeta: {} };
  for (const key of RECORD_LISTS) {
    const byId = new Map();
    // Local copy last, so it wins a tie
    for (const r of (remote[key] || []).concat(local[key] || [])) {
      const cur = byId.get(r.id);
      if (!cur || (r.u || 0) >= (cur.u || 0)) byId.set(r.id, r);
    }
    out[key] = [...byId.values()].filter(r => !(deleted[r.id] >= (r.u || 0)));
  }
  const lm = local.syncMeta || {}, rm = remote.syncMeta || {};
  for (const key of BLOCKS) {
    const useRemote = remote[key] !== undefined && (rm[key] || 0) > (lm[key] || 0);
    out[key] = useRemote ? remote[key] : local[key];
    out.syncMeta[key] = Math.max(lm[key] || 0, rm[key] || 0);
  }
  return out;
}

/* ---------- Google sign-in (redirect flow) ---------- */

function authInfo() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || {}; } catch (e) { return {}; }
}
function setAuth(patch) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(Object.assign(authInfo(), patch)));
}
const tokenValid = a => a.token && a.exp > Date.now() + 60e3;
const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');

function googleSignIn(silent) {
  const a = authInfo();
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  setAuth({ nonce, lastRedirect: Date.now() });
  saveNow();
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: appUrl(),
    response_type: 'token',
    scope: DRIVE_SCOPE,
    include_granted_scopes: 'true',
    state: nonce,
  });
  if (silent) p.set('prompt', 'none');
  if (a.email) p.set('login_hint', a.email);
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
}

// Reads the token Google sends back in the URL (#access_token=…)
function readAuthRedirect() {
  // The token comes in the #fragment; some errors come in the ?query instead
  const src = location.hash.includes('state=') ? location.hash.slice(1)
    : location.search.includes('state=') ? location.search.slice(1) : null;
  if (!src) return null;
  const p = new URLSearchParams(src);
  history.replaceState(null, '', appUrl());
  const a = authInfo();
  if (p.get('state') !== a.nonce) return null;
  if (p.get('access_token')) {
    setAuth({ token: p.get('access_token'), exp: Date.now() + (+p.get('expires_in') || 3600) * 1000, connected: true, nonce: null });
    return 'ok';
  }
  setAuth({ nonce: null });
  return p.get('error') || 'error';
}

/* ---------- Drive API ---------- */

async function drive(path, opts = {}) {
  const res = await fetch('https://www.googleapis.com' + path, Object.assign({}, opts, {
    headers: Object.assign({ Authorization: 'Bearer ' + authInfo().token }, opts.headers),
  }));
  if (res.status === 401) { setAuth({ token: null }); throw new Error('signin'); }
  if (!res.ok) throw new Error('Drive error ' + res.status);
  return res;
}

async function findFile() {
  const a = authInfo();
  if (a.fileId) return a.fileId;
  const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
  const r = await (await drive(`/drive/v3/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id)`)).json();
  const id = r.files && r.files[0] ? r.files[0].id : null;
  if (id) setAuth({ fileId: id });
  return id;
}

async function uploadFile(id, data) {
  const body = JSON.stringify(data);
  if (id) {
    await drive(`/upload/drive/v3/files/${id}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
    });
    return id;
  }
  const boundary = 'gymtracker' + Date.now();
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: DRIVE_FILE_NAME, mimeType: 'application/json' }) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const r = await (await drive('/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
  })).json();
  setAuth({ fileId: r.id });
  return r.id;
}

async function fetchEmail() {
  try {
    const r = await (await drive('/drive/v3/about?fields=user(emailAddress)')).json();
    setAuth({ email: r.user.emailAddress });
  } catch (e) { /* only used for display and as a sign-in hint */ }
}

/* ---------- Sync ---------- */

function setSyncStatus(s, error = '') {
  sync.status = s;
  sync.error = error;
  updateSyncBadge();
  if (ui.tab === 'settings' && !topModal()) {
    const el = document.getElementById('syncCard');
    if (el) el.outerHTML = syncCardHtml();
  }
}

function syncNow() {
  if (sync.running) { sync.again = true; return sync.running; }
  sync.running = runSync().finally(() => {
    sync.running = null;
    if (sync.again) { sync.again = false; syncNow(); }
  });
  return sync.running;
}

async function runSync() {
  const a = authInfo();
  if (!GOOGLE_CLIENT_ID || !a.connected) { setSyncStatus('off'); return; }
  if (!navigator.onLine) { setSyncStatus('offline'); return; }
  if (!tokenValid(a)) { setSyncStatus('signin'); return; }
  setSyncStatus('syncing');
  try {
    saveNow();
    let id = await findFile();
    let remote = null;
    if (id) {
      try {
        remote = await (await drive(`/drive/v3/files/${id}?alt=media`)).json();
      } catch (e) {
        if (String(e.message).includes('404')) { setAuth({ fileId: null }); id = await findFile(); }
        else throw e;
      }
    }
    const before = JSON.stringify(syncPayload(state));
    if (remote) {
      const merged = mergeData(syncPayload(state), remote);
      const activeBefore = state.active;
      Object.assign(state, merged, { active: activeBefore });
      sortSessions();
      rebuildLibrary();
      applyTheme();
      primeStamps();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    const after = JSON.stringify(syncPayload(state));
    if (!remote || after !== JSON.stringify(syncPayload(remote))) await uploadFile(id, syncPayload(state));
    sync.dirty = false;
    sync.lastAt = Date.now();
    setAuth({ lastSync: sync.lastAt });
    setSyncStatus('idle');
    // Redraw only if the data shown has changed and the user is not typing
    if (after !== before && !isTyping()) render();
  } catch (e) {
    if (e.message === 'signin') setSyncStatus('signin');
    else setSyncStatus(navigator.onLine ? 'error' : 'offline', e.message);
  }
}

const isTyping = () => {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
};

// Hook from saveNow(): something changed locally
function syncOnSave(changed) {
  if (!changed || !authInfo().connected) return;
  sync.dirty = true;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(syncNow, 4000);
  updateSyncBadge();
}

// If the token has expired, get a new one with a silent redirect (at most every 10 min)
function maybeReconnect() {
  const a = authInfo();
  if (!GOOGLE_CLIENT_ID || !a.connected || tokenValid(a) || !navigator.onLine) return false;
  if (Date.now() - (a.lastRedirect || 0) < 10 * 60e3) return false;
  googleSignIn(true);
  return true;
}

function syncInit() {
  primeStamps();
  sync.lastAt = authInfo().lastSync || 0;
  const result = readAuthRedirect();
  if (result === 'ok') {
    fetchEmail().then(() => setSyncStatus(sync.status));
    toast('Connected to Google Drive');
  } else if (result) {
    // Silent sign-in refused (signed out of Google, consent removed…): ask the user
    setSyncStatus('signin');
  }
  if (!result && maybeReconnect()) return;
  syncNow();
  window.addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!maybeReconnect() && Date.now() - sync.lastAt > 60e3) syncNow();
  });
}

/* ---------- UI ---------- */

const SYNC_TEXT = {
  off: 'Not connected',
  idle: 'Synced',
  syncing: 'Syncing…',
  offline: 'Offline — will sync when back online',
  signin: 'Google sign-in needed',
  error: 'Sync failed',
};

function updateSyncBadge() {
  const el = document.getElementById('syncBadge');
  if (!el) return;
  const s = !authInfo().connected ? 'off' : sync.dirty && sync.status === 'idle' ? 'syncing' : sync.status;
  el.hidden = s === 'off';
  el.dataset.state = s;
  el.title = SYNC_TEXT[s];
  el.setAttribute('aria-label', 'Sync: ' + SYNC_TEXT[s]);
}

function syncCardHtml() {
  const a = authInfo();
  if (!GOOGLE_CLIENT_ID) {
    return `<div class="card stack" id="syncCard"><p class="muted small" style="margin:0">Google Drive sync is not set up yet.</p></div>`;
  }
  if (!a.connected) {
    return `<div class="card stack" id="syncCard">
      <p class="small" style="margin:0">Keep your workouts in your Google Drive and use the app on several phones.</p>
      <button class="btn primary block" data-action="driveConnect">Connect Google Drive</button>
    </div>`;
  }
  const when = sync.lastAt ? `Last sync: ${fmtDate(sync.lastAt)}, ${fmtClock(sync.lastAt)}` : 'Not synced yet';
  return `<div class="card stack" id="syncCard">
    <div class="hist-top"><strong>Google Drive</strong><span class="sync-state" data-state="${sync.status}">${SYNC_TEXT[sync.status]}</span></div>
    ${a.email ? `<p class="muted small" style="margin:0">${esc(a.email)}</p>` : ''}
    <p class="muted small" style="margin:0">${when}${sync.error ? ` · ${esc(sync.error)}` : ''}</p>
    ${sync.status === 'signin'
      ? '<button class="btn primary block" data-action="driveConnect">Sign in to Google again</button>'
      : '<button class="btn block" data-action="driveSync">Sync now</button>'}
    <button class="btn danger-text block" data-action="driveDisconnect">Disconnect</button>
  </div>`;
}
