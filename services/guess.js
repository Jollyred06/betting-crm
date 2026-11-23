
/**
 * 🔮 PRONOSTICO DEL CRM (15 novembre 2026, chiesto da Christian: "su ogni partita scrivimi il tuo 1, X o 2, voglio vedere se indovini").
 * E' l'esito piu' probabile secondo Pinnacle senza margine: nei test nessun modello fatto con i dati del CRM e' riuscito a fare meglio.
 * Non e' un consiglio di gioco (la convenienza la dice il vantaggio): serve a vedere quanto si indovina. Si misura da solo,
 * all'indietro su tutte le partite chiuse e "dal vivo" da quando e' acceso, con la prima lettura di ogni partita (niente senno di poi).
 * 🤖 PRONOSTICO IA (stesso giorno): parte dall'ULTIMA lettura di Pinnacle, prolunga a meta' la direzione in cui si e' mosso il mercato
 * dalla prima lettura (i soldi informati spostano le quote verso il risultato) e corregge con la taratura storica (41.000 partite:
 * quanto Pinnacle sbaglia per esito e fascia, ad esempio la casa un po' sottovalutata). All'indietro: 48,4% contro 47,9% di Pinnacle
 * su 622 partite, cioe' 3 in piu': NON e' dimostrato. Si misurano tutti e due fianco a fianco.
 * 💪 Dal 15/11 sera c'e' anche la forza delle squadre (Elo dallo storico, services/elo.js) come sesto esperto.
 */
const SURE = 0.6;   // soglia delle "IA sicure" (sui dati: favorite sopra il 60% indovinate circa 3 volte su 4, quota media 1,35)
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
/** 🏠 TARATURA DAL NOSTRO DATABASE (18/11/2026): le partite viste dal CRM (goal_watch: quota Pinnacle e risultato), quasi tutte
 *  di campionati minori che lo storico non copre. Per gruppo (maggiori/minori), esito e fascia: quanto Pinnacle sbaglia.
 *  Nell'apprendimento si riempie in ordine di tempo (solo partite finite prima di quella da pronosticare: niente senno di poi). */
