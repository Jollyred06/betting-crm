// 🔮 Pronostico: esito piu' probabile, conteggio indovinati con la prima lettura. Senza rete e senza database.
const assert = require('assert'), G = require('../services/guess');
assert.strictEqual(G.guessOf(1.8, 3.6, 4.5).pick, '1');
assert.strictEqual(G.guessOf(4.2, 3.5, 1.9).pick, '2');
assert.strictEqual(G.guessOf(null, 3, 3), null);
const g = G.guessOf(1.8, 3.6, 4.5); assert.ok(g.prob > 0.5 && g.prob < 0.56 && Math.abs(g.probs['1'] + g.probs.X + g.probs['2'] - 1) < 1e-9);
assert.strictEqual(G.outcomeOf('2-1'), 'home'); assert.strictEqual(G.outcomeOf('1-1'), 'draw'); assert.strictEqual(G.outcomeOf('0-3'), 'away'); assert.strictEqual(G.outcomeOf(''), null);
const rows = [
  // partita 1: prima lettura dice 1, poi le quote cambiano (non conta); finita 2-0: indovinato
  { event_id: 'a', created_at: '2026-11-10T10:00:00Z', commence_time: '2026-11-10T18:00:00Z', home: 'A', away: 'B', pin_h: 1.8, pin_d: 3.6, pin_a: 4.5, result_score: null },
  { event_id: 'a', created_at: '2026-11-10T15:00:00Z', commence_time: '2026-11-10T18:00:00Z', home: 'A', away: 'B', pin_h: 4.5, pin_d: 3.6, pin_a: 1.8, result: 'won', result_score: '2-0' },
  // partita 2: dice 2, finita 1-1: sbagliato; letta dopo l'accensione: conta anche dal vivo
  { event_id: 'b', created_at: '2026-11-16T10:00:00Z', commence_time: '2026-11-16T18:00:00Z', home: 'C', away: 'D', pin_h: 4.2, pin_d: 3.5, pin_a: 1.9, result: 'lost', result_score: '1-1' },
  // partita 3: annullata: non conta
  { event_id: 'c', created_at: '2026-11-16T10:00:00Z', commence_time: '2026-11-16T18:00:00Z', home: 'E', away: 'F', pin_h: 2, pin_d: 3.4, pin_a: 3.9, result: 'void', result_score: '0-0' }];
