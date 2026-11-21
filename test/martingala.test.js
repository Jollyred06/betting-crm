const assert = require('assert');
const { simulate } = require('../services/martingala');
// 10 giorni: pareggio solo l'ultimo giorno a quota 3 -> 9 perse di fila poi recupero di tutto + obiettivo
const rows = []; for (let i = 0; i < 10; i++) { const d = `2020-0${1 + Math.floor(i / 28)}-${String(10 + i).padStart(2, '0')}`; rows.push({ match_date: d, hg: i === 9 ? 1 : 1, ag: i === 9 ? 1 : 0, ad: 3 }, { match_date: d, hg: 2, ag: 2, ad: 3.5 }); }
const s = simulate(rows);
assert.strictEqual(s.bets, 10); assert.strictEqual(s.draws, 1); assert.strictEqual(s.longest, 9);
assert.ok(Math.abs(s.pnl - 0.4) < 1e-9, 'un giro chiuso rende l\'obiettivo: ' + s.pnl);
assert.ok(s.maxStake > 7, 'dopo 9 perse la puntata e\' cresciuta: ' + s.maxStake);
// con il tetto il giro salta: si perde tutto
const t = simulate(rows, { cap: 2 });
assert.ok(t.busts >= 1 && t.pnl < 0);
console.log('martingala sui pareggi: ok');
