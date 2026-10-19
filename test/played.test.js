// Le mie giocate: controllo dei dati scritti a mano e riepilogo (valore vs chiusura, quota rispetto al segnale, saldo vero).
const assert = require('assert');
const P = require('../services/played');

assert.ok(P.validate({ book: '', odd: 2, stake: 2 })); assert.ok(P.validate({ book: 'Snai', odd: 1, stake: 2 })); assert.ok(P.validate({ book: 'Snai', odd: 2, stake: 0 }));
assert.strictEqual(P.validate({ book: 'Snai', odd: 2.1, stake: 2 }), null);

const row = o => ({ id: 1, signal_id: 10, created_at: '2026-10-19T10:00:00Z', book: 'Snai', odd: '2.10', stake: '2', signal_odd: '2.20', signal_book: '888sport_it', fair_prob: '0.5', closing_fair_prob: '0.5', result: null, ...o });
const s = P.summarize([row(), row({ id: 2, odd: '2.00', closing_fair_prob: '0.52', result: 'won' }), row({ id: 3, odd: '3', closing_fair_prob: null, result: 'lost' })]);
assert.strictEqual(s.count, 3); assert.strictEqual(s.staked, 6);
assert.strictEqual(s.measured, 2); assert.ok(Math.abs(s.avgClvPct - 4.5) < 1e-9);          // (2,10 x 0,50 - 1) = +5%, (2,00 x 0,52 - 1) = +4%
assert.strictEqual(s.settled, 2); assert.strictEqual(s.won, 1); assert.ok(Math.abs(s.pnlEur - 0) < 1e-9);   // +2 e -2
const first = s.items.find(x => x.id === 1);
assert.strictEqual(first.minOdd, 2.04); assert.strictEqual(first.okMin, true);                // minima = 1,02 / 0,50
assert.ok(Math.abs(first.slipPct - (2.1 / 2.2 - 1) * 100) < 1e-9);
assert.strictEqual(first.signalBook, '888sport');
console.log('played.test.js: tutti i controlli passati');
