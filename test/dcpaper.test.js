// Doppia chance sulla carta: scelta dei segnali, una lettura al giorno dopo la scansione, risultati. Senza rete e senza database vero.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
Module._load = function (request) {
  if (request === 'dotenv') return { config() {} };
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  return origLoad.apply(this, arguments);
};
const D = require('../services/dcpaper');
const liquid = { pin_h: 2.0, pin_d: 3.6, pin_a: 4.2 }, thin = { pin_h: 1.9, pin_d: 3.2, pin_a: 3.8 };
const f = (event, esito, quota, edgePct, pin) => ({ event, esito, quota, edgePct, pin, sito: 'snai', fair: 0.7 });
const picks = D.pickDc([f('a', '1X', 1.36, 3, liquid), f('a', '1X', 1.38, 4.4, liquid), f('b', 'X2', 2.7, 5, thin), f('c', '12', 1.3, 1.5, liquid)]);
assert.strictEqual(picks.length, 1, 'campionato minore e vantaggio sotto 2% esclusi'); assert.strictEqual(picks[0].quota, 1.38, 'il sito che paga di piu');
assert.strictEqual(D.outOf('1X', '2-2'), 'won'); assert.strictEqual(D.outOf('1X', '0-1'), 'lost'); assert.strictEqual(D.outOf('12', '1-1'), 'lost'); assert.strictEqual(D.outOf('X2', ''), null);
const s = D.summarizeDcPaper([{ result: 'won', odd: 1.4, fair_prob: 0.72 }, { result: 'lost', odd: 1.5, fair_prob: 0.68 }, { result: null, odd: 1.3, fair_prob: 0.75 }]);
assert.strictEqual(s.count, 3); assert.strictEqual(s.settled, 2); assert.strictEqual(s.won, 1); assert.ok(Math.abs(s.roiPct - (-30)) < 1e-9);
(async () => {
  // fuori dall'ora o gia' fatta oggi: nessuna richiesta
  let calls = 0; const http = { get: async () => { calls++; return { data: { odds: [] }, headers: {} }; } };
  const c = { books: ['snai'], myBooks: ['snai'], key: 'k', monthlyCap: 9999 };
  const at = h => Date.parse(`2026-11-18T${String(h - 1).padStart(2, '0')}:20:00Z`);   // ora italiana h
  const pool = (done, scanned) => ({ query: async sql => (/CREATE/.test(sql) ? { rows: [] } : /kind = 'dc_paper'/.test(sql) ? { rows: done ? [1] : [] } : /kind = 'scan'/.test(sql) ? { rows: scanned ? [1] : [] } : { rows: [] }) });
  assert.deepStrictEqual(await D.dcDaily(pool(false, true), c, { nowMs: at(15), http, env: { DC_PAPER: 'true' } }), {});
  assert.deepStrictEqual(await D.dcDaily(pool(true, true), c, { nowMs: at(17), http, env: { DC_PAPER: 'true' } }), {});
  assert.strictEqual((await D.dcDaily(pool(false, false), c, { nowMs: at(17), http, env: { DC_PAPER: 'true' } })).doppiaChance, 'aspetta la scansione');
  assert.strictEqual((await D.dcDaily(pool(false, true), c, { nowMs: at(17), http, env: { DC_PAPER: 'false' } })).doppiaChance, 'spenta');
  // 22/11 sera: spenta di default (accesa solo con DC_PAPER=true)
  assert.strictEqual((await D.dcDaily(pool(false, true), c, { nowMs: at(17), http, env: {} })).doppiaChance, 'spenta');
  assert.strictEqual(calls, 0);
  console.log('doppia chance sulla carta: ok');
})().catch(e => { console.error(e); process.exit(1); });
