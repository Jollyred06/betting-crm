/**
 * 🔎 SECONDO PARERE (14 novembre 2026, tappa 1 del collegamento della taratura). Per ogni segnale I:
 *  1. trova il campionato negli storici (dalle squadre: i nomi dei campionati del feed sono ambigui) — se non lo trova vale solo il generale
 *  2. corregge la probabilita' di Pinnacle con quanto Pinnacle ha sbagliato in passato in quella fascia (calib.adjust)
 *  3. ricalcola il vantaggio: "conferma" (resta almeno al 2%), "dubbio" (tra 0 e 2%), "contraddice" (sotto zero)
 * SOLA MISURA: nessuna regola e nessun segnale cambia. I risultati dei tre gruppi dicono se il filtro varrebbe la pena.
 */
const C = require('./calib');
const MIN_EDGE = 2;
const strip = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const wordsOf = s => strip(s).split(/[^a-z0-9]+/).filter(w => w.length >= 4);

/** Indice parola -> [{league, team}] dalle squadre dello storico. Parte pura. */
function teamIndex(pairs) {
  const idx = new Map();
  for (const p of pairs) for (const w of new Set(wordsOf(p.team))) { if (!idx.has(w)) idx.set(w, []); idx.get(w).push(p); }
  return idx;
}

/** Campionato dello storico per una partita: serve che entrambe le squadre si trovino nello stesso. Parte pura. */
function leagueOf(idx, home, away, sameTeam, cache = new Map()) {
  const key = strip(home) + '|' + strip(away); if (cache.has(key)) return cache.get(key);
  const find = name => { const out = new Set(); for (const w of wordsOf(name)) for (const p of idx.get(w) || []) if (!out.has(p.league) && sameTeam(name, p.team)) out.add(p.league); return out; };
  const a = find(home), b = find(away), both = [...a].filter(x => b.has(x));
  const res = both.length === 1 ? both[0] : null;
  cache.set(key, res); return res;
}

const SEL = { home: 'home', draw: 'draw', away: 'away' };
function opinionOf(cal, league, sig) {
  const p = Number(sig.fair_prob), odd = Number(sig.odd), o = SEL[sig.selection];
  if (!(p > 0 && p < 1) || !(odd > 1) || !o || !cal) return null;
  const adj = C.adjust(cal, league, o, p), edge = (odd * adj.p - 1) * 100;
  return { league, n: adj.n, shiftPts: adj.shift * 100, pAdj: adj.p, edgeAdj: edge, verdict: edge >= MIN_EDGE ? 'conferma' : edge >= 0 ? 'dubbio' : 'contraddice' };
}

/** Riepilogo per gruppo (parte pura): riceve righe con .op e i campi del segnale ridotti da brain.featuresOf. */
function summarizeByVerdict(feats, summarize) {
  const out = {};
  for (const v of ['conferma', 'dubbio', 'contraddice']) out[v] = summarize(feats.filter(f => f.op && f.op.verdict === v));
  out.senza = summarize(feats.filter(f => !f.op));
  return out;
}

let cache = null;
async function getOpinions(pool, { nowMs = Date.now(), force = false } = {}) {
  if (!force && cache && nowMs - cache.at < 10 * 60000) return cache.val;
  const I = require('./italia'), B = require('./brain');
  await C.ensureCalib(pool);
  const hist = (await pool.query(`SELECT league, hg, ag, ph, pd, pa FROM hist_pin WHERE ph IS NOT NULL`)).rows;
  if (!hist.length) return { ready: false };
  const teams = (await pool.query(`SELECT league, home AS team FROM hist_pin GROUP BY league, home`)).rows;
  const cal = C.calibrate(hist), idx = teamIndex(teams), lc = new Map();
  const all = (await pool.query(`SELECT * FROM italia_signals WHERE strategy = 'I' ORDER BY created_at`)).rows;
  const rows = I.primaryRows(all).filter(r => r.result !== 'void');
  const feats = rows.map(r => { const f = B.featuresOf(r, I); const lg = leagueOf(idx, r.home, r.away, I.sameTeam, lc); f.op = opinionOf(cal, lg, r); f.homeName = r.home; f.awayName = r.away; f.start = r.commence_time; f.sel = r.selection; f.book = r.book; return f; });
  const jl = feats.filter(f => f.jl);
  const open = jl.filter(f => !f.result && f.start && Date.parse(f.start) > nowMs).map(f => ({ home: f.homeName, away: f.awayName, selection: f.sel, book: f.book, odd: f.odd, edge: f.edge, op: f.op && { league: f.op.league, n: f.op.n, shiftPts: f.op.shiftPts, edgeAdj: f.op.edgeAdj, verdict: f.op.verdict } }));
  const val = { ready: true, histMatches: hist.length, mapped: feats.filter(f => f.op && f.op.league).length, total: feats.length,
    all: summarizeByVerdict(feats, B.summarize), jl: summarizeByVerdict(jl, B.summarize), open, updatedAt: new Date(nowMs).toISOString() };
  cache = { at: nowMs, val }; return val;
}

module.exports = { MIN_EDGE, teamIndex, leagueOf, opinionOf, summarizeByVerdict, getOpinions };
