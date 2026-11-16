// Local coach: reads the workout history and turns it into short pieces of advice.
// Everything is computed on the phone; nothing is sent anywhere.
// Uses helpers from app.js (state, getEx, exMode, plural, fmtW, fmtDate…), so it only runs once the app has loaded.

const DAY = 864e5;
const LEG_GROUPS = ['quads', 'hamstrings', 'glutes', 'calves'];
const PUSH_GROUPS = ['chest', 'shoulders', 'triceps'];
const PULL_GROUPS = ['back', 'biceps'];
// Muscles that a balanced program trains every few weeks
const MAIN_GROUPS = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes'];
// Where a neglected muscle fits best: groups usually trained in the same workout
const PARTNERS = {
  shoulders: ['chest', 'triceps'], chest: ['shoulders', 'triceps'], triceps: ['chest', 'shoulders'],
  back: ['biceps'], biceps: ['back'], quads: ['hamstrings', 'glutes'], hamstrings: ['quads', 'glutes'],
  glutes: ['quads', 'hamstrings'], calves: ['quads', 'hamstrings'], abs: [],
};

const daysAgo = ts => Math.floor((Date.now() - ts) / DAY);
const groupOf = exId => getEx(exId).group;

// Done sets per muscle group since a date (time-based exercises count too)
function setsByGroup(since) {
  const out = {};
  for (const s of state.sessions) {
    if (s.start < since) continue;
    for (const e of s.exercises) {
      const g = groupOf(e.exId);
      out[g] = (out[g] || 0) + e.sets.length;
    }
  }
  return out;
}

const sessionHits = (s, groups) => s.exercises.some(e => groups.includes(groupOf(e.exId)));

