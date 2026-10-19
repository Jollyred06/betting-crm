// Bankroll di allenamento: tre modi di puntare, saldo atteso (valore alla chiusura) e reale (vinte e perse), freno al -25%.
const assert = require('assert');
const T = require('../services/training');

const sig = (i, o) => ({ id: i, created_at: `2026-10-${String(10 + i).padStart(2, '0')}T10:00:00Z`, odd: 2, fair_prob: 0.52, edge_pct: 4, clv_pct: 3, result: null, ...o });
// fisso: 10 € a segnale; +3% di valore -> +0,30 € a segnale
const s1 = T.trainSelection([sig(1), sig(2), sig(3, { clv_pct: null })]);
const fx = s1.methods.find(m => m.key === 'fixed');
assert.ok(Math.abs(fx.expected.pnl - 0.6) < 1e-9); assert.strictEqual(fx.expected.bets, 2); assert.strictEqual(s1.measured, 2);
// proporzionale: cresce con la cassa
const pr = s1.methods.find(m => m.key === 'prop');
assert.ok(pr.expected.pnl > 0.6 - 1e-9);
// kelly prudente: mezzo Kelly, tra 0,5% e 3%
assert.ok(Math.abs(T.stakeFor('kelly', 500, { odd: 2, fair_prob: 0.52 }) - 500 * (0.04 / 2)) < 1e-9);
assert.strictEqual(T.stakeFor('kelly', 500, { odd: 2, fair_prob: 0.9 }), 15);       // tetto 3%
assert.strictEqual(T.stakeFor('kelly', 500, { odd: 2, fair_prob: 0.4 }), 2.5);      // minimo 0,5%
// reale: vinta a quota 2 = +stake, persa = -stake, senza risultato non conta
const s2 = T.trainSelection([sig(1, { result: 'won' }), sig(2, { result: 'lost' }), sig(3, { result: 'void' })]);
const fr = s2.methods.find(m => m.key === 'fixed').real;
assert.strictEqual(fr.bets, 2); assert.ok(Math.abs(fr.pnl) < 1e-9);
// freno: sotto il 75% la cassa si ferma
const losing = Array.from({ length: 20 }, (_, i) => sig(i, { result: 'lost', clv_pct: -60 }));
const st = T.trainSelection(losing).methods.find(m => m.key === 'fixed');
assert.strictEqual(st.real.stopped, true); assert.ok(st.real.balance >= 0.75 * T.START - 10);
assert.strictEqual(st.real.bets, 13);   // 13 x 10 € = -130 -> 370 < 375: si ferma
// ordine per orario di uscita
const s3 = T.trainSelection([sig(5, { result: 'won' }), sig(1, { result: 'lost' })]);
assert.deepStrictEqual(s3.methods[0].real.curve.map(p => p.b), [500, 490, 500]);
console.log('training.test.js: tutti i controlli passati');