const OWN_BANDS = [0, 0.15, 0.25, 0.35, 0.5, 0.65, 1.0001], OWN_K = 200;
const ownBand = p => { for (let i = 0; i < OWN_BANDS.length - 1; i++) if (p >= OWN_BANDS[i] && p < OWN_BANDS[i + 1]) return i; return null; };
const marginOf = r => { const h = Number(r.pin_h), d = Number(r.pin_d), a = Number(r.pin_a); return h > 1 && d > 1 && a > 1 ? (1 / h + 1 / d + 1 / a - 1) * 100 : null; };
const ownGroup = r => { const m = marginOf(r); return m === null ? null : m < 6 ? 'maggiori' : 'minori'; };
function ownNew() { const mk = () => SELS.map(() => OWN_BANDS.slice(1).map(() => ({ n: 0, exp: 0, obs: 0 }))); return { maggiori: mk(), minori: mk(), n: 0 }; }
function ownAdd(own, r) {
  const g = ownGroup(r), p = probsOf(r.pin_h, r.pin_d, r.pin_a), m = /^(\d+)-(\d+)$/.exec(String(r.result_score || ''));
  if (!g || !p || !m) return;
  const out = +m[1] > +m[2] ? 'home' : +m[1] === +m[2] ? 'draw' : 'away';
  SELS.forEach((k, i) => { const b = ownBand(p[k]); if (b === null) return; const c = own[g][i][b]; c.n++; c.exp += p[k]; c.obs += out === k ? 1 : 0; });
  own.n++;
}
function ownShift(own, g, k, p) { if (!own || !g) return 0; const b = ownBand(p); if (b === null) return 0; const c = own[g][SELS.indexOf(k)][b]; return c.n ? ((c.obs - c.exp) / c.n) * (c.n / (c.n + OWN_K)) : 0; }
function ownBuild(rows) { const own = ownNew(); for (const r of rows) ownAdd(own, r); return own; }
const norm = p => { const s = p.home + p.draw + p.away; return { home: p.home / s, draw: p.draw / s, away: p.away / s }; };
const EXPERTS = {
  primo: { name: 'prima quota di Pinnacle', of: x => x.f },
  ultimo: { name: 'ultima quota di Pinnacle', of: x => x.l },
  slancio: { name: 'direzione del mercato', of: x => norm(Object.fromEntries(SELS.map(k => [k, Math.max(0.01, x.l[k] + (x.l[k] - x.f[k]))]))) },
  storico: { name: 'correzione con lo storico', of: x => (x.cal && x.adjust ? norm(Object.fromEntries(SELS.map(k => [k, Math.max(0.01, x.l[k] + x.adjust(x.cal, null, k, x.l[k]).shift)]))) : x.l) },
  forza: { name: 'forza delle squadre (Elo dallo storico)', of: x => x.elo || x.l },
  nostro: { name: 'taratura dal nostro database (campionati minori)', of: x => (x.own ? norm(Object.fromEntries(SELS.map(k => [k, Math.max(0.01, x.l[k] + ownShift(x.own, x.grp, k, x.l[k]))]))) : x.l) },
  casa: { name: 'vantaggio casa', of: x => norm({ home: x.l.home + 0.02, draw: Math.max(0.01, x.l.draw - 0.012), away: Math.max(0.01, x.l.away - 0.008) }) }
};
const KEYS = Object.keys(EXPERTS);
// 20/11/2026: quota fissa del 10% divisa tra tutti (fixed share): nessun esperto sparisce del tutto, cosi' se uno smette di
// funzionare (o un altro comincia) l'IA se ne accorge in fretta. Sul backup: stessa precisione, pesi meno estremi.
const SHARE = 0.1;
function weightsOf(loss) { const mn = Math.min(...KEYS.map(k => loss[k])), w = KEYS.map(k => Math.exp(-ETA * (loss[k] - mn))), s = w.reduce((a, b) => a + b, 0); return Object.fromEntries(KEYS.map((k, i) => [k, (1 - SHARE) * w[i] / s + SHARE / KEYS.length])); }
function mix(x, weights) { const p = { home: 0, draw: 0, away: 0 }; for (const k of KEYS) { const q = EXPERTS[k].of(x); for (const s of SELS) p[s] += weights[k] * q[s]; } return p; }
/** Pronostico IA per una partita con i pesi attuali. */
function aiGuess(first, last, cal, adjust, weights = null, elo = null) {
  const f = probsOf(first.pin_h, first.pin_d, first.pin_a), l = (last && probsOf(last.pin_h, last.pin_d, last.pin_a)) || f;
  if (!f) return null;
  const own = weights && weights.own ? weights.own : null;
  if (weights && weights.byContext) { const c = contextOf(first); weights = (c && weights.byContext[c] && weights.byContext[c].weights) || weights.weights; }
  const x = { f, l, cal, adjust, elo, own, grp: ownGroup(first) }, w = weights || Object.fromEntries(KEYS.map(k => [k, 1 / KEYS.length])), p = mix(x, w);
  const sel = SELS.reduce((a, b) => (p[b] > p[a] ? b : a), 'home');
  return { sel, pick: PICK[sel], prob: p[sel], movedPts: 100 * (l[sel] - f[sel]) };
}
/** Tipo di partita (punto 2, 15/11/2026): l'IA impara anche separatamente per tipo, perche' un ingrediente puo' funzionare
 *  nei campionati maggiori e non in quelli minori, o con le favorite e non nelle partite equilibrate. */
const CONTEXTS = { 'maggiori-favorita': 'campionati maggiori, con favorita', 'maggiori-equilibrata': 'campionati maggiori, equilibrata',
  'minori-favorita': 'campionati minori, con favorita', 'minori-equilibrata': 'campionati minori, equilibrata' };