function coachInsights() {
  const sessions = state.sessions;
  if (sessions.length < 3) {
    return [{ level: 'tip', icon: '🧭', title: 'Your coach is warming up',
      text: `Log ${plural(3 - sessions.length, 'more workout')} and you'll get advice on your regularity, progress and muscle balance.` }];
  }
  const now = Date.now();
  const last = sessions[sessions.length - 1];
  const out = [];

  // 1. Overall regularity
  const recent = sessions.filter(s => s.start >= now - 28 * DAY).length;
  const before = sessions.filter(s => s.start >= now - 56 * DAY && s.start < now - 28 * DAY).length;
  const gap = daysAgo(last.start);
  if (gap >= 7) {
    out.push({ level: 'warn', icon: '⏰', title: `No workout for ${gap} days`,
      text: `Your last one was on ${fmtDate(last.start)}. A short session today is enough to get back on track.` });
  } else if (recent >= 6 && recent >= before) {
    out.push({ level: 'good', icon: '🔥', title: `${(recent / 4).toFixed(1).replace('.0', '')} workouts a week`,
      text: `${plural(recent, 'workout')} in the last 4 weeks${before ? ` (${before} the 4 weeks before)` : ''}. Keep it up.` });
  } else if (before >= 4 && recent < before * 0.6) {
    out.push({ level: 'warn', icon: '📉', title: 'Your pace is dropping',
      text: `${plural(recent, 'workout')} in the last 4 weeks, against ${before} the 4 weeks before.` });
  }

  // 2. Leg day regularity
  const legSessions = sessions.filter(s => sessionHits(s, LEG_GROUPS));
  const lastLeg = legSessions[legSessions.length - 1];
  const sinceLeg = lastLeg ? sessions.filter(s => s.start > lastLeg.start).length : sessions.length;
  const legWarned = !lastLeg || (daysAgo(lastLeg.start) >= 10 && sinceLeg >= 2);
  if (!lastLeg) {
    out.push({ level: 'warn', icon: '🦵', title: 'No leg day yet',
      text: 'None of your workouts trains the legs. Squats, leg press or lunges once a week make a real difference.' });
  } else if (daysAgo(lastLeg.start) >= 10 && sinceLeg >= 2) {
    out.push({ level: 'warn', icon: '🦵', title: 'Your leg day regularity is slipping',
      text: `Last leg workout: ${daysAgo(lastLeg.start)} days ago (${fmtDate(lastLeg.start)}), and you've trained ${plural(sinceLeg, 'time')} since without legs.` });
  } else {
    const legShare = sessions.filter(s => s.start >= now - 56 * DAY);
    const legs = legShare.filter(s => sessionHits(s, LEG_GROUPS)).length;
    if (legShare.length >= 6 && legs / legShare.length < 0.2) {
      out.push({ level: 'tip', icon: '🦵', title: 'Not much leg work',
        text: `Only ${legs} of your last ${legShare.length} workouts include legs. Aim for at least one in three.` });
    }
  }

  // 3. Muscle balance over the last 4 weeks
  const vol = setsByGroup(now - 28 * DAY);
  const trained = MAIN_GROUPS.map(g => vol[g] || 0).filter(n => n > 0).sort((a, b) => a - b);
  if (trained.length >= 3) {
    const median = trained[Math.floor(trained.length / 2)];
    const weak = MAIN_GROUPS
      .filter(g => !LEG_GROUPS.includes(g) || !legWarned) // legs already have their own warning
      .filter(g => (vol[g] || 0) < median * 0.35)
      .sort((a, b) => (vol[a] || 0) - (vol[b] || 0))
      .slice(0, 2);
    for (const g of weak) {
      const tpl = programFor(g);
      const where = !tpl ? ''
        : tpl.has ? ` Your ${tpl.name} program already has some: don't skip them.`
        : ` Add one to your ${tpl.name} program.`;
      out.push({ level: 'tip', icon: '⚖️', title: `You're neglecting ${GROUP_LABEL[g].toLowerCase()}`,
        text: `${plural(vol[g] || 0, 'set')} in the last 4 weeks, against about ${median} for your other main muscles.${where}` });
    }
    const push = PUSH_GROUPS.reduce((n, g) => n + (vol[g] || 0), 0);
    const pull = PULL_GROUPS.reduce((n, g) => n + (vol[g] || 0), 0);
    if (push >= 12 && pull < push / 1.6) {
      out.push({ level: 'tip', icon: '↔️', title: 'More pushing than pulling',
        text: `${push} push sets for ${pull} pull sets in 4 weeks. More rows and pulldowns protect your shoulders and posture.` });
    } else if (pull >= 12 && push < pull / 1.6) {
      out.push({ level: 'tip', icon: '↔️', title: 'More pulling than pushing',
        text: `${pull} pull sets for ${push} push sets in 4 weeks. Add some presses to balance it out.` });
    }
  }

  // 4. Stalled weights, and recent records
  out.push(...stalls());
  const prs = sessions.filter(s => s.start >= now - 30 * DAY)
    .reduce((n, s) => n + s.exercises.reduce((m, e) => m + e.sets.filter(x => x.pr).length, 0), 0);
  if (prs >= 3) {
    out.push({ level: 'good', icon: '🏆', title: `${prs} records this month`, text: 'Your training is paying off.' });
  }

  const rank = { warn: 0, tip: 1, good: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

// The program that best fits a muscle: one that already trains it, else the one training its usual partners the most
function programFor(group) {
  const partners = PARTNERS[group] || [];
  let best = null, bestScore = 0;
  for (const t of state.templates) {
    const groups = t.items.map(i => groupOf(i.exId));
    if (groups.includes(group)) return { name: t.name, has: true };
    const score = groups.filter(g => partners.includes(g)).length;
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return best && { name: best.name, has: false };
}

// Exercises done at the same top weight for at least 4 workouts in a row, over 3+ weeks
function stalls() {
  const now = Date.now();
  const found = [];
  const seen = new Set();
  for (const s of state.sessions) for (const e of s.exercises) seen.add(e.exId);
  for (const exId of seen) {
    const ex = getEx(exId);
    if (exMode(exId) !== 'reps' || /assist/i.test(ex.name)) continue;
    const hist = exHistory(exId)
      .map(h => {
        const top = Math.max(...h.sets.map(x => x.w || 0));
        return { date: h.date, top, reps: Math.max(...h.sets.filter(x => (x.w || 0) === top).map(x => x.r || 0)) };
      })
      .filter(h => h.top > 0);
    if (hist.length < 4) continue;
    const latest = hist[hist.length - 1];
    if (now - latest.date > 30 * DAY) continue; // no longer in the program
    let k = hist.length - 1;
    while (k > 0 && hist[k - 1].top === latest.top) k--;
    const streak = hist.slice(k);
    if (streak.length < 4 || latest.date - streak[0].date < 21 * DAY) continue;
    const step = ex.equipment === 'dumbbell' || ex.equipment === 'kettlebells' ? 2 : 2.5;
    const repsUp = latest.reps > streak[0].reps;
    found.push({
      weeks: Math.round((latest.date - streak[0].date) / (7 * DAY)),
      insight: {
        level: repsUp ? 'tip' : 'warn', icon: '📈',
        title: `${ex.name}: stuck at ${fmtW(latest.top)} kg`,
        text: `${plural(streak.length, 'workout')} at this weight since ${fmtDate(streak[0].date)}.` + (repsUp
          ? ` Your reps went up (${streak[0].reps} → ${latest.reps}): time to try ${fmtW(latest.top + step)} kg.`
          : ` Try ${fmtW(latest.top + step)} kg for fewer reps, or add a rep each workout before going heavier.`),
      },
    });
  }
  return found.sort((a, b) => b.weeks - a.weeks).slice(0, 3).map(f => f.insight);
}

function coachCard() {
  const items = coachInsights();
  const shown = ui.coachAll ? items : items.slice(0, 3);
  const rows = shown.map(i => `<div class="coach-item ${i.level}">
      <span class="coach-icon" aria-hidden="true">${i.icon}</span>
      <div><div class="coach-title">${esc(i.title)}</div><div class="muted small">${esc(i.text)}</div></div>
    </div>`).join('');
  const more = items.length > 3
    ? `<button class="link" data-action="coachToggle">${ui.coachAll ? 'Show less' : `Show all (${items.length})`}</button>`
    : '';
  return `<div class="card coach">${rows}${more}</div>`;
}
