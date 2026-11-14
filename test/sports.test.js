// Prova tennis/basket: lettura dei mercati a due esiti e riepilogo. Senza rete e senza database.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
Module._load = function (request) {
  if (request === 'dotenv') return { config() {} };
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  return origLoad.apply(this, arguments);
};
const S = require('../services/sports');
(async () => {
  assert.deepStrictEqual(S.twoWay({ HOME: 1.5, AWAY: 2.6 }), { names: ['HOME', 'AWAY'], odds: [1.5, 2.6] });
  assert.deepStrictEqual(S.twoWay({ OVER: 1.9, UNDER: 1.9 }).names, ['OVER', 'UNDER']);
  assert.strictEqual(S.twoWay({ HOME: 1.5, DRAW: 3, AWAY: 5 }), null);
  assert.strictEqual(S.twoWay(null), null);
  // Pinnacle 1,50 / 2,70 (margine ~3,7%); Snai paga 2,95 sul secondo: vantaggio ~ +6%
  const rec = (id, snai) => ({ event_id: id, home_team: 'A' + id, away_team: 'B' + id, league: 'ATP', market: 'moneyline', bookmakers: [
    { key: 'pinnacle', outcomes: { HOME: 1.5, AWAY: 2.7 } }, { key: 'snai', outcomes: snai }, { key: 'netwin', outcomes: { HOME: 1.4, AWAY: 2.6 } }] });
  const r = S.summarizeSport([rec('e1', { HOME: 1.45, AWAY: 2.95 }), rec('e2', { HOME: 1.45, AWAY: 2.6 }), { event_id: 'e3', bookmakers: [{ key: 'snai', outcomes: { HOME: 2, AWAY: 2 } }] }]);
  assert.strictEqual(r.partite, 3); assert.strictEqual(r.partiteConPinnacle, 2); assert.strictEqual(r.conVantaggio, 1);
  assert.strictEqual(r.esempi[0].sito, 'snai'); assert.strictEqual(r.esempi[0].esito, 'AWAY'); assert.ok(r.esempi[0].edgePct > 5 && r.esempi[0].edgePct < 8);
  assert.ok(r.margineMedianoPinnacle > 3 && r.margineMedianoPinnacle < 4.5); assert.strictEqual(r.siti.snai, 3);
  // la richiesta: un solo giro, sport e mercato ammessi, content=match
  let params = null, calls = 0; const pool = { query: async () => ({ rows: [] }) };
  const http = { get: async (u, o) => { calls++; params = o.params; return { data: { odds: [rec('e1', { HOME: 1.45, AWAY: 2.95 })] }, headers: {} }; } };
  const env = { ODSS_API_KEY: 'k', MY_BOOKS: 'snai', ODSS_BOOKS: 'snai,netwin' };
  const out = await S.sportCheck(pool, { sport: 'tennis', market: 'moneyline' }, env, { http });
  assert.ok(out.ok && calls === 1 && params.sport === 'tennis' && params.market === 'moneyline' && params.content === 'match' && params.bookmakers === undefined && params.limit === 200);
  assert.strictEqual((await S.sportCheck(pool, { sport: 'calcio', market: 'moneyline' }, env, { http })).ok, false);
  assert.strictEqual((await S.sportCheck(pool, { sport: 'tennis', market: 'x; DROP' }, env, { http })).ok, false);
  assert.strictEqual(calls, 1, 'nessuna richiesta per valori non ammessi');
  console.log('prova tennis/basket: ok');
})().catch(e => { console.error(e); process.exit(1); });
