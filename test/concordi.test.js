'use strict';
const assert = require('assert');
const C = require('../services/concordi');
const now = Date.parse('2026-11-26T10:00:00Z'), ko = '2026-11-26T18:00:00Z';
const r = (o = {}) => ({ id: 1, event_id: 'e1', selection: 'home', pick: '1', commence_time: ko, edge_pct: 3, win_prob: 0.5, play: { book: 'Snai', odd: 2.1 }, guess: { pick: '1', prob: 0.5, ai: { pick: '1', prob: 0.48 } }, ...o });
assert.strictEqual(C.pickConcordi([r()], now).length, 1, 'giocata = Pinnacle = IA, quota 2,10');
assert.strictEqual(C.pickConcordi([r({ guess: { pick: '1', prob: 0.5, ai: { pick: '2', prob: 0.4 } } })], now).length, 0, "l'IA non e' d'accordo");
assert.strictEqual(C.pickConcordi([r({ guess: { pick: '2', prob: 0.5, ai: { pick: '1', prob: 0.4 } } })], now).length, 0, 'Pinnacle non e\' d\'accordo');
assert.strictEqual(C.pickConcordi([r({ play: { book: 'Snai', odd: 1.5 } })], now).length, 0, 'sotto quota 1,60');
assert.strictEqual(C.pickConcordi([r({ edge_pct: -1 })], now).length, 0, 'senza valore');
assert.strictEqual(C.pickConcordi([r({ commence_time: '2026-11-26T09:00:00Z' })], now).length, 0, 'gia\' iniziata');
assert.strictEqual(C.pickConcordi([r({ play: null })], now).length, 0, 'non giocabile sui tuoi siti');
assert.strictEqual(C.resultOf('home', '2-1'), 'won'); assert.strictEqual(C.resultOf('draw', '2-1'), 'lost'); assert.strictEqual(C.resultOf('home', ''), null);
const S = C.summarize([
  { event_id: 'a', selection: 'home', home: 'A', away: 'B', commence_time: '2026-11-25T18:00:00Z', odd: '2.0', prob: '0.5', result: 'won', result_score: '1-0', clv_pct: '4' },
  { event_id: 'b', selection: 'away', home: 'C', away: 'D', commence_time: '2026-11-25T19:00:00Z', odd: '3.0', prob: '0.35', result: 'lost', result_score: '1-0', clv_pct: '2' },
  { event_id: 'c', selection: 'draw', home: 'E', away: 'F', commence_time: ko, odd: '3.2', prob: '0.3', result: null, clv_pct: null, book: 'Snai' }], now);
assert.strictEqual(S.settled, 2); assert.strictEqual(S.won, 1); assert.ok(Math.abs(S.pnlEur - 0) < 1e-9, '+1 -1');
assert.ok(Math.abs(S.avgClvPct - 3) < 1e-9); assert.strictEqual(S.next.length, 1); assert.strictEqual(S.next[0].pick, 'X');
console.log('concordi: ok');
