// 🏆 Coppe (15/11/2026): quali partite, entrano nella lista da giocare solo con la squadra in campo, simulate e chiusure.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
Module._load = function (request) {
  if (request === 'dotenv') return { config() {} };
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  return origLoad.apply(this, arguments);
};
const I = require('../services/italia'), A = require('../services/autoplay');
const r = (league, odd, edge, extra = {}) => ({ id: Math.random(), event_id: league + odd, league, home: 'A', away: 'B', selection: 'home', odd, edge_pct: edge, pin_h: 2.5, pin_d: 3.3, pin_a: 2.9, ...extra });
assert.ok(I.isCoppe(r('FA Cup', 2.6, 3)), 'coppa, quota e vantaggio giusti');
assert.ok(!I.isCoppe(r('Premier League', 2.6, 3)), 'campionato: no');
assert.ok(!I.isCoppe(r('FA Cup', 1.9, 3)) && !I.isCoppe(r('FA Cup', 3.6, 3)), 'quota fuori 2,00-3,50: no');
assert.ok(!I.isCoppe(r('FA Cup', 2.6, 1.5)), 'vantaggio sotto il 2%: no');
assert.ok(!I.isCoppe(r('FA Cup', 2.6, 3, { play: { odd: 3.8, book: 'snai' } })), 'quota dove si gioca oltre 3,50: no');
// lista da giocare
const now = Date.parse('2026-11-17T12:00:00Z'), item = { ...r('EFL Trophy', 2.8, 4), coppe: true, play: { book: 'snai', odd: 2.8 }, win_prob: 0.4, commence_time: '2026-11-17T19:45:00Z' };
assert.strictEqual(I.pickBest([item], { nowMs: now, team: { coppe: false } }).length, 0, 'squadra in panchina: non si gioca');
assert.strictEqual(I.pickBest([item], { nowMs: now, team: { coppe: true } }).length, 1, 'in campo: si gioca anche se e\' coppa');
assert.strictEqual(I.pickBest([{ ...item, market: { dir: 'contro' } }], { nowMs: now, team: { coppe: true } }).length, 0, 'mercato contro: no');
// simulate: le coppe entrano
const pick = A.pickNew([{ ...r('FA Cup', 2.6, 3), id: 1, created_at: '2026-11-17T10:00:00Z', commence_time: '2026-11-17T19:00:00Z' }],
  { sinceMs: Date.parse('2026-11-17T00:00:00Z'), nowMs: now, taken: { ids: [], keys: [] }, isOceani: () => false, isCoppe: I.isCoppe, primaryRows: x => x });
assert.strictEqual(pick.length, 1);
console.log('coppe: ok');
