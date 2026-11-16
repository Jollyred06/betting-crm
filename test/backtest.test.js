// Prova del metodo sullo storico: conti giusti, regola, gruppi. Senza rete e senza database.
const assert = require('assert'), B = require('../services/backtest');
assert.strictEqual(B.seasonOf('2025-08-15'), '2025/26'); assert.strictEqual(B.seasonOf(new Date('2019-09-01T00:00:00Z')), '2019/20', 'anche con le date del database'); assert.strictEqual(B.seasonOf('2026-03-01'), '2025/26');
// 100 partite uguali: Pinnacle 2,60/3,20/3,00, quota massima sul pareggio 3,40 (vantaggio ~+2,8%); il pareggio esce 30 volte
const rows = Array.from({ length: 100 }, (_, i) => ({ match_date: '2024-10-01', league: 'XX', hg: i < 30 ? 1 : 2, ag: i < 30 ? 1 : 0, ph: 2.6, pd: 3.2, pa: 3.0, mh: 2.62, md: 3.4, ma: 3.02, ah: 2.5, ad: 3.1, aa: 2.9 }));
const r = B.backtest(rows);
assert.strictEqual(r.matches, 100);
assert.strictEqual(r.rule.n, 100, 'solo il pareggio supera il 2% ed e nella fascia 2-3,5');
assert.strictEqual(r.rule.won, 30); assert.ok(Math.abs(r.rule.roiPct - (30 * 2.4 - 70) / 100 * 100) < 0.1, 'saldo alla quota massima');
assert.ok(r.ruleAtAverage.roiPct < r.rule.roiPct, 'alla quota media rende meno');
assert.strictEqual(r.everything.n, 300); assert.strictEqual(r.bySeason[0].group, '2024/25');
assert.strictEqual(B.backtest([{ ...rows[0], mh: null }]).matches, 0, 'senza quota massima la partita non conta');
console.log('prova del metodo sullo storico: ok');