const s = G.guessStats(rows);
assert.strictEqual(s.all.n, 2); assert.strictEqual(s.all.hit, 1);
assert.strictEqual(s.live.n, 1); assert.strictEqual(s.live.hit, 0);
assert.strictEqual(s.byPick['1'].hit, 1); assert.strictEqual(s.byPick['2'].n, 1);
assert.strictEqual(s.recent[0].home, 'C');
console.log('pronostico: ok');
// IA adattiva: impara dai risultati e sposta i pesi verso chi sbaglia meno
{
  const first = { pin_h: 2.6, pin_d: 3.3, pin_a: 2.8 }, last = { pin_h: 2.9, pin_d: 3.3, pin_a: 2.5 };
  assert.ok(G.aiGuess(first, last, null, null), 'pronostico anche senza pesi');
  assert.strictEqual(G.aiGuess({ pin_h: null }, null, null, null), null);
  // 40 partite in cui il mercato si muove verso la trasferta e vince la trasferta: lo "slancio" deve guadagnare fiducia
  const pr = (h, d, a) => { const g = G.guessOf(h, d, a); return { home: g.probs['1'], draw: g.probs.X, away: g.probs['2'] }; };
  const evs = Array.from({ length: 40 }, (_, i) => ({ id: 'e' + i, t: i, f: pr(2.6, 3.3, 2.8), l: pr(2.9, 3.3, 2.5), out: 'away' }));
  const m = G.learn(evs, null, null);
  assert.ok(m.weights.slancio > m.weights.primo, 'piu fiducia alla direzione del mercato');
  assert.strictEqual(m.preds.get('e0').sel !== undefined, true); assert.strictEqual(m.learnedOn, 40);
  assert.ok(Math.abs(Object.values(m.weights).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.strictEqual(G.aiGuess(first, last, null, null, m.weights).pick, '2', 'con i pesi imparati dice 2');
  const s2 = G.guessStats([{ event_id: 'z', created_at: '2026-11-16T10:00:00Z', commence_time: '2026-11-16T18:00:00Z', home: 'X', away: 'Y', ...first },
    { event_id: 'z', created_at: '2026-11-16T15:00:00Z', commence_time: '2026-11-16T18:00:00Z', home: 'X', away: 'Y', ...last, result: 'won', result_score: '0-1' }]);
  assert.strictEqual(s2.ai.all.n, 1); assert.ok(s2.ai.weights && s2.ai.names.slancio);
  console.log('IA adattiva: ok');
}
// punto 2: pesi per tipo di partita
{
  assert.strictEqual(G.contextOf({ pin_h: 1.5, pin_d: 4.2, pin_a: 7 }), 'maggiori-favorita');
  assert.strictEqual(G.contextOf({ pin_h: 2.5, pin_d: 3.1, pin_a: 2.8 }), 'minori-equilibrata');
  assert.strictEqual(G.contextOf({ pin_h: null }), null);
  const pq = (h, d, a) => { const g = G.guessOf(h, d, a); return { home: g.probs['1'], draw: g.probs.X, away: g.probs['2'] }; };
  // nelle equilibrate lo slancio indovina, nelle favorite no
  const evs = [];
  for (let i = 0; i < 40; i++) evs.push({ id: 'q' + i, t: i, ctx: 'minori-equilibrata', f: pq(2.6, 3.3, 2.8), l: pq(2.9, 3.3, 2.5), out: 'away' });
  for (let i = 0; i < 40; i++) evs.push({ id: 'w' + i, t: 100 + i, ctx: 'maggiori-favorita', f: pq(1.6, 4, 6), l: pq(1.7, 3.9, 5.2), out: 'home' });
  const L = G.learn(evs, null, null);
  assert.ok(L.byContext['minori-equilibrata'].weights.slancio > L.byContext['maggiori-favorita'].weights.slancio, 'lo slancio conta di piu nelle equilibrate');
  const w = { weights: L.weights, byContext: L.byContext };
  assert.strictEqual(G.aiGuess({ pin_h: 2.6, pin_d: 3.3, pin_a: 2.8 }, { pin_h: 2.9, pin_d: 3.3, pin_a: 2.5 }, null, null, w).pick, '2');
  console.log('IA per tipo di partita: ok');
}
// 18/11/2026: nella lista "Ultime" il pronostico IA deve comparire (prima risultava vuoto e si vedeva quello di Pinnacle)
{
  const r = G.guessStats([{ event_id: 'q', created_at: '2026-11-16T10:00:00Z', commence_time: '2026-11-16T18:00:00Z', home: 'A', away: 'B', pin_h: 2.0, pin_d: 3.4, pin_a: 3.9, result: 'won', result_score: '1-0' }]);
  assert.ok(['1', 'X', '2'].includes(r.recent[0].ai), 'pronostico IA presente nelle ultime');
  console.log('pronostico IA nelle ultime: ok');
}
// 18/11/2026: taratura dal nostro database (campionati minori), senza senno di poi
{
  // 300 partite nei minori in cui la casa al ~55% vince solo il 40%: l'esperto "nostro" deve abbassare la casa
  const rows = Array.from({ length: 300 }, (_, i) => ({ commence_time: new Date(Date.parse('2026-10-01') + i * 3600000).toISOString(), pin_h: 1.7, pin_d: 3.5, pin_a: 4.6, result_score: i % 10 < 4 ? '1-0' : i % 10 < 7 ? '1-1' : '0-1' }));
  assert.strictEqual(G.ownGroup(rows[0]), 'minori');
  const own = G.ownBuild(rows);
  assert.ok(G.ownShift(own, 'minori', 'home', 0.55) < -0.05, 'casa sopravvalutata: si abbassa');
  assert.strictEqual(G.ownShift(own, 'maggiori', 'home', 0.55), 0, 'nei maggiori nessun dato: nessuna correzione');
  // apprendimento: la taratura usa solo le partite finite prima
  const pq = (h, d, a) => { const g = G.guessOf(h, d, a); return { home: g.probs['1'], draw: g.probs.X, away: g.probs['2'] }; };
  const evs = Array.from({ length: 60 }, (_, i) => ({ id: 'm' + i, t: Date.parse('2026-11-01') + i * 3600000, grp: 'minori', f: pq(1.7, 3.5, 4.6), l: pq(1.7, 3.5, 4.6), out: i % 10 < 4 ? 'home' : i % 10 < 7 ? 'draw' : 'away' }));
  const L = G.learn(evs, null, null, rows);
  assert.ok(L.weights.nostro > L.weights.primo, 'la taratura nostra prende fiducia'); assert.strictEqual(L.own.n, 300);
  const early = G.learn([{ ...evs[0], t: Date.parse('2026-09-01') }], null, null, rows); assert.strictEqual(early.own.n, 300, 'alla fine tutte'); 
  console.log('taratura dal nostro database: ok');
}
// 20/11: impara anche dalle altre partite (extraRows) e mostra il percorso settimana per settimana
{
  const GS = require('../services/guess');
  const base = [{ event_id: 'i1', created_at: '2026-11-16T10:00:00Z', commence_time: '2026-11-16T15:00:00Z', home: 'A', away: 'B', pin_h: 2, pin_d: 3.4, pin_a: 3.8, result_score: '1-0' }];
  const extra = []; for (let i = 0; i < 30; i++) extra.push({ event_id: 'g' + i, commence_time: new Date(Date.parse('2026-11-02T15:00:00Z') + i * 86400000 / 3).toISOString(), home: 'H' + i, away: 'A' + i, pin_h: 2.2, pin_d: 3.3, pin_a: 3.4, result_score: i % 2 ? '1-0' : '0-0' });
  extra.push({ event_id: 'i1', commence_time: '2026-11-16T15:00:00Z', pin_h: 2, pin_d: 3.4, pin_a: 3.8, result_score: '1-0' });
  const a = GS.guessStats(base, { extraRows: extra });
  assert.strictEqual(a.ai.learnedOn, 31); assert.strictEqual(a.ai.extra, 30);
  assert.strictEqual(a.all.n, 1, 'i conteggi IA contro Pinnacle restano sulle partite di sempre');
  assert.ok(a.ai.weekly.length >= 2 && a.ai.weekly.reduce((s, w) => s + w.n, 0) === 31);
  assert.strictEqual(GS.weekOf('2026-11-20T10:00:00Z'), '2026-11-16');
  console.log('impara da tutte le partite: ok');
}
