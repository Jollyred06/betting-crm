'use strict';
const assert = require('assert');
const A = require('../services/aidb');
// fotografia di una scheda
const r = { id: 7, event_id: 'e1', pick: '1', selection: 'home', league: 'Serie A', home: 'A', away: 'B', commence_time: '2030-01-01T18:00:00Z', play: { book: 'Goldbet', odd: 2.4 },
  min_odd: 2.2, edge_pct: 6, win_prob: 0.45, guess: { pick: '1', ai: { pick: '1', prob: 0.5 } }, market: { dir: 'con' }, alt: { Goldbet: 2.4, Eurobet: 2.3 } };
const s = A.snapshot(r, { best: new Set([7]), nowMs: Date.parse('2030-01-01T12:00:00Z') });
assert.deepStrictEqual([s.selection, s.is_fav, s.agree_ai, s.agree_pin, s.canon, s.best, s.hours_before, s.my_books, s.odd], ['home', true, true, true, true, true, 6, 2, 2.4]);
const d = A.snapshot({ ...r, pick: 'X', selection: 'draw', guess: { pick: '1', ai: { pick: 'X', prob: 0.3 } } }, {});
assert.deepStrictEqual([d.is_draw, d.is_fav, d.agree_ai, d.agree_pin, d.canon], [true, false, true, false, false]);
assert.strictEqual(A.resultOf('home', '2-1'), 'won'); assert.strictEqual(A.resultOf('draw', '2-1'), 'lost'); assert.strictEqual(A.resultOf('away', 'x'), null);
// profilo: buone = valore alla chiusura > 0, ottime = buone e vinte
const rows = [
  { ...s, source: 'live', result: 'won', clv_pct: 4, seen_at: '2030-01-01' }, { ...s, event_id: 'e2', result: 'lost', clv_pct: 3 },
  { ...d, event_id: 'e3', result: 'lost', clv_pct: -2 }, { ...s, event_id: 'e4', result: null, clv_pct: null },
];
const S = A.summarize(rows), all = S.profile.find(g => g.label === 'Tutte'), can = S.profile.find(g => g.label.startsWith('⭐'));
assert.deepStrictEqual([S.n, S.settled, S.measured, S.ottime], [4, 3, 3, 1]);
assert.deepStrictEqual([all.n, all.won, Math.round(all.goodPct), Math.round(all.topPct)], [4, 1, 67, 33]);
assert.deepStrictEqual([can.n, can.settled, can.won], [3, 2, 1]);
assert.ok(S.identikit.length && S.identikit[0].top === 100);
console.log('aidb: tutti i controlli passati');
