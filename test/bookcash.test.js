const assert = require('assert');
const { balanceOf, norm } = require('../services/bookcash');
assert.strictEqual(norm('888sport_it'), '888sport'); assert.strictEqual(norm('888sport'), '888sport'); assert.strictEqual(norm('Goldbet'), 'goldbet');
const now = Date.parse('2026-11-22T20:00:00Z'), set = { saldo: 100, at: '2026-11-22T10:00:00Z' };
const bets = [
  { stake: 2, odd: 2.5, result: 'won', placedAt: '2026-11-22T12:00:00Z', kickoff: '2026-11-22T14:00:00Z' },   // dopo: -2 +5
  { stake: 4, odd: 2, result: 'lost', placedAt: '2026-11-22T12:00:00Z', kickoff: '2026-11-22T15:00:00Z' },    // dopo: -4
  { stake: 3, odd: 2, result: null, placedAt: '2026-11-22T18:00:00Z', kickoff: '2026-11-22T21:00:00Z' },      // aperta: -3, in gioco 3
  { stake: 1, odd: 3, result: 'won', placedAt: '2026-11-22T09:00:00Z', kickoff: '2026-11-22T11:00:00Z' },     // prima, chiusa dopo: +3
  { stake: 5, odd: 2, result: 'won', placedAt: '2026-11-21T09:00:00Z', kickoff: '2026-11-21T11:00:00Z' },     // tutta prima: niente
  { stake: 2, odd: 2, result: 'void', placedAt: '2026-11-22T12:00:00Z', kickoff: '2026-11-22T13:00:00Z' }     // annullata: 0
];
const b = balanceOf(set, bets, now);
assert.strictEqual(b.saldo, 100 - 2 + 5 - 4 - 3 + 3 - 2 + 2);
assert.strictEqual(b.open, 3); assert.strictEqual(b.bets, 4); assert.strictEqual(b.pnl, 3 - 4 + 0);
console.log('casse per sito: ok', b);
