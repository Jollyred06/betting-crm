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
{ const f = simulate(rows, { maxSteps: 3 }); assert.ok(f.busts >= 2 && f.maxStake <= 0.8 + 1e-9, 'col freno a 3 la puntata non supera 0,80: ' + f.maxStake); console.log('freno sulla serie: ok'); }
{ const { valueOf, flat } = require('../services/martingala');
  const r = [{ ph: 2, pd: 3.4, pa: 4, mh: 2.2, md: 3.4, ma: 4, hg: 2, ag: 0 }, { ph: 2, pd: 3.4, pa: 4, mh: 2.2, md: 3.4, ma: 4, hg: 0, ag: 1 }];
  const H = valueOf(r, 'home'); assert.strictEqual(H.length, 2); assert.ok(Math.abs(flat(H).pnl - (2 * 1.2 - 2)) < 1e-9, 'casa: una vinta e una persa');
  assert.strictEqual(valueOf(r, 'away').length, 0, 'trasferta pagata il giusto: fuori');
  console.log('valore per esito: ok'); }
{ const M = require('../services/martingala');
  const t = M.masanielloTable(3, 1, 2); assert.ok(Math.abs(t[3][1] - (1 + 1 + 2 * 1) / 4) < 1 || t[3][1] > 0, 'tabella Masaniello');
  const rows2 = []; for (let i = 0; i < 40; i++) rows2.push({ match_date: new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10), hg: 1, ag: i % 2 ? 1 : 0, ad: 2.5, p: 0.42 });
  const c = M.compareSystems(rows2); assert.strictEqual(c.days, 40); assert.ok(Object.keys(c.systems).length === 8);
  assert.ok(Math.abs(c.systems.fissa.pnl - (20 * 1.5 - 20)) < 1e-9, 'fissa: 20 vinte a 2,5 e 20 perse');
  console.log('sistemi a confronto: ok'); }
{ const { adaptiveLadder } = require('../services/martingala');
  // ogni giorno due partite: A quota 3,2 al 33% (piu' valore), B quota 2,1 al 50% (piu' probabile)
  const rows3 = []; for (let i = 0; i < 6; i++) { const d = `2021-01-${String(10 + i).padStart(2, '0')}`; rows3.push({ match_date: d, ad: 3.2, p: 0.33, hg: 1, ag: 0 }, { match_date: d, ad: 2.1, p: 0.5, hg: 1, ag: i === 4 ? 1 : 0 }); }
  const a = adaptiveLadder(rows3, { switchAt: 3 }); // gradini 1-2 su A (perde), dal 3 su B: vince al giorno 5 (gradino 5)
  assert.strictEqual(a.bets, 6); assert.ok(Math.abs(a.pnl - (3.2 * 2.1 - 3.2 - (0.2 + 0.4 + 0.8 + 1.6)) - (-0.2)) < 1e-9, 'adattiva: ' + a.pnl);
  console.log('scalata adattiva: ok'); }
{ const { riskLadder } = require('../services/martingala');
  const rr = []; for (let i = 0; i < 4; i++) rr.push({ match_date: `2021-02-0${i + 1}`, ad: 2.5, p: i === 2 ? 0.4 : 0.5, hg: 1, ag: i === 3 ? 1 : 0 });
  const a = riskLadder(rr, { bank0: 1250, adaptBase: true }); assert.ok(Math.abs(a.finalBase - 1) < 1e-9, 'partenza = cassa/1250');
  const f = riskLadder(rr, { bank0: 250, strictFrom: 3, strictProb: 0.45 }); assert.strictEqual(f.skipped, 1, 'al gradino 3 salta la partita al 40%');
  console.log('martingala adattiva al rischio: ok'); }