function contextOf(first) {
  const h = Number(first.pin_h), d = Number(first.pin_d), a = Number(first.pin_a);
  if (!(h > 1 && d > 1 && a > 1)) return null;
  const margin = (1 / h + 1 / d + 1 / a - 1) * 100, p = probsOf(h, d, a), fav = Math.max(p.home, p.away) >= 0.5;
  return (margin < 6 ? 'maggiori' : 'minori') + '-' + (fav ? 'favorita' : 'equilibrata');
}
/** Pesi per una partita: errori di tutte le partite + errori delle partite dello stesso tipo (che quindi contano doppio). */
function ctxWeights(loss, ctxLoss, ctx) { const c = ctx && ctxLoss[ctx]; return weightsOf(Object.fromEntries(KEYS.map(k => [k, loss[k] + (c ? c[k] : 0)]))); }
/** Impara dai risultati in ordine di tempo: ogni partita e' pronosticata solo con quello che si sapeva prima (onesto). */
function learn(events, cal, adjust, ownRows = []) {
  const zero = () => Object.fromEntries(KEYS.map(k => [k, 0]));
  const loss = zero(), ctxLoss = {}, ctxN = {}, out = [];
  const own = ownNew(), src = [...ownRows].map(r => ({ r, t: Date.parse(r.commence_time) })).filter(o => Number.isFinite(o.t)).sort((a, b) => a.t - b.t);
  let j = 0;
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    while (j < src.length && src[j].t < e.t - 3 * 3600000) ownAdd(own, src[j++].r);   // solo partite gia' finite
    const w = ctxWeights(loss, ctxLoss, e.ctx), x = { f: e.f, l: e.l, cal, adjust, elo: e.elo || null, own, grp: e.grp || null }, p = mix(x, w);
    const sel = SELS.reduce((a, b) => (p[b] > p[a] ? b : a), 'home');
    out.push({ id: e.id, sel, pick: PICK[sel], prob: p[sel] });
    if (e.ctx && !ctxLoss[e.ctx]) { ctxLoss[e.ctx] = zero(); ctxN[e.ctx] = 0; }
    for (const k of KEYS) { const l = -Math.log(Math.max(1e-6, EXPERTS[k].of(x)[e.out])); loss[k] += l; if (e.ctx) ctxLoss[e.ctx][k] += l; }
    if (e.ctx) ctxN[e.ctx]++;
  }
  const byContext = Object.fromEntries(Object.keys(ctxLoss).map(c => [c, { n: ctxN[c], weights: ctxWeights(loss, ctxLoss, c) }]));
  while (j < src.length) ownAdd(own, src[j++].r);
  return { own, weights: weightsOf(loss), ctxLoss, byContext, preds: new Map(out.map(o => [o.id, o])), learnedOn: events.length, withElo: events.filter(e => e.elo).length };
}
const outcomeOf = score => { const m = String(score || '').match(/^(\d+)\s*-\s*(\d+)$/); if (!m) return null; const a = +m[1], b = +m[2]; return a > b ? 'home' : a === b ? 'draw' : 'away'; };

/** Riepilogo: una riga per partita (prima lettura), con il risultato. Parte pura. */
const weekOf = t => { const d = new Date(t); const day = (d.getUTCDay() + 6) % 7; d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); };
/** 📈 Settimana per settimana (20/11/2026): quante ne indovina l'IA e quante l'ultima quota di Pinnacle, per vedere se impara. */
function weeklyOf(evs, preds) {
  const W = new Map();
  for (const e of evs) { const a = preds.get(e.id); if (!a) continue; const k = weekOf(e.t); if (!W.has(k)) W.set(k, { week: k, n: 0, ai: 0, pin: 0 }); const w = W.get(k);
    const pinSel = SELS.reduce((x, y) => (e.l[y] > e.l[x] ? y : x), 'home'); w.n++; w.ai += a.sel === e.out ? 1 : 0; w.pin += pinSel === e.out ? 1 : 0; }
  return [...W.values()].sort((a, b) => a.week.localeCompare(b.week));
}
/** extraRows (20/11/2026): tutte le altre partite chiuse viste dal CRM (goal_watch, ~125 al giorno), con la prima quota letta
 *  (f_h/f_d/f_a da pin_history) se c'e'. Servono solo a IMPARARE: l'IA impara da 4-5 volte piu' risultati. I conteggi
 *  "IA contro Pinnacle" restano sulle partite di sempre, per confrontarli con i giorni prima. */
