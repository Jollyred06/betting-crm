/**
 * 💪 FORZA DELLE SQUADRE (Elo, 15 novembre 2026). Dallo storico (hist_pin, 41.000 partite di 26 campionati) ogni squadra ha
 * un punteggio che sale quando vince e scende quando perde, piu' o meno a seconda di quanto era attesa la vittoria; in casa vale
 * un vantaggio fisso. La differenza di forza si traduce in probabilita' 1 X 2 con le frequenze vere dello storico (a fasce di 50 punti).
 * E' il sesto "esperto" dell'IA adattiva: se aiuta a indovinare il suo peso sale da solo, altrimenti scende.
 * Limite: copre solo le squadre dei campionati dello storico (circa una partita su dieci tra quelle dei segnali).
 */
const START = 1500, K = 20, HFA = 60, BIN = 50, CAP = 400;

/** Parte pura: righe {league, match_date, home, away, hg, ag} in qualunque ordine. */
function buildElo(rows) {
  const R = new Map(), last = new Map(), cnt = new Map();
  const key = (l, t) => l + '|' + t, get = k => (R.has(k) ? R.get(k) : START);
  const bins = new Map(), tot = { home: 0, draw: 0, away: 0 };
  for (const m of [...rows].sort((a, b) => String(a.match_date).localeCompare(String(b.match_date)))) {
    const kh = key(m.league, m.home), ka = key(m.league, m.away), rh = get(kh), ra = get(ka);
    const diff = rh - ra + HFA, e = 1 / (1 + 10 ** (-diff / 400));
    const hg = Number(m.hg), ag = Number(m.ag), out = hg > ag ? 'home' : hg === ag ? 'draw' : 'away', s = out === 'home' ? 1 : out === 'draw' ? 0.5 : 0;
    // la tabella si riempie solo quando tutte e due le squadre hanno gia' qualche partita (punteggio sensato)
    if ((cnt.get(kh) || 0) >= 10 && (cnt.get(ka) || 0) >= 10) { const b = binOf(diff); if (!bins.has(b)) bins.set(b, { home: 0, draw: 0, away: 0 }); bins.get(b)[out]++; tot[out]++; }
    const gd = Math.abs(hg - ag), mult = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8;   // vittorie larghe contano un po' di piu'
    R.set(kh, rh + K * mult * (s - e)); R.set(ka, ra - K * mult * (s - e));
    last.set(kh, m.match_date); last.set(ka, m.match_date); cnt.set(kh, (cnt.get(kh) || 0) + 1); cnt.set(ka, (cnt.get(ka) || 0) + 1);
  }
  const n = tot.home + tot.draw + tot.away, prior = n ? { home: tot.home / n, draw: tot.draw / n, away: tot.away / n } : { home: 0.45, draw: 0.27, away: 0.28 };
  const table = new Map();
  for (const [b, c] of bins) { const t = c.home + c.draw + c.away, a = 20;   // si avvicina alla media quando la fascia ha poche partite
    table.set(b, { home: (c.home + a * prior.home) / (t + a), draw: (c.draw + a * prior.draw) / (t + a), away: (c.away + a * prior.away) / (t + a) }); }
  return { ratings: R, last, games: cnt, table, prior, matches: rows.length };
}
function binOf(diff) { const d = Math.max(-CAP, Math.min(CAP, diff)); return Math.round(d / BIN) * BIN; }
function probsFromDiff(model, diff) { return model.table.get(binOf(diff)) || model.prior; }

/** Squadra dello storico che corrisponde a un nome del feed, dentro un campionato. */
function teamIn(idx, league, name, sameTeam) {
  const w = String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(x => x.length >= 4);
  for (const x of w) for (const p of idx.get(x) || []) if (p.league === league && sameTeam(name, p.team)) return p.team;
  return null;
}

/** Probabilita' Elo per una partita del feed, o null se le squadre non sono nello storico. */
function eloProbs(model, idx, home, away, { leagueOf, sameTeam, cache }) {
  if (!model) return null;
  const lg = leagueOf(idx, home, away, sameTeam, cache); if (!lg) return null;
  const th = teamIn(idx, lg, home, sameTeam), ta = teamIn(idx, lg, away, sameTeam); if (!th || !ta) return null;
  const kh = lg + '|' + th, ka = lg + '|' + ta;
  if ((model.games.get(kh) || 0) < 10 || (model.games.get(ka) || 0) < 10) return null;
  const diff = model.ratings.get(kh) - model.ratings.get(ka) + HFA;
  return { ...probsFromDiff(model, diff), league: lg, diff };
}

let cache = null;
/** Modello e funzione di ricerca, in memoria 30 minuti. */
async function getEloCached(pool, { nowMs = Date.now() } = {}) {
  if (cache && nowMs - cache.at < 30 * 60000) return cache.val;
  const rows = (await pool.query(`SELECT league, match_date, home, away, hg, ag FROM hist_pin`)).rows;
  if (!rows.length) { cache = { at: nowMs, val: null }; return null; }
  const O = require('./opinion'), I = require('./italia');
  const model = buildElo(rows), teams = new Map();
  for (const r of rows) { teams.set(r.league + '|' + r.home, { league: r.league, team: r.home }); teams.set(r.league + '|' + r.away, { league: r.league, team: r.away }); }
  const idx = O.teamIndex([...teams.values()]), lc = new Map();
  const val = { model, of: (home, away) => eloProbs(model, idx, home, away, { leagueOf: O.leagueOf, sameTeam: I.sameTeam, cache: lc }) };
  cache = { at: nowMs, val }; return val;
}

module.exports = { START, K, HFA, buildElo, probsFromDiff, teamIn, eloProbs, getEloCached };
