const assert = require('assert');
const { simulate } = require('../services/martingala');
// 10 giorni: pareggio solo l'ultimo giorno a quota 3 -> 9 perse di fila poi recupero di tutto + obiettivo
const rows = []; for (let i = 0; i < 10; i++) { const d = `2020-0${1 + Math.floor(i / 28)}-${String(10 + i).padStart(2, '0')}`; rows.push({ match_date: d, hg: i === 9 ? 1 : 1, ag: i === 9 ? 1 : 0, ad: 3 }, { match_date: d, hg: 2, ag: 2, ad: 3.5 }); }
const s = simulate(rows, { double: false });
assert.strictEqual(s.bets, 10); assert.strictEqual(s.draws, 1); assert.strictEqual(s.longest, 9);
assert.ok(Math.abs(s.pnl - 0.4) < 1e-9, 'un giro chiuso rende l\'obiettivo: ' + s.pnl);
assert.ok(s.maxStake > 7, 'dopo 9 perse la puntata e\' cresciuta: ' + s.maxStake);
// con il tetto il giro salta: si perde tutto
const t = simulate(rows, { cap: 2, double: false });
assert.ok(t.busts >= 1 && t.pnl < 0);
// il metodo del video: raddoppio 0,20 0,40 0,80... dopo 9 perse la decima e' 0,20 x 2^9 = 102,40 e a quota 3 rende 204,80 - 102,20 = 102,60
const v = simulate(rows);
assert.ok(Math.abs(v.maxStake - 102.4) < 1e-9, 'raddoppio: ' + v.maxStake);
assert.ok(Math.abs(v.pnl - (102.4 * 2 - 0.2 * (2 ** 9 - 1))) < 1e-9, 'saldo del raddoppio: ' + v.pnl);
console.log('martingala sui pareggi: ok');
{ const { parallel } = require('../services/martingala');
  const p2 = parallel(rows, 2); assert.strictEqual(p2.ladders, 2); assert.strictEqual(p2.bets, 20, 'due scalate, una partita ciascuna al giorno');
  console.log('scalate in parallelo: ok'); }
{ const { valueDraws, flat } = require('../services/martingala');
  const v = valueDraws([{ ph: 2, pd: 3.4, pa: 4, md: 3.7, hg: 1, ag: 1 }, { ph: 2, pd: 3.4, pa: 4, md: 3.4, hg: 0, ag: 0 }]);
  assert.strictEqual(v.length, 1, 'solo il pareggio pagato sopra il giusto'); assert.strictEqual(v[0].ad, 3.7);
  assert.ok(Math.abs(flat(v).pnl - 5.4) < 1e-9);
  console.log('pareggi di valore: ok'); }
