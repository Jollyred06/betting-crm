const assert = require('assert');
const B = require('../services/bivio');
const now = Date.parse('2026-11-22T10:00:00Z'), at = '2026-11-22T15:00:00Z';
const mk = (id, pin, books, extra = {}) => ({ event_id: id, league: 'Italy - Serie A', home_team: 'Parma', away_team: 'Roma', commence_time: at, ...extra,
  bookmakers: [{ key: 'pinnacle', outcomes: { HOME: pin[0], DRAW: pin[1], AWAY: pin[2] } },
    ...Object.entries(books).map(([k, q]) => ({ key: k, outcomes: { HOME: q[0], DRAW: q[1], AWAY: q[2] } }))] });
// favorita a 1,75 (prob ~0,56) pagata 1,85 su goldbet: valore ~+4%; trasferta 5,0 pagata 5,3 (oltre 4,00): fuori; la scelta e' 1 (probabilita')
const r1 = mk('a', [1.75, 3.9, 5.0], { goldbet: [1.87, 3.7, 5.3], eurobet: [1.78, 3.8, 5.1] });
// sotto quota 2 con valore solo +2%: non basta (serve 4%)
const r2 = mk('b', [1.75, 3.9, 5.0], { goldbet: [1.79, 3.7, 4.8] });
// la X pagata 4,30 (oltre 4,00, dal 23/11): fuori. Il 2 a 2,60 vs pin 2,40: valore ~+4%
const r3 = mk('c', [3.0, 3.4, 2.4], { eurobet: [2.9, 4.3, 2.6] });
// giovanili: fuori
const r4 = mk('d', [1.75, 3.9, 5.0], { goldbet: [1.85, 3.7, 5.3] }, { home_team: 'Parma U19', away_team: 'Roma U19' });
const out = B.pickBivio([r1, r2, r3, r4], ['goldbet', 'eurobet', '888sport_it'], now);
const by = Object.fromEntries(out.map(x => [x.event_id, x]));
assert.ok(by.a && by.a.selection === 'home' && by.a.book === 'goldbet' && by.a.odd === 1.87, 'a: gioca 1 su Goldbet');
assert.ok(!by.b, 'b: sotto quota 2 serve valore dal 4%');
assert.ok(by.c && by.c.selection === 'away' && by.c.odd === 2.6, 'c: gioca 2 a 2,60');
assert.ok(!by.d, 'd: giovanili fuori');
assert.ok(B.kellyOf(0.56, 1.85) > 0 && B.kellyOf(0.56, 1.85) <= 0.02);
assert.ok(B.growthOf(0.62, 1.7) > B.growthOf(0.2, 5.5), 'crescita: la casa batte la trasferta dell\'esempio');
const S = B.summarize([{ event_id: 'a', selection: 'home', home: 'Parma', away: 'Roma', commence_time: '2026-11-21T15:00:00Z', prob: 0.56, odd: 1.85, edge_pct: 3.6, kelly: 0.01, result: 'won', result_score: '2-0' },
  { event_id: 'c', selection: 'away', home: 'X', away: 'Y', commence_time: '2026-11-21T18:00:00Z', prob: 0.4, odd: 2.6, edge_pct: 4, kelly: 0.006, result: 'lost', result_score: '1-1' }], now);
assert.strictEqual(S.all.settled, 2); assert.strictEqual(S.prob.won, 1); assert.strictEqual(S.quota.won, 0);
assert.ok(Math.abs(S.all.pnl - (2 * 0.85 - 2)) < 1e-9);
console.log('bivio: ok');
