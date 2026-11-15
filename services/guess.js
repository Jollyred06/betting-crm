/**
 * 🔮 PRONOSTICO DEL CRM (15 novembre 2026, chiesto da Christian: "su ogni partita scrivimi il tuo 1, X o 2, voglio vedere se indovini").
 * E' l'esito piu' probabile secondo Pinnacle senza margine: nei test nessun modello fatto con i dati del CRM e' riuscito a fare meglio.
 * Non e' un consiglio di gioco (la convenienza la dice il vantaggio): serve a vedere quanto si indovina. Si misura da solo,
 * all'indietro su tutte le partite chiuse e "dal vivo" da quando e' acceso, con la prima lettura di ogni partita (niente senno di poi).
 */
const { noVigPower } = require('./sharpSignals');
const LIVE_SINCE = '2026-11-15T16:10:00Z';
const PICK = { home: '1', draw: 'X', away: '2' };

/** Pronostico da quote Pinnacle 1X2. Parte pura. */
function guessOf(h, d, a) {
  h = Number(h); d = Number(d); a = Number(a);
  if (!(h > 1 && d > 1 && a > 1)) return null;
  const p = noVigPower({ home: h, draw: d, away: a });
  const sel = ['home', 'draw', 'away'].sort((x, y) => p[y] - p[x])[0];
  return { sel, pick: PICK[sel], prob: p[sel], probs: { '1': p.home, X: p.draw, '2': p.away } };
}
const outcomeOf = score => { const m = String(score || '').match(/^(\d+)\s*-\s*(\d+)$/); if (!m) return null; const a = +m[1], b = +m[2]; return a > b ? 'home' : a === b ? 'draw' : 'away'; };

/** Riepilogo: una riga per partita (prima lettura), con il risultato. Parte pura. */
function guessStats(rows, { liveSince = LIVE_SINCE } = {}) {
  const first = new Map();
  for (const r of [...rows].sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at))) if (!first.has(r.event_id)) first.set(r.event_id, r);
  const score = new Map();   // il risultato puo' arrivare su un'altra riga della stessa partita
  for (const r of rows) if (r.result_score && r.result !== 'void' && !score.has(r.event_id)) score.set(r.event_id, r.result_score);
  const mk = () => ({ n: 0, hit: 0, expected: 0 }), all = mk(), live = mk(), by = { '1': mk(), X: mk(), '2': mk() };
  const recent = [];
  for (const [ev, r] of first) {
    const g = guessOf(r.pin_h, r.pin_d, r.pin_a), out = outcomeOf(score.get(ev));
    if (!g || !out) continue;
    const hit = out === g.sel ? 1 : 0;
    for (const t of [all, by[g.pick], ...(Date.parse(r.created_at) >= Date.parse(liveSince) ? [live] : [])]) { t.n++; t.hit += hit; t.expected += g.prob; }
    recent.push({ home: r.home, away: r.away, at: r.commence_time, pick: g.pick, prob: g.prob, score: score.get(ev), hit: !!hit });
  }
  const fin = t => ({ ...t, pct: t.n ? 100 * t.hit / t.n : null, expPct: t.n ? 100 * t.expected / t.n : null });
  recent.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  return { liveSince, all: fin(all), live: fin(live), byPick: { '1': fin(by['1']), X: fin(by.X), '2': fin(by['2']) }, recent: recent.slice(0, 10) };
}

async function getGuess(pool) {
  const rows = (await pool.query(`SELECT event_id, created_at, commence_time, home, away, pin_h, pin_d, pin_a, result, result_score FROM italia_signals WHERE strategy = 'I'`)).rows;
  return guessStats(rows);
}

module.exports = { LIVE_SINCE, guessOf, outcomeOf, guessStats, getGuess };
