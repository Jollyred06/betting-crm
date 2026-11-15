/**
 * 🔮 PRONOSTICO DEL CRM (15 novembre 2026, chiesto da Christian: "su ogni partita scrivimi il tuo 1, X o 2, voglio vedere se indovini").
 * E' l'esito piu' probabile secondo Pinnacle senza margine: nei test nessun modello fatto con i dati del CRM e' riuscito a fare meglio.
 * Non e' un consiglio di gioco (la convenienza la dice il vantaggio): serve a vedere quanto si indovina. Si misura da solo,
 * all'indietro su tutte le partite chiuse e "dal vivo" da quando e' acceso, con la prima lettura di ogni partita (niente senno di poi).
 * 🤖 PRONOSTICO IA (stesso giorno): parte dall'ULTIMA lettura di Pinnacle, prolunga a meta' la direzione in cui si e' mosso il mercato
 * dalla prima lettura (i soldi informati spostano le quote verso il risultato) e corregge con la taratura storica (41.000 partite:
 * quanto Pinnacle sbaglia per esito e fascia, ad esempio la casa un po' sottovalutata). All'indietro: 48,4% contro 47,9% di Pinnacle
 * su 622 partite, cioe' 3 in piu': NON e' dimostrato. Si misurano tutti e due fianco a fianco.
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
const SELS = ['home', 'draw', 'away'];
const probsOf = (h, d, a) => { const g = guessOf(h, d, a); return g ? { home: g.probs['1'], draw: g.probs.X, away: g.probs['2'] } : null; };
/** 🤖 IA ADATTIVA (15/11/2026): mescola piu' "esperti" (modi di leggere la partita) e a OGNI risultato sposta la fiducia
 *  verso quelli che hanno sbagliato meno (pesi esponenziali sull'errore logaritmico, eta = 1). Nessuna regola fissa:
 *  se un ingrediente smette di funzionare, il suo peso scende da solo. Parte pura. */
const ETA = 1;
const norm = p => { const s = p.home + p.draw + p.away; return { home: p.home / s, draw: p.draw / s, away: p.away / s }; };
const EXPERTS = {
  primo: { name: 'prima quota di Pinnacle', of: x => x.f },
  ultimo: { name: 'ultima quota di Pinnacle', of: x => x.l },
  slancio: { name: 'direzione del mercato', of: x => norm(Object.fromEntries(SELS.map(k => [k, Math.max(0.01, x.l[k] + (x.l[k] - x.f[k]))]))) },
  storico: { name: 'correzione con lo storico', of: x => (x.cal && x.adjust ? norm(Object.fromEntries(SELS.map(k => [k, Math.max(0.01, x.l[k] + x.adjust(x.cal, null, k, x.l[k]).shift)]))) : x.l) },
  casa: { name: 'vantaggio casa', of: x => norm({ home: x.l.home + 0.02, draw: Math.max(0.01, x.l.draw - 0.012), away: Math.max(0.01, x.l.away - 0.008) }) }
};
const KEYS = Object.keys(EXPERTS);
function weightsOf(loss) { const mn = Math.min(...KEYS.map(k => loss[k])), w = KEYS.map(k => Math.exp(-ETA * (loss[k] - mn))), s = w.reduce((a, b) => a + b, 0); return Object.fromEntries(KEYS.map((k, i) => [k, w[i] / s])); }
function mix(x, weights) { const p = { home: 0, draw: 0, away: 0 }; for (const k of KEYS) { const q = EXPERTS[k].of(x); for (const s of SELS) p[s] += weights[k] * q[s]; } return p; }
/** Pronostico IA per una partita con i pesi attuali. */
function aiGuess(first, last, cal, adjust, weights = null) {
  const f = probsOf(first.pin_h, first.pin_d, first.pin_a), l = (last && probsOf(last.pin_h, last.pin_d, last.pin_a)) || f;
  if (!f) return null;
  const x = { f, l, cal, adjust }, w = weights || Object.fromEntries(KEYS.map(k => [k, 1 / KEYS.length])), p = mix(x, w);
  const sel = SELS.reduce((a, b) => (p[b] > p[a] ? b : a), 'home');
  return { sel, pick: PICK[sel], prob: p[sel], movedPts: 100 * (l[sel] - f[sel]) };
}
/** Impara dai risultati in ordine di tempo: ogni partita e' pronosticata solo con quello che si sapeva prima (onesto). */
function learn(events, cal, adjust) {
  const loss = Object.fromEntries(KEYS.map(k => [k, 0])), out = [];
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    const w = weightsOf(loss), x = { f: e.f, l: e.l, cal, adjust }, p = mix(x, w);
    const sel = SELS.reduce((a, b) => (p[b] > p[a] ? b : a), 'home');
    out.push({ id: e.id, sel, prob: p[sel] });
    for (const k of KEYS) loss[k] += -Math.log(Math.max(1e-6, EXPERTS[k].of(x)[e.out]));
  }
  return { weights: weightsOf(loss), preds: new Map(out.map(o => [o.id, o])), learnedOn: events.length };
}
const outcomeOf = score => { const m = String(score || '').match(/^(\d+)\s*-\s*(\d+)$/); if (!m) return null; const a = +m[1], b = +m[2]; return a > b ? 'home' : a === b ? 'draw' : 'away'; };