function guessStats(rows, { liveSince = LIVE_SINCE, cal = null, adjust = null, eloOf = null, ownRows = [], extraRows = [] } = {}) {
  const first = new Map(), last = new Map();
  for (const r of [...rows].sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at))) { if (!first.has(r.event_id)) first.set(r.event_id, r); if (r.pin_h) last.set(r.event_id, r); }
  const score = new Map();   // il risultato puo' arrivare su un'altra riga della stessa partita
  for (const r of rows) if (r.result_score && r.result !== 'void' && !score.has(r.event_id)) score.set(r.event_id, r.result_score);
  const mk = () => ({ n: 0, hit: 0, expected: 0 }), all = mk(), live = mk(), by = { '1': mk(), X: mk(), '2': mk() }, aiAll = mk(), aiLive = mk();
  let differ = 0, differAi = 0, differPin = 0;
  const recent = [], evs = [];
  for (const [ev, r] of first) {
    const f = probsOf(r.pin_h, r.pin_d, r.pin_a), lr = last.get(ev), l = (lr && probsOf(lr.pin_h, lr.pin_d, lr.pin_a)) || f, out = outcomeOf(score.get(ev));
    if (f && out) evs.push({ id: ev, t: Date.parse(r.commence_time), f, l, out, ctx: contextOf(r), grp: ownGroup(r), elo: eloOf ? eloOf(r.home, r.away) : null });
  }
  const known = new Set(evs.map(e => e.id));
  const noise = require('./italia').isNoise;
  for (const r of extraRows) {
    if (known.has(r.event_id) || noise(r)) continue;   // 21/11: giovanili, femminili, riserve, amichevoli: fuori
    const l = probsOf(r.pin_h, r.pin_d, r.pin_a), f = probsOf(r.f_h, r.f_d, r.f_a) || l, out = outcomeOf(r.result_score);
    if (l && out) { known.add(r.event_id); evs.push({ id: r.event_id, t: Date.parse(r.commence_time), f, l, out, ctx: contextOf(r), grp: ownGroup(r), elo: eloOf ? eloOf(r.home, r.away) : null, extra: true }); }
  }
  const model = learn(evs, cal, adjust, ownRows);
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
  // 22/11: anche su TUTTE le partite viste (prima squadra), non solo quelle con segnale (le piu' equilibrate): ultima quota letta
  const seenPin = mk(), seenAi = mk(), sureAi = mk();   // 24/11: "IA sicure" = l'IA da' all'esito almeno il 60% (favorita netta)
  for (const e of evs) {
    const ps = SELS.reduce((x, y) => (e.l[y] > e.l[x] ? y : x), 'home'); seenPin.n++; seenPin.hit += ps === e.out ? 1 : 0; seenPin.expected += e.l[ps];
    const a = model.preds.get(e.id); if (a) { seenAi.n++; seenAi.hit += a.sel === e.out ? 1 : 0; seenAi.expected += a.prob;  if (a.prob >= SURE) { sureAi.n++; sureAi.hit += a.sel === e.out ? 1 : 0; sureAi.expected += a.prob; } }
  }
  const fin = t => ({ ...t, pct: t.n ? 100 * t.hit / t.n : null, expPct: t.n ? 100 * t.expected / t.n : null });
  recent.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
  return { liveSince, all: fin(all), live: fin(live), ai: { all: fin(aiAll), live: fin(aiLive), differ, differAi, differPin, weights: model.weights, own: model.own, ownN: model.own.n, byContext: model.byContext, ctxLoss: model.ctxLoss, contexts: CONTEXTS, learnedOn: model.learnedOn, withCal: !!cal, extra: evs.filter(e => e.extra).length, weekly: weeklyOf(evs, model.preds), seen: fin(seenAi), sure: fin(sureAi), sureMin: SURE, withElo: model.withElo, names: Object.fromEntries(KEYS.map(k => [k, EXPERTS[k].name])) }, byPick: { '1': fin(by['1']), X: fin(by.X), '2': fin(by['2']) }, seen: fin(seenPin), recent: recent.slice(0, 10) };
}

