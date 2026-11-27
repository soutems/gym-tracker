// "Ask your AI": turns the workout history into a text file an AI chat reads easily,
// then hands it to the AI app of the user's choice through the phone's share sheet.
// Loaded after app.js: it adds its modal and actions to the app's MODALS and actions.

// [key, button label, label inside the French file]
const AI_PERIODS = [
  ['last', 'Last workout', 'dernière séance'],
  ['last3', 'Last 3 workouts', '3 dernières séances'],
  ['week', 'This week', 'semaine en cours'],
  ['month', 'This month', 'mois en cours'],
  ['all', 'Full history', 'historique complet'],
];

const AI_COACH = 'Réponds en français, comme un coach sportif : concret, bienveillant mais franc.';
const AI_PROMPTS = [
  ['Conseils généraux', 'Ce que tu en penses, en général',
    'Voici mon historique de workout (fichier joint). Quels conseils me donnes-tu ?'],
  ['Analyse ma progression', 'Où je progresse, où je stagne',
    'Voici mon historique de workout (fichier joint). Analyse ma progression : sur quels exercices je progresse, où je stagne, et que dois-je changer pour continuer à progresser ?'],
  ['Prépare ma prochaine séance', 'Exercices, séries, reps et charges',
    'Voici mon historique de workout (fichier joint). Propose-moi ma prochaine séance : exercices, séries, répétitions et charges, en tenant compte de ce que j\'ai fait récemment.'],
  ['Suis-je équilibré ?', 'Muscles délaissés, poussée / tirage',
    'Voici mon historique de workout (fichier joint). Mon entraînement est-il équilibré entre les groupes musculaires et entre poussée et tirage ? Qu\'est-ce que je néglige, et comment le corriger ?'],
];

const FR_GROUP = {
  chest: 'Pectoraux', back: 'Dos', shoulders: 'Épaules', biceps: 'Biceps', triceps: 'Triceps',
  forearms: 'Avant-bras', abs: 'Abdos', quads: 'Quadriceps', hamstrings: 'Ischio-jambiers',
  glutes: 'Fessiers', calves: 'Mollets', cardio: 'Cardio', stretch: 'Étirements', other: 'Autre',
};
const FR_EQUIP = {
  barbell: 'barre', dumbbell: 'haltères', 'e-z curl bar': 'barre EZ', machine: 'machine', cable: 'poulie',
  kettlebells: 'kettlebell', 'body only': 'poids du corps', bands: 'élastiques',
};

const frDate = ts => new Date(ts).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const frNum = n => Math.round(n).toLocaleString('fr-FR');
const frDec = n => fmtW(n).replace('.', ',');
function frSet(s, mode) {
  if (mode === 'time') return s.w ? `${fmtW(s.w)} kg × ${fmtTime(s.t)}` : fmtTime(s.t);
  if (mode === 'cardio') {
    const km = setKm(s);
    return [fmtTime(s.t), s.sp ? `à ${frDec(s.sp)} km/h` : '', s.inc ? `inclinaison ${frDec(s.inc)} %` : '',
      km ? `(≈ ${km.toFixed(2).replace('.', ',')} km)` : ''].filter(Boolean).join(' ');
  }
  return s.w ? `${fmtW(s.w)} kg × ${s.r ?? 0}` : `${s.r ?? 0} reps (poids du corps)`;
}

function aiSessions(period) {
  const all = state.sessions;
  const now = new Date();
  if (period === 'last') return all.slice(-1);
  if (period === 'last3') return all.slice(-3);
  if (period === 'all') return all.slice();
  const from = period === 'week'
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)) // Monday
    : new Date(now.getFullYear(), now.getMonth(), 1);
  return all.filter(s => s.start >= from.getTime());
}

