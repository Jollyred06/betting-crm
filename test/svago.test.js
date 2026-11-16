// 🎈 Svago (16/11/2026): quali segnali, budget a parte, le ⭐ non perdono posti ne' freni. Senza rete e senza database.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
Module._load = function (request) {
  if (request === 'dotenv') return { config() {} };
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  return origLoad.apply(this, arguments);
};
const I = require('../services/italia');
// campionato minore (margine alto), favorita in casa
const base = { strategy: 'I', league: 'Serie D', pin_h: 1.7, pin_d: 3.6, pin_a: 4.4, edge_pct: 3 };
assert.ok(I.isSvago({ ...base, selection: 'home', odd: 1.8 }), 'risultato piu probabile: si');
assert.ok(!I.isSvago({ ...base, selection: 'away', odd: 4.8 }), 'non il piu probabile: no');
assert.ok(!I.isSvago({ ...base, selection: 'home', odd: 1.8, play: { odd: 3.7 } }), 'quota oltre 3,50: no');
assert.ok(!I.isSvago({ ...base, league: 'FA Cup', selection: 'away', odd: 2.6, pin_h: 3.2, pin_d: 3.4, pin_a: 2.2 }), 'Coppe: no (e una giocata vera)');
// budget: 5 al giorno e -20 euro al mese
const now = Date.parse('2026-11-20T15:00:00Z'), c = { perDay: 5, monthLossEur: 20, on: true };
const it = (at, pnl, svago = true) => ({ at, pnlEur: pnl, svago, result: pnl === null ? null : pnl > 0 ? 'won' : 'lost' });
let b = I.svagoBudget([it('2026-11-20T10:00:00Z', -2), it('2026-11-18T10:00:00Z', 1.6), it('2026-10-30T10:00:00Z', -2)], c, now);
assert.strictEqual(b.playedToday, 1); assert.ok(Math.abs(b.pnlMonth - (-0.4)) < 1e-9, 'solo il mese corrente'); assert.ok(!b.stopped);
b = I.svagoBudget(Array.from({ length: 10 }, (_, i) => it(`2026-11-1${i % 9}T10:00:00Z`, -2)), c, now);
assert.ok(b.stopped && /mese/.test(b.stopWhy), '-20 euro nel mese: fermo');
b = I.svagoBudget(Array.from({ length: 5 }, () => it('2026-11-20T09:00:00Z', null)), c, now);
assert.ok(b.stopped && /oggi/.test(b.stopWhy), '5 oggi: fermo per oggi');
assert.ok(I.svagoBudget([], { ...c, on: false }, now).stopped, 'spento da Render');
// le ⭐: le giocate Svago non consumano posti e non fanno scattare "3 perse oggi"
const bc = { start: 100, stop: 75, maxPerDay: 10 };
const played = { items: [it('2026-11-20T10:00:00Z', -2), it('2026-11-20T11:00:00Z', -2), it('2026-11-20T12:00:00Z', -2), it('2026-11-20T13:00:00Z', 3, false)] };
const bb = I.budgetOf(played, bc, now);
assert.strictEqual(bb.playedToday, 1, 'conta solo la giocata non Svago'); assert.strictEqual(bb.lostToday, 0); assert.ok(!bb.dayStop);
assert.ok(Math.abs(bb.balance - (100 - 6 + 3)) < 1e-9, 'i soldi contano tutti nel budget');
console.log('svago: ok');
