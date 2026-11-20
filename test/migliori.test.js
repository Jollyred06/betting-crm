const assert = require('assert');
const M = require('../services/migliori');
const now = Date.parse('2026-11-21T10:00:00Z'), at = '2026-11-21T15:00:00Z';
const ev = (id, pin, books) => ({ event_id: id, league: 'L', home_team: 'H' + id, away_team: 'A' + id, commence_time: at, bookmakers: [{ key: 'pinnacle', outcomes: { HOME: pin[0], DRAW: pin[1], AWAY: pin[2] } }, ...books] });
const merged = [
  ev('a', [1.6, 4.2, 6], [{ key: 'goldbet', outcomes: { HOME: 1.66, DRAW: 4, AWAY: 5.5 } }]),     // favorita in casa pagata piu' del giusto
  ev('b', [1.6, 4.2, 6], [{ key: 'goldbet', outcomes: { HOME: 1.55, DRAW: 4, AWAY: 5.5 } }]),     // pagata meno del giusto: fuori
  ev('c', [5.5, 4.2, 1.62], [{ key: 'eurobet', outcomes: { HOME: 5, DRAW: 4, AWAY: 1.7 } }]),     // favorita fuori casa
  ev('d', [2.5, 3.3, 2.9], [{ key: 'eurobet', outcomes: { HOME: 2.8, DRAW: 3.3, AWAY: 2.9 } }]),  // sotto il 50%: fuori
  ev('e', [1.6, 4.2, 6], [{ key: 'bet365', outcomes: { HOME: 1.9, DRAW: 4, AWAY: 5.5 } }])        // sito dove non si gioca: fuori
];
const first = new Map([['a', { pin_h: 1.62, pin_d: 4.1, pin_a: 5.9 }], ['c', { pin_h: 4.5, pin_d: 4, pin_a: 1.8 }]]);
const p = M.pickMigliori(merged, ['goldbet', 'eurobet'], now, first);
assert.deepStrictEqual(p.map(x => x.event_id), ['a', 'c'], 'ordine per punteggio e filtri');
assert.ok(p[0].isHome && p[0].isMajor && Math.abs(p[0].movedPts) < 2, 'quadro buono della prima');
assert.ok(!p[1].isHome && p[1].movedPts > 2, 'la seconda si e\' accorciata');
assert.ok(M.reasonsOf(p[0]).includes('quota ferma') && M.reasonsOf(p[1]).includes('quota in calo'));
// 5 al giorno, una per partita
const rows = []; for (let i = 0; i < 8; i++) rows.push({ event_id: 'x' + i, selection: 'home', commence_time: at, prob: 0.6, odd: 1.8, edge_pct: 2, score: i, is_home: true, is_major: i % 2 === 0, moved_pts: 0, result: i % 3 ? 'won' : 'lost' });
rows.push({ event_id: 'x7', selection: 'draw', commence_time: at, prob: 0.5, odd: 2.1, edge_pct: 1, score: 6.5, result: 'lost' });
const top = M.topPerDay(rows);
assert.strictEqual(top.length, 5); assert.deepStrictEqual(top.map(r => r.event_id), ['x7', 'x6', 'x5', 'x4', 'x3']); assert.strictEqual(top[0].selection, 'home');
const s = M.summarize(rows, now - 3600000);
assert.strictEqual(s.top.n, 5); assert.ok(s.ingredients.serio.si.n > 0 && s.next.length === 5 && s.next[0].reasons.length >= 2);
console.log('le migliori del giorno: ok');