// Readable for an AI as well as for a human: a summary, then progress per exercise, then each workout
function aiExport(sessions, periodLabel) {
  const L = [];
  const first = sessions[0], last = sessions[sessions.length - 1];
  const days = Math.max(1, (last.start - first.start) / 864e5);
  let volume = 0, prs = 0, minutes = 0;
  const perGroup = {};
  for (const s of sessions) {
    minutes += (s.end - s.start) / 60000;
    for (const e of s.exercises) {
      const g = getEx(e.exId, e.name).group;
      perGroup[g] = (perGroup[g] || 0) + e.sets.length;
      for (const x of e.sets) {
        if (x.w && x.r) volume += x.w * x.r;
        if (x.pr) prs++;
      }
    }
  }

  L.push('# Historique d\'entraînement (Gym Tracker)', '');
  L.push(`Période : ${periodLabel}, du ${frDate(first.start)} au ${frDate(last.start)}`);
  L.push(`Exporté le : ${frDate(Date.now())}`);
  L.push('Unités : charges en kg, durées en minutes:secondes. « 60 kg × 8 » = 8 répétitions à 60 kg. « 20 kg × 1:00 » = une minute avec 20 kg. Cardio : vitesse en km/h, inclinaison en %. 🏆 = record personnel battu ce jour-là.');
  L.push('Note : sur les exercices « assisté(e) », le poids est l\'aide de la machine (moins = plus difficile).', '');

  L.push('## Résumé');
  L.push(`- Séances : ${sessions.length}${sessions.length > 1 ? ` (environ ${(sessions.length / (days / 7)).toFixed(1).replace('.', ',')} par semaine)` : ''}`);
  L.push(`- Durée moyenne : ${Math.round(minutes / sessions.length)} min`);
  if (volume) L.push(`- Volume total soulevé : ${frNum(volume)} kg`);
  L.push(`- Records battus : ${prs}`);
  L.push(`- Séries par groupe musculaire : ${Object.entries(perGroup).sort((a, b) => b[1] - a[1])
    .map(([g, n]) => `${FR_GROUP[g] || g} ${n}`).join(', ')}`, '');

  // Progress per exercise, in the order they were first done
  const byEx = new Map();
  for (const s of sessions) for (const e of s.exercises) {
    if (!byEx.has(e.exId)) byEx.set(e.exId, []);
    byEx.get(e.exId).push({ s, e });
  }
  L.push('## Progression par exercice');
  for (const [exId, rows] of byEx) {
    const ex = getEx(exId, rows[0].e.name);
    const mode = exMode(exId);
    const kind = [FR_GROUP[ex.group], FR_EQUIP[ex.equipment]].filter(Boolean).join(', ');
    L.push(`### ${ex.name}${kind ? ` (${kind})` : ''}`);
    if (sessions.length <= 3) {
      const before = lastPerf(exId, rows[0].s.start);
      if (before) L.push(`- Séance précédente (${frDate(before.date)}) : ${before.sets.map(x => frSet(x, mode)).join(', ')}`);
    }
    for (const { s, e } of rows) {
      const best = bestOf(e.sets, mode);
      L.push(`- ${frDate(s.start)} : ${e.sets.map(x => frSet(x, mode) + (x.pr ? ' 🏆' : '')).join(', ')}` +
        (e.sets.length > 1 ? ` (meilleure série : ${frSet(best, mode)})` : ''));
    }
    L.push('');
  }

  L.push('## Détail des séances');
  for (const s of sessions) {
    L.push(`### ${frDate(s.start)} : ${s.name} (${Math.round((s.end - s.start) / 60000)} min)`);
    for (const e of s.exercises) {
      const mode = exMode(e.exId);
      L.push(`- ${getEx(e.exId, e.name).name} : ${e.sets.map(x => frSet(x, mode) + (x.pr ? ' 🏆' : '')).join(', ')}`);
    }
    L.push('');
  }
  return L.join('\n');
}

function aiPayload(m) {
  const sessions = m.sessionId ? state.sessions.filter(s => s.id === m.sessionId) : aiSessions(m.period);
  if (!sessions.length) return null;
  const label = m.sessionId ? 'une séance' : AI_PERIODS.find(p => p[0] === m.period)[2];
  const prompt = `${AI_PROMPTS[m.prompt][2]} ${AI_COACH}`;
  const text = aiExport(sessions, label);
  const day = new Date().toISOString().slice(0, 10);
  return { sessions, prompt, text, fileName: `gym-tracker-${m.sessionId ? 'seance' : m.period}-${day}.txt` };
}

MODALS.askAI = m => {
  const p = aiPayload(m);
  const periods = m.sessionId ? '' : `
    <div class="field"><span>Which data</span>
      <div class="chips wrap">${AI_PERIODS.map(([k, l]) =>
        `<button class="chip ${m.period === k ? 'active' : ''}" data-action="askPeriod" data-k="${k}">${l}</button>`).join('')}</div>
    </div>`;
  const info = p
    ? `${plural(p.sessions.length, 'workout')} · ${Math.max(1, Math.round(p.text.length / 1024))} KB of text`
    : 'No workout in this period.';
  return `<div class="sheet">
    <div class="sheet-head"><h2>✨ Ask your AI</h2>${closeBtn}</div>
    <div class="stack">
      ${periods}
      <div class="field"><span>Your question (in French)</span>
        <div class="ai-choices">${AI_PROMPTS.map(([title, sub], k) =>
          `<button class="ai-choice ${m.prompt === k ? 'active' : ''}" data-action="askPrompt" data-k="${k}">${title}<small>${sub}</small></button>`).join('')}</div>
      </div>
      <p class="muted small" style="margin:0">${info}</p>
      <button class="btn primary block" data-action="askShare" ${p ? '' : 'disabled'}>Choose an AI app</button>
      <button class="btn block" data-action="askCopy" ${p ? '' : 'disabled'}>Copy question and data</button>
      <p class="muted tiny" style="margin:0">Pick Claude, ChatGPT, Gemini… in the list. The question is also copied: if it doesn't appear in the chat, paste it. Your data goes only to the app you choose.</p>
    </div>
  </div>`;
};

Object.assign(actions, {
  askAI(d) {
    openModal({ type: 'askAI', sessionId: d.id || null, period: 'last3', prompt: 0 });
  },
  askPeriod(d) { topModal().period = d.k; renderModal(); },
  askPrompt(d) { topModal().prompt = +d.k; renderModal(); },
  askShare() {
    const p = aiPayload(topModal());
    if (!p) return;
    // Copy the question first, in the same tap, for apps that keep only the file
    if (navigator.clipboard) navigator.clipboard.writeText(p.prompt).catch(() => {});
    const file = new File([p.text], p.fileName, { type: 'text/plain' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], text: p.prompt, title: 'Gym Tracker' }).catch(() => {});
    } else if (navigator.share) {
      // No file sharing (some browsers): send everything as text
      navigator.share({ text: `${p.prompt}\n\n${p.text}`, title: 'Gym Tracker' }).catch(() => {});
    } else {
      actions.askCopy();
      toast('Sharing is not available here: question and data copied');
    }
  },
  askCopy() {
    const p = aiPayload(topModal());
    if (!p || !navigator.clipboard) return;
    navigator.clipboard.writeText(`${p.prompt}\n\n${p.text}`)
      .then(() => toast('Copied: paste it in your AI chat'))
      .catch(() => toast('Could not copy'));
  },
});