let cacheG = null;
/** Statistiche e pesi attuali (in memoria 10 minuti): servono anche ai pronostici delle partite aperte. */
async function getGuessCached(pool, { nowMs = Date.now() } = {}) {
  if (cacheG && nowMs - cacheG.at < (cacheG.full ? 10 : 1) * 60000) return cacheG.val;
  const val = await getGuess(pool); cacheG = { at: nowMs, val, full: !!(val && val.ai && val.ai.withElo && val.ai.withCal) }; return val;
}
/** Senza aspettare (20/11/2026): l'ultimo calcolo pronto; se non c'e' o e' vecchio, lo rifa' in sottofondo. Per /italia e le sicure. */
let pendingG = null;
function peekGuess(pool, { nowMs = Date.now() } = {}) {
  const stale = !cacheG || nowMs - cacheG.at >= (cacheG.full ? 10 : 1) * 60000;
  if (stale && !pendingG) pendingG = getGuessCached(pool, { nowMs }).catch(() => null).finally(() => { pendingG = null; });
  return cacheG ? cacheG.val : null;
}
async function getGuess(pool) {
  const rows = (await require('./sigstore').rows(pool, { strategy: 'I' }));
  // 16/11/2026: non aspetta i calcoli pesanti; se non sono ancora pronti si va avanti senza (e si preparano in sottofondo)
  // 20/11/2026: dopo un riavvio storico ed Elo non erano ancora pronti e l'IA imparava senza (forza nota per 0): ora li aspetta
  // fino a 20 secondi (sono salvati nel database, di solito bastano pochi secondi); se non arrivano, va avanti e riprova fra 1 minuto
  const within = (pr, ms) => Promise.race([pr, new Promise(r => setTimeout(() => r(null), ms))]);
  const C = require('./calib'); let cal = null; try { cal = await within(C.getCalRaw(pool, { wait: true }), 20000); } catch (e) { /* senza storico: solo movimento */ }
  let eloOf = null; try { const E = await within(require('./elo').getEloCached(pool), 20000); eloOf = E ? E.of : null; } catch (e) { /* senza storico */ }
  // 22/11: dalla copia in memoria di goal_watch e delle prime quote (prima: 6.000 righe + la prima quota di ognuna a ogni calcolo)
  let ownRows = []; try {
    const SS = require('./sigstore'), w = (await SS.watch.all(pool)).filter(g => g.pin_h !== null && g.pin_h !== undefined && /^[0-9]+-[0-9]+$/.test(g.result_score || ''));
    const fp = await SS.firstPinOf(pool, w.map(g => g.event_id));
    ownRows = w.map(g => { const f = fp.get(g.event_id) || {}; return { event_id: g.event_id, league: g.league, home: g.home, away: g.away, commence_time: g.commence_time, pin_h: g.pin_h, pin_d: g.pin_d, pin_a: g.pin_a, result_score: g.result_score, f_h: f.pin_h ?? null, f_d: f.pin_d ?? null, f_a: f.pin_a ?? null }; });
  } catch (e) { /* facoltativo */ }
  return guessStats(rows, { cal, adjust: C.adjust, eloOf, ownRows, extraRows: ownRows });
}

module.exports = { peekGuess, weeklyOf, weekOf, ownBuild, ownShift, ownGroup, contextOf, CONTEXTS, getGuessCached, learn, weightsOf, EXPERTS, aiGuess, LIVE_SINCE, guessOf, outcomeOf, guessStats, getGuess };
