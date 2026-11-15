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
