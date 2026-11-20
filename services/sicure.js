/**
 * 🔒 LE PIU' SICURE (20 novembre 2026). Obiettivo: indovinare il piu' possibile. Il backup del 20/11 (2.528 partite chiuse)
 * dice che quante se ne indovinano dipende quasi tutto da QUANTO e' favorito l'esito: sopra il 65% di probabilita' il
 * favorito ha vinto il 79% delle volte, sopra il 75% l'87%. Nessun altro ingrediente (forma, movimento delle quote,
 * pareggi, campionato) ha aggiunto qualcosa a Pinnacle. Quindi: per ogni partita delle prossime 24 ore il pronostico IA
 * con la sua fiducia, e le piu' sicure in cima, con quante ne abbiamo indovinate davvero per fascia (dal nostro database).
 * Sono pronostici, non giocate di valore: le quote sono basse e di solito pagano meno del giusto.
 */
const SELS = ['home', 'draw', 'away'], PICK = { home: '1', draw: 'X', away: '2' };
const TIERS = [{ key: 'top', min: 0.75, label: 'sopra il 75%' }, { key: 'alta', min: 0.65, label: '65–75%' }, { key: 'media', min: 0.55, label: '55–65%' },
  { key: 'bassa', min: 0.45, label: '45–55%' }, { key: 'aperta', min: 0, label: 'sotto il 45%' }];
const SHOW_MIN = 0.65;
const tierOf = p => TIERS.find(t => p >= t.min).key;

function probs(h, d, a) {
  const o = [Number(h), Number(d), Number(a)]; if (!o.every(x => x > 1)) return null;
  const s = o.reduce((x, y) => x + 1 / y, 0); return { home: 1 / o[0] / s, draw: 1 / o[1] / s, away: 1 / o[2] / s };
}
const outOf = sc => { const m = /^(\d+)-(\d+)$/.exec(String(sc || '')); if (!m) return null; return +m[1] > +m[2] ? 'home' : +m[1] === +m[2] ? 'draw' : 'away'; };

/** Parte pura: quante ne indovina il favorito, per fascia di fiducia (ultima quota Pinnacle letta). */
function tierStats(rows) {
  const t = Object.fromEntries(TIERS.map(x => [x.key, { n: 0, hit: 0, expected: 0 }]));
  for (const r of rows) {
    const p = probs(r.pin_h, r.pin_d, r.pin_a), o = outOf(r.result_score); if (!p || !o) continue;
    const sel = SELS.reduce((a, b) => (p[b] > p[a] ? b : a), 'home'), k = tierOf(p[sel]);
    t[k].n++; t[k].hit += sel === o ? 1 : 0; t[k].expected += p[sel];
  }
  return TIERS.map(x => ({ ...x, ...t[x.key], pct: t[x.key].n ? 100 * t[x.key].hit / t[x.key].n : null, expPct: t[x.key].n ? 100 * t[x.key].expected / t[x.key].n : null }));
}

/** Parte pura: le partite in arrivo con il pronostico (IA se c'e', altrimenti Pinnacle) e la fiducia, le piu' sicure prima. */
function upcoming(rows, firstOf, ai = null) {
  const out = [];
  for (const r of rows) {
    const p = probs(r.pin_h, r.pin_d, r.pin_a); if (!p) continue;
    let sel = SELS.reduce((a, b) => (p[b] > p[a] ? b : a), 'home'), prob = p[sel], src = 'pinnacle';
    if (ai) { const a = ai(firstOf.get(r.event_id) || r, r); if (a && a.prob) { sel = { '1': 'home', X: 'draw', '2': 'away' }[a.pick] || sel; prob = a.prob; src = 'ia'; } }
    out.push({ event: r.event_id, league: r.league, home: r.home, away: r.away, at: r.commence_time, pick: PICK[sel], prob, fair: 1 / prob, tier: tierOf(prob), src });
  }
  return out.sort((a, b) => b.prob - a.prob);
}

let cache = null;
async function getSicure(pool, { nowMs = Date.now() } = {}) {
  if (cache && nowMs - cache.at < 10 * 60000) return cache.val;
  const past = (await pool.query(`SELECT pin_h, pin_d, pin_a, result_score FROM goal_watch WHERE pin_h IS NOT NULL AND result_score ~ '^[0-9]+-[0-9]+$'`)).rows;
  const next = (await pool.query(`SELECT event_id, league, home, away, commence_time, pin_h, pin_d, pin_a FROM goal_watch
    WHERE pin_h IS NOT NULL AND commence_time > to_timestamp($1::double precision / 1000) AND commence_time < to_timestamp($1::double precision / 1000) + INTERVAL '24 hours'`, [nowMs])).rows;
  const firstOf = new Map();
  if (next.length) {
    const ids = next.map(r => r.event_id);
    const fr = (await pool.query(`SELECT DISTINCT ON (event_id) event_id, pin_h, pin_d, pin_a FROM pin_history WHERE event_id = ANY($1) ORDER BY event_id, at`, [ids]).catch(() => ({ rows: [] }))).rows;
    for (const f of fr) firstOf.set(f.event_id, f);
  }
  // pronostico IA con i pesi imparati (se pronti; altrimenti Pinnacle, che e' quasi sempre uguale)
  let ai = null;
  try {
    const GS = require('./guess'), C = require('./calib'), ga = GS.peekGuess(pool).ai;
    const cal = await C.getCalRaw(pool, { wait: false }).catch(() => null), E = require('./elo').peekElo(pool), w = { weights: ga.weights, byContext: ga.byContext, own: ga.own };
    ai = (first, last) => GS.aiGuess({ ...first, league: last.league }, last, cal, C.adjust, w, E ? E.of(last.home, last.away) : null);
  } catch (e) { ai = null; }
  const all = upcoming(next, firstOf, ai);
  const val = { tiers: tierStats(past), settled: past.length, showMin: SHOW_MIN, upcoming: all.length, list: all.filter(x => x.prob >= SHOW_MIN).slice(0, 20), updatedAt: new Date(nowMs).toISOString() };
  cache = { at: nowMs, val };
  return val;
}

module.exports = { tierStats, upcoming, getSicure, TIERS, tierOf, probs };
