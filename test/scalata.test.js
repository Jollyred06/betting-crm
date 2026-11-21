const assert = require('assert');
const S = require('../services/scalata');
// scelta: fuori le quote sotto 2 e sopra 3,50 e senza valore; prima la piu' probabile, poi i premi
const c = [
  { event_id: 'a', odd: 1.8, edgePct: 5, prob: 0.6, isFav: true },
  { event_id: 'b', odd: 2.3, edgePct: 3, prob: 0.46, isFav: true, isHome: true, isMajor: true, movedPts: 0.5 },
  { event_id: 'c', odd: 2.6, edgePct: 6, prob: 0.40, isFav: false, isHome: false },
  { event_id: 'd', odd: 3.0, edgePct: 1, prob: 0.337 },
  { event_id: 'e', odd: 4.0, edgePct: 9, prob: 0.27 }
];
assert.deepStrictEqual(S.pickScalata(c).map(x => x.event_id), ['b', 'c']);
assert.ok(S.reasonsOf({ ...c[1], movedPts: 0.5 }).some(r => /IA d'accordo/.test(r)));
// scalata: 0,20 0,40 0,80 poi vince a 2,5 -> +1,20; poi riparte da 0,20
const day = i => `2026-11-${String(22 + i).padStart(2, '0')}`;
const L = S.ladder([{ day: day(0), odd: 2.5, result: 'lost' }, { day: day(1), odd: 2.5, result: 'lost' }, { day: day(2), odd: 2.5, result: 'won' }, { day: day(3), odd: 2.5, result: null }]);
assert.ok(Math.abs(L.pnl - (0.8 * 1.5 - 0.6)) < 1e-9, 'saldo ' + L.pnl); assert.strictEqual(L.step, 1); assert.strictEqual(L.nextStake, 0.2); assert.ok(L.waiting);
assert.ok(Math.abs(L.maxLoss - 204.6) < 1e-9);
// freno a 10: dopo 10 perse si riparte
const ten = Array.from({ length: 11 }, (_, i) => ({ day: `2026-12-${String(1 + i).padStart(2, '0')}`, odd: 2.4, result: 'lost' }));
const F = S.ladder(ten); assert.strictEqual(F.stops, 1); assert.ok(Math.abs(F.pnl + 204.6 + 0.2) < 1e-9, 'freno: ' + F.pnl); assert.strictEqual(F.step, 2);
console.log('scalata e freno: ok');
// 21/11: sotto 1 euro solo 888sport, con la sua quota e il suo valore
{
  const cc = [
    { event_id: 'x', prob: 0.45, odd: 2.5, edgePct: 12.5, quotes: { eurobet: 2.5, '888sport_it': 2.3 } },   // su 888 vale +3,5%: ok
    { event_id: 'y', prob: 0.46, odd: 2.4, edgePct: 10.4, quotes: { goldbet: 2.4 } },                         // niente 888: fuori a 0,20
    { event_id: 'z', prob: 0.47, odd: 2.3, edgePct: 8.1, quotes: { eurobet: 2.3, '888sport_it': 2.15 } }     // su 888 +1%: fuori
  ];
  const low = S.pickScalata(cc, 0.2);
  assert.deepStrictEqual(low.map(x => x.event_id), ['x']); assert.strictEqual(low[0].book, '888sport_it'); assert.strictEqual(low[0].odd, 2.3);
  const high = S.pickScalata(cc, 1.6);
  assert.deepStrictEqual(high.map(x => x.event_id), ['z', 'y', 'x'], 'da 1,60 tutti i siti, la piu\' probabile prima');
  assert.strictEqual(high.find(x => x.event_id === 'x').book, 'eurobet');
  console.log('scalata sul sito che accetta la puntata: ok');
}
// 21/11 sera: piu' giocate nello stesso giorno, in ordine di ora
{
  const L = S.ladder([{ id: 2, day: '2026-11-22', commence_time: '2026-11-22T18:00:00Z', odd: 2.4, result: 'won' }, { id: 1, day: '2026-11-22', commence_time: '2026-11-22T13:00:00Z', odd: 2.4, result: 'lost' }]);
  assert.ok(Math.abs(L.pnl - (0.4 * 1.4 - 0.2)) < 1e-9, 'prima la persa delle 13 (0,20), poi la vinta delle 18 (0,40): ' + L.pnl);
  assert.strictEqual(L.nextStake, 0.2);
  console.log('piu\' giocate nello stesso giorno: ok');
}
{ const L = S.ladder([{ id: 1, commence_time: '2026-11-22T12:00:00Z', odd: 2.4, result: 'lost' }, { id: 2, commence_time: '2026-11-22T15:00:00Z', odd: 2.4, result: 'skip' }, { id: 3, commence_time: '2026-11-22T18:00:00Z', odd: 2.4, result: null }]);
  assert.strictEqual(L.step, 2, 'la non giocata non conta'); assert.strictEqual(L.steps[0].stake, 0.4, 'la prossima resta a 0,40'); console.log('non giocata: ok'); }
// 21/11 sera: partenza adattiva = cassa / 1.250 e avviso di ritiro al raddoppio
{
  assert.strictEqual(S.baseFor(250), 0.2); assert.strictEqual(S.baseFor(625), 0.5); assert.strictEqual(S.baseFor(1250), 1); assert.strictEqual(S.baseFor(50), 0.1);
  const L = S.ladder([{ id: 1, commence_time: '2026-11-22T12:00:00Z', odd: 2.5, result: 'won' }], { cassa: 625 });
  assert.ok(Math.abs(L.pnl - 0.75) < 1e-9 && L.nextStake === 0.5 && Math.abs(L.cassaNow - 625.75) < 1e-9);
  const W = S.ladder([{ id: 1, commence_time: '2026-11-22T12:00:00Z', odd: 2.5, result: 'won' }], { cassa: 250, withdrawn: 0 });
  assert.strictEqual(W.withdrawAlert, 0);
  const B = S.ladder([], { cassa: 250 }); assert.strictEqual(B.nextStake, 0.2);
  const R = S.ladder([], { cassa: 250, withdrawn: 0 }); assert.strictEqual(R.cassaNow, 250);
  console.log('partenza adattiva e ritiro: ok');
}
{ // ritiro a ogni raddoppio dopo il primo: livello 260 dopo il ritiro, a 520 si ritira meta' del guadagno (130)
  const L = S.ladder([], { cassa: 250, withdrawn: 250, lastLevel: 260 }); assert.strictEqual(L.cassaNow, 0);
  const rows = [{ id: 1, commence_time: '2026-12-01T12:00:00Z', odd: 2.5, result: 'won' }];
  const M = S.ladder(rows, { cassa: 1000, withdrawn: 250, lastLevel: 375 }); // cassaNow = 750 + vincita
  assert.strictEqual(M.withdrawAlert, Math.floor((M.cassaNow - 375) / 2)); assert.ok(!M.firstWithdraw);
  console.log('ritiro a ogni raddoppio: ok'); }
