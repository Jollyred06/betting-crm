// Le risposte chiamate da cron-job.org devono essere minuscole (il servizio scarta quelle grandi e segna il giro come fallito).
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
const handlers = {};
Module._load = function (request) {
  if (request === 'express') return { Router: () => ({ post: (p, fn) => { handlers[p] = fn; }, get() {} }) };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  if (request === 'dotenv') return { config() {} };
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'axios') return { post: async () => ({}), get: async () => ({}), create: () => ({ get: async () => ({}) }) };
  return origLoad.apply(this, arguments); };
process.env.RUN_SECRET_KEY = 'k';
const stub = (rel, exp) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; };
const bigLog = Array.from({ length: 40 }, (_, i) => `T${i}: 9 partite con quote (9 con riferimento: 9 Pinnacle, 0 solo exchange), 0 nelle prossime 24 ore, 0 riconosciute, 0 con riferimento nelle prossime ore.`);
let runs = 0, failNext = false, slow = false;
stub('../services/orchestrator', { runDailyAnalysis: async () => { runs++; if (slow) await new Promise(x => setTimeout(x, 60)); if (failNext) { failNext = false; throw new Error('boom'); } return ({ log: bigLog, totalValueBetsFound: 3, fixturesAnalyzed: 9, footballDataRequestsUsed: 4, oddsApiRequestsUsed: 6 }); } });
stub('../services/weeklyReport', { buildStats: async () => ({ week: { x: 1 }, total: { x: 2 }, strong: { x: 3 }, text: 'riga\n'.repeat(80) }) });
require('../routes/run');
const call = async (path, query) => { let body, code = 200; await handlers[path]({ query: { key: 'k', ...query }, get: () => undefined }, { status(c) { code = c; return this; }, json(b) { body = b; } }); return { body, code, size: JSON.stringify(body).length }; };
(async () => {
  let r = await call('/run-daily', {});
  assert.strictEqual(r.code, 200); assert.ok(r.size < 100, 'risposta troppo grande: ' + r.size);        // cron-job.org: poche centinaia di byte al massimo
  assert.deepStrictEqual(r.body, { success: true, avviato: true });                                      // risponde subito, il lavoro continua in background
  await new Promise(x => setTimeout(x, 20)); assert.strictEqual(runs, 1);                                // ...e il giro e' partito davvero
  // errore nel giro in background: nessun crash del server (resta nei log e nell'avviso Telegram)
  failNext = true; r = await call('/run-daily', {}); await new Promise(x => setTimeout(x, 20)); assert.strictEqual(r.code, 200); assert.strictEqual(runs, 2);
  // due chiamate ravvicinate: il secondo giro non parte in parallelo
  slow = true; await call('/run-daily', {}); const r2 = await call('/run-daily', {}); assert.deepStrictEqual(r2.body, { success: true, giaInCorso: true });
  await new Promise(x => setTimeout(x, 120)); slow = false; assert.strictEqual(runs, 3);
  r = await call('/run-daily', { detail: '1' }); assert.ok(r.body.log.length === 40 && r.size > 3000);       // l'app chiede il dettaglio e aspetta
  r = await call('/weekly-report', {}); assert.deepStrictEqual(r.body, { success: true });
  r = await call('/weekly-report', { detail: '1' }); assert.ok(/riga/.test(r.body.text));
  r = await call('/run-daily', { key: 'sbagliata' }); assert.strictEqual(r.code, 401);
  console.log('risposte piccole per cron-job.org (e dettaglio per l\'app): ok');
  console.log('TUTTI I TEST cronResponse OK');
})().catch(e => { console.error(e); process.exit(1); });
