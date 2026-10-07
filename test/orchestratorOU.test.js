// Giro giornaliero con Over/Under spento e acceso: spento non cambia nulla, acceso salva segnali separati (market OU2.5, strategy A_sharp_ou).
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
Module._load = function (request) {
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  if (request === 'dotenv') return { config() {} };
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'axios') return { post: async () => ({}), get: async () => ({}), create: () => ({ get: async () => ({}) }) };
  return origLoad.apply(this, arguments); };
const stub = (rel, exp) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; };

(async () => {
  const h = (key, hh, d, a, title) => ({ key, title: title || key, markets: [{ key: 'h2h', outcomes: [{ name: 'Casa', price: hh }, { name: 'Draw', price: d }, { name: 'Fuori', price: a }] }] });
  const t = (b, over, under) => { b.markets.push({ key: 'totals', outcomes: [{ name: 'Over', price: over, point: 2.5 }, { name: 'Under', price: under, point: 2.5 }] }); return b; };
  const books = [t(h('pinnacle', 2.0, 3.5, 3.8), 1.9, 1.95), t(h('a', 1.95, 3.4, 4.3, 'A'), 1.85, 1.9), t(h('b', 2.0, 3.4, 4.2, 'B'), 1.86, 1.9), t(h('c', 1.98, 3.4, 4.15, 'C'), 2.05, 1.8)];
  const inserts = [];
  stub('../db/pool', { query: async (sql, params) => { if (/INSERT INTO value_bets/.test(sql)) inserts.push(params); return { rows: [] }; } });
  stub('../services/notifier', { sendTelegramNotification: async () => {}, sendTelegramDetailed: async () => ({}), findTelegramChats: async () => ({}), sendEmailNotification: async () => {}, sendWhatsAppNotification: async () => {} });
  stub('../services/footballData', { getRequestCount: () => 0, getTodayFixtures: async () => [] });
  const future = new Date(Date.now() + 5 * 3600 * 1000).toISOString();
  stub('../services/oddsApi', { getRequestCount: () => 1, getCredits: () => ({}), getActiveSportKeys: async () => new Set(['soccer_turkey_super_league']),
    totalsEnabled: () => process.env.TOTALS_ENABLED === '1',
    getOddsForCompetition: async () => [{ id: 'e1', home_team: 'Casa', away_team: 'Fuori', commence_time: future, bookmakers: books }] });
  const history = require('../services/history'); history.refreshCurrentSeason = async () => ({ ok: true }); history.loadMatches = async () => [{ home: 'Casa', away: 'Fuori' }];
  process.env.COMPETITIONS = 'T1'; process.env.MIN_EDGE = '0.02';
  const { runDailyAnalysis } = require('../services/orchestrator');

  delete process.env.TOTALS_ENABLED;
  await runDailyAnalysis();
  const off = inserts.splice(0);
  assert.ok(off.length >= 1 && off.every(p => p[21] === '1X2' && p[22] === 'A_sharp'), 'spento: solo 1X2');
  console.log('Over/Under spento: ok (' + off.length + ' segnali 1X2)');

  process.env.TOTALS_ENABLED = '1';
  await runDailyAnalysis();
  const on = inserts.splice(0), ouRows = on.filter(p => p[22] === 'A_sharp_ou'), x2 = on.filter(p => p[22] === 'A_sharp');
  assert.strictEqual(x2.length, off.length, 'i segnali 1X2 restano gli stessi');
  assert.ok(ouRows.length >= 1 && ouRows.every(p => p[21] === 'OU2.5' && (p[1] === 'over' || p[1] === 'under')));
  assert.strictEqual(ouRows[0][1], 'over'); assert.strictEqual(ouRows[0][2], 2.05); assert.strictEqual(ouRows[0][19], 'e1');
  console.log('Over/Under acceso: ok (' + ouRows.length + ' segnali Over/Under, ' + x2.length + ' segnali 1X2)');
  console.log('TUTTI I TEST orchestratorOU OK');
})().catch(e => { console.error(e); process.exit(1); });
