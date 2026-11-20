const assert = require('assert');
const SP = require('../services/sicurepaper');
const now = Date.parse('2026-11-21T10:00:00Z'), at = '2026-11-21T15:00:00Z';
const ev = (id, pin, books, extra = {}) => ({ event_id: id, league: 'L', home_team: 'H' + id, away_team: 'A' + id, commence_time: at, bookmakers: [{ key: 'pinnacle', outcomes: { HOME: pin[0], DRAW: pin[1], AWAY: pin[2] } }, ...books], ...extra });
const merged = [
  ev('a', [1.25, 6.5, 12], [{ key: 'eurobet', outcomes: { HOME: 1.22, DRAW: 6, AWAY: 11 } }, { key: 'goldbet', outcomes: { HOME: 1.24, DRAW: 6, AWAY: 10 } }, { key: 'bet365', outcomes: { HOME: 1.4, DRAW: 6, AWAY: 10 } }]),
  ev('b', [2.1, 3.4, 3.5], [{ key: 'eurobet', outcomes: { HOME: 2.1, DRAW: 3.3, AWAY: 3.4 } }]),           // non abbastanza favorita
  ev('c', [12, 6.5, 1.25], [{ key: 'goldbet', outcomes: { HOME: 11, DRAW: 6, AWAY: 1.23 }, suspended: ['AWAY'] }]),   // sospesa
  ev('d', [1.2, 7, 15], [])
];
const p = SP.pickSicure(merged, ['eurobet', 'goldbet'], now);
assert.strictEqual(p.length, 1); assert.strictEqual(p[0].event_id, 'a'); assert.strictEqual(p[0].book, 'goldbet'); assert.strictEqual(p[0].odd, 1.24);
assert.ok(p[0].prob > 0.7 && !p[0].quotes.bet365);
assert.strictEqual(SP.resultOf('home', '2-0'), 'won'); assert.strictEqual(SP.resultOf('away', '1-1'), 'lost');
const s = SP.summarize([{ odd: 1.3, prob: 0.75, result: 'won' }, { odd: 1.3, prob: 0.75, result: 'won' }, { odd: 1.3, prob: 0.75, result: 'lost' }, { odd: 1.2, prob: 0.8, result: null }]);
assert.strictEqual(s.settled, 3); assert.strictEqual(s.won, 2); assert.ok(Math.abs(s.pnl - (2 * 0.6 - 2)) < 1e-9); assert.strictEqual(s.open, 1);
console.log('sicure sulla carta: ok');