/** Riepilogo: una riga per partita (prima lettura), con il risultato. Parte pura. */
function guessStats(rows, { liveSince = LIVE_SINCE, cal = null, adjust = null } = {}) {
  const first = new Map(), last = new Map();
  for (const r of [...rows].sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at))) { if (!first.has(r.event_id)) first.set(r.event_id, r); if (r.pin_h) last.set(r.event_id, r); }
  const score = new Map();   // il risultato puo' arrivare su un'altra riga della stessa partita
  for (const r of rows) if (r.result_score && r.result !== 'void' && !score.has(r.event_id)) score.set(r.event_id, r.result_score);
  const mk = () => ({ n: 0, hit: 0, expected: 0 }), all = mk(), live = mk(), by = { '1': mk(), X: mk(), '2': mk() }, aiAll = mk(), aiLive = mk();
  let differ = 0, differAi = 0, differPin = 0;
  const recent = [], evs = [];
  for (const [ev, r] of first) {
    const f = probsOf(r.pin_h, r.pin_d, r.pin_a), lr = last.get(ev), l = (lr && probsOf(lr.pin_h, lr.pin_d, lr.pin_a)) || f, out = outcomeOf(score.get(ev));
    if (f && out) evs.push({ id: ev, t: Date.parse(r.commence_time), f, l, out });
  }
  const model = learn(evs, cal, adjust);
  for (const [ev, r] of first) {
    const g = guessOf(r.pin_h, r.pin_d, r.pin_a), out = outcomeOf(score.get(ev));
    if (!g || !out) continue;
    const hit = out === g.sel ? 1 : 0, isLive = Date.parse(r.created_at) >= Date.parse(liveSince);
    for (const t of [all, by[g.pick], ...(isLive ? [live] : [])]) { t.n++; t.hit += hit; t.expected += g.prob; }
    const ai = model.preds.get(ev) || null, aiHit = ai && out === ai.sel ? 1 : 0;
    if (ai) { for (const t of [aiAll, ...(isLive ? [aiLive] : [])]) { t.n++; t.hit += aiHit; t.expected += ai.prob; }
      if (ai.sel !== g.sel) { differ++; differAi += aiHit; differPin += hit; } }
    recent.push({ home: r.home, away: r.away, at: r.commence_time, pick: g.pick, prob: g.prob, ai: ai ? ai.pick : null, aiHit: !!aiHit, score: score.get(ev), hit: !!hit });
  }
  const fin = t => ({ ...t, pct: t.n ? 100 * t.hit / t.n : null, expPct: t.n ? 100 * t.expected / t.n : null });
  recent.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  return { liveSince, all: fin(all), live: fin(live), ai: { all: fin(aiAll), live: fin(aiLive), differ, differAi, differPin, weights: model.weights, learnedOn: model.learnedOn, names: Object.fromEntries(KEYS.map(k => [k, EXPERTS[k].name])) }, byPick: { '1': fin(by['1']), X: fin(by.X), '2': fin(by['2']) }, recent: recent.slice(0, 10) };
}

let cacheG = null;
/** Statistiche e pesi attuali (in memoria 10 minuti): servono anche ai pronostici delle partite aperte. */
async function getGuessCached(pool, { nowMs = Date.now() } = {}) {
  if (cacheG && nowMs - cacheG.at < 10 * 60000) return cacheG.val;
  const val = await getGuess(pool); cacheG = { at: nowMs, val }; return val;
}
async function getGuess(pool) {
  const rows = (await pool.query(`SELECT event_id, created_at, commence_time, home, away, pin_h, pin_d, pin_a, result, result_score FROM italia_signals WHERE strategy = 'I'`)).rows;
  const C = require('./calib'); let cal = null; try { cal = await C.getCalRaw(pool); } catch (e) { /* senza storico: solo movimento */ }
  return guessStats(rows, { cal, adjust: C.adjust });
}

module.exports = { getGuessCached, learn, weightsOf, EXPERTS, aiGuess, LIVE_SINCE, guessOf, outcomeOf, guessStats, getGuess };
