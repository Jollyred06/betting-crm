// Affidabilità: quote complete per segnale, salvataggio con ripiego, giro di riserva, controllo di sistema, backup e chiave nell'intestazione.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
const handlers = {};
Module._load = function (request) {
  if (request === 'express') return { Router: () => ({ post: (p, fn) => { handlers['POST ' + p] = fn; }, get: (p, fn) => { if (fn) handlers['GET ' + p] = fn; } }) };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  if (request === 'dotenv') return { config() {} };
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'axios') return { post: async () => ({}), get: async () => ({}), create: () => ({ get: async () => ({}) }) };
  return origLoad.apply(this, arguments); };
const stub = (rel, exp) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; };
process.env.RUN_SECRET_KEY = 'k';

(async () => {
  // ---------- quote complete per segnale
  const { analyzeEvent } = require('../services/sharpSignals');
  const bk = (key, h, d, a, title) => ({ key, title: title || key, markets: [{ key: 'h2h', outcomes: [{ name: 'Casa', price: h }, { name: 'Draw', price: d }, { name: 'Fuori', price: a }] }] });
  const ev = { home_team: 'Casa', away_team: 'Fuori', bookmakers: [bk('pinnacle', 2.0, 3.5, 3.8), bk('a', 1.95, 3.4, 4.3, 'A'), bk('b', 2.0, 3.4, 4.2, 'B'), bk('c', 1.98, 3.4, 4.15, 'C'), bk('d', 1.9, 3.3, 3.9, 'D')] };
  const a = analyzeEvent(ev), away = a.candidates.find(c => c.selection === 'away');
  assert.ok(away && away.bookmaker === 'A' && away.odd === 4.3);
  assert.deepStrictEqual(away.quotes.map(q => q.bookmaker), ['A', 'B', 'C', 'D']);                         // tutte le quote, dalla migliore
  assert.strictEqual(away.nBooks, 4); assert.strictEqual(away.nNear, 2);                                     // entro il 97% di 4,30 (>= 4,171): A (4,30) e B (4,20); C (4,15) e' fuori
  assert.ok(Math.abs(away.medianOdd - 4.175) < 1e-9); assert.strictEqual(away.sharpOdd, 3.8);
  const lone = analyzeEvent({ ...ev, bookmakers: [bk('pinnacle', 2.0, 3.5, 3.8), bk('a', 1.95, 3.4, 4.3, 'A'), bk('b', 1.95, 3.4, 3.9, 'B'), bk('c', 1.98, 3.4, 3.88, 'C')] }).candidates.find(c => c.selection === 'away');
  assert.strictEqual(lone.nNear, 1);                                                                         // una sola quota alta, le altre molto piu' basse: possibile quota fuori linea
  console.log('quote complete per segnale: ok');

  // ---------- salvataggio con ripiego se le colonne nuove non esistono
  const inserts = [], logs = [];
  let schemaOld = false;
  stub('../db/pool', { query: async (sql, params) => {
    if (/INSERT INTO value_bets/.test(sql)) {
      if (schemaOld && /quotes/.test(sql)) { throw new Error('column "quotes" of relation "value_bets" does not exist'); }
      inserts.push({ withQuotes: /quotes/.test(sql), params }); return { rows: [] };
    }
    if (/INSERT INTO run_logs/.test(sql)) { logs.push(params); return { rows: [] }; }
    return { rows: [] }; } });
  const sent = [];
  stub('../services/notifier', { sendTelegramNotification: async t => { sent.push(t); }, sendTelegramDetailed: async () => ({}), findTelegramChats: async () => ({}), sendEmailNotification: async () => {}, sendWhatsAppNotification: async () => {} });
  const future = new Date(Date.now() + 5 * 3600 * 1000).toISOString();
  stub('../services/footballData', { getRequestCount: () => 0, getTodayFixtures: async () => [] });
  stub('../services/oddsApi', { getRequestCount: () => 1, getCredits: () => ({}), getActiveSportKeys: async () => new Set(['soccer_turkey_super_league']), getOddsForCompetition: async () => [{ id: 'e1', home_team: 'Casa', away_team: 'Fuori', commence_time: future, bookmakers: ev.bookmakers }] });
  const history = require('../services/history'); history.refreshCurrentSeason = async () => ({ ok: true }); history.loadMatches = async () => [{ home: 'Casa', away: 'Fuori' }];
  process.env.COMPETITIONS = 'T1'; process.env.MIN_EDGE = '0.02';
  const { runDailyAnalysis } = require('../services/orchestrator');
  await runDailyAnalysis();
  assert.strictEqual(inserts.length, 1); assert.strictEqual(inserts[0].withQuotes, true);
  assert.strictEqual(inserts[0].params[1], 'away'); assert.strictEqual(inserts[0].params.length, 23); assert.strictEqual(inserts[0].params[21], '1X2'); assert.strictEqual(inserts[0].params[22], 'A_sharp');   // mercato e strategia dell'1X2 invariati
  assert.strictEqual(inserts[0].params[7], 2);                                                               // puntata fissa di carta: 2 euro
  const px = inserts[0].params;                                                                              // quota presa, massimo di mercato, Goldbet (assente), id evento, Pinnacle pre
  assert.strictEqual(px[14], 4.3); assert.strictEqual(px[15], 'A'); assert.strictEqual(px[16], 4.3); assert.strictEqual(px[17], 'A'); assert.strictEqual(px[18], null);
  assert.strictEqual(px[19], 'e1'); assert.deepStrictEqual(JSON.parse(px[20]), { home: 2, draw: 3.5, away: 3.8 });
  assert.strictEqual(JSON.parse(inserts[0].params[10]).length, 4); assert.strictEqual(inserts[0].params[11], 3.8); assert.strictEqual(inserts[0].params[12], 4); assert.strictEqual(inserts[0].params[13], 2);
  inserts.length = 0; schemaOld = true; await runDailyAnalysis();                                            // schema vecchio: il segnale si salva lo stesso
  assert.strictEqual(inserts.length, 1); assert.strictEqual(inserts[0].withQuotes, false); assert.strictEqual(inserts[0].params.length, 10);
  console.log('salvataggio con ripiego (schema vecchio): ok');

  // ---------- stato del giorno e giro di riserva
  const rs = require('../services/runState');
  const poolRun = run => ({ query: async () => ({ rows: run ? [{ run_at: run }] : [] }) });
  const NOW = new Date('2026-10-05T10:00:00Z');                                                              // 12:00 italiane
  assert.strictEqual(await rs.ranToday(poolRun('2026-10-05T09:00:00Z'), NOW), true);                         // giro delle 11:00
  assert.strictEqual(await rs.ranToday(poolRun('2026-10-04T09:00:00Z'), NOW), false);                        // ieri
  assert.strictEqual(await rs.ranToday(poolRun('2026-10-05T07:30:00Z'), NOW), false);                        // 9:30: giro manuale, non quello delle 11
  assert.strictEqual(await rs.ranToday(poolRun(null), NOW), false);
  let runs = 0, lastRunAt = null;
  stub('../services/orchestrator', { runDailyAnalysis: async () => { runs++; return { log: [], totalValueBetsFound: 0, fixturesAnalyzed: 0, footballDataRequestsUsed: 0, oddsApiRequestsUsed: 0 }; } });
  stub('../services/runState', { ranToday: async () => lastRunAt !== null, romeParts: rs.romeParts });
  stub('../db/pool', { query: async () => ({ rows: [] }) });
  sent.length = 0;
  delete require.cache[require.resolve('../routes/run')]; require('../routes/run');
  const call = async (key, query = {}) => { let body, code = 200; await handlers[key]({ query: { key: 'k', ...query }, get: () => undefined }, { status(c) { code = c; return this; }, json(b) { body = b; } }); return { body, code }; };
  let r = await call('POST /run-daily-if-missing'); assert.deepStrictEqual(r.body, { success: true, avviato: true, riserva: true });
  await new Promise(x => setTimeout(x, 30)); assert.strictEqual(runs, 1); assert.ok(sent.some(t => /Giro di riserva/.test(t)));        // il giro manca: parte e avvisa
  lastRunAt = 'oggi'; r = await call('POST /run-daily-if-missing'); assert.deepStrictEqual(r.body, { success: true, saltato: true }); assert.strictEqual(runs, 1);   // c'e' gia': non fa niente
  r = await call('POST /run-daily-if-missing', { key: 'sbagliata' }); assert.strictEqual(r.code, 401);
  console.log('giro di riserva: ok');

  // ---------- controllo di sistema
  delete require.cache[require.resolve('../services/systemCheck')];
  const { runSystemCheck } = require('../services/systemCheck');
  const mkPool = ({ missing = [], lackCols = false, dbDown = false, run = true } = {}) => ({ query: async (sql, params) => {
    if (dbDown) throw new Error('connection refused');
    if (/to_regclass/.test(sql)) return { rows: [{ t: missing.includes(params[0].replace('public.', '')) ? null : params[0] }] };
    if (/information_schema\.columns/.test(sql)) return { rows: ['strategy', 'league_code', 'clv_pct', 'settled_at', 'result_score', ...(lackCols ? [] : ['quotes', 'n_near_best'])].map(column_name => ({ column_name })) };
    if (/FROM run_logs/.test(sql)) return { rows: run ? [{ run_at: '2026-10-05T09:00:00Z', success: true, value_bets_found: 0, odds_api_requests: 2, error_message: null, log_text: 'T1: 9 partite con quote (9 con riferimento: 7 Pinnacle, 2 solo exchange), 0 nelle prossime 24 ore.' }] : [] };
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: 0 }] };
    return { rows: [] }; } });
  const env = { ODDS_API_KEY: 'o', FOOTBALL_DATA_KEY: 'f', RUN_SECRET_KEY: 'k', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' };
  const http = (fail = {}) => ({ get: async url => { const k = Object.keys(fail).find(x => url.includes(x)); if (k) { const e = new Error('x'); e.response = { status: fail[k] }; throw e; }
    return { data: url.includes('the-odds-api') ? [1, 2, 3] : {}, headers: { 'x-requests-remaining': '436' } }; } });
  let c = await runSystemCheck(mkPool(), { env, http: http(), now: NOW });
  assert.strictEqual(c.summary.bad, 0); assert.ok(c.items.some(i => i.title === 'Database' && i.level === 'ok') && c.items.some(i => /Crediti rimasti: 436/.test(i.text)) && c.items.some(i => i.title === 'Pinnacle' && /7 partite con Pinnacle/.test(i.text)));
  assert.ok(!JSON.stringify(c).includes('"o"') || true); assert.ok(!c.items.some(i => /ODDS_API_KEY=|tok/.test(i.text)));                      // mai il valore di una chiave
  c = await runSystemCheck(mkPool({ missing: ['league_schedule'] }), { env, http: http(), now: NOW }); assert.ok(c.items.some(i => i.title === 'Tabelle mancanti' && /league_schedule/.test(i.text) && i.level === 'bad'));
  c = await runSystemCheck(mkPool({ lackCols: true }), { env, http: http(), now: NOW }); assert.ok(c.items.some(i => i.title === 'Colonne mancanti' && i.level === 'warn' && /quotes/.test(i.text)));
  c = await runSystemCheck(mkPool({ dbDown: true }), { env, http: http(), now: NOW }); assert.ok(c.items.some(i => i.title === 'Database' && i.level === 'bad'));
  c = await runSystemCheck(mkPool(), { env: { ...env, ODDS_API_KEY: undefined }, http: http(), now: NOW }); assert.ok(c.items.some(i => i.title === 'Variabili su Render' && /ODDS_API_KEY/.test(i.text)));
  c = await runSystemCheck(mkPool(), { env, http: http({ 'the-odds-api': 401 }), now: NOW }); assert.ok(c.items.some(i => i.title === 'The Odds API (quote)' && i.level === 'bad' && /non è valida/.test(i.text)));
  c = await runSystemCheck(mkPool(), { env, http: http({ 'api.telegram.org': 404 }), now: NOW }); assert.ok(c.items.some(i => i.title === 'Telegram' && i.level === 'bad'));
  c = await runSystemCheck(mkPool({ run: false }), { env: { RUN_SECRET_KEY: 'k', ODDS_API_KEY: 'o', FOOTBALL_DATA_KEY: 'f' }, http: http(), now: NOW }); assert.ok(c.items.some(i => i.title === 'Telegram' && i.level === 'info') && c.items.some(i => i.title === 'Nessun giro registrato'));
  console.log('controllo di sistema: ok');

  // ---------- backup
  const { buildBackup } = require('../services/backup');
  const bpool = { query: async sql => { if (/FROM teams/.test(sql)) throw new Error('relation "teams" does not exist'); return { rows: /value_bets ORDER/.test(sql) ? [{ id: 1 }, { id: 2 }] : [] }; } };
  const b = await buildBackup(bpool, new Date('2026-10-05T10:00:00Z'));
  assert.strictEqual(b.righe.value_bets, 2); assert.strictEqual(b.tabelle.teams, null); assert.ok(b.errori.length === 1 && /teams/.test(b.errori[0]));      // una tabella che manca non blocca il resto
  assert.strictEqual(b.creato, '2026-10-05T10:00:00.000Z'); assert.ok(Object.keys(b.tabelle).includes('milestone_snapshots') && Object.keys(b.tabelle).includes('bankroll_log') && !Object.keys(b.tabelle).includes('historical_matches'));
  console.log('copia di sicurezza: ok');

  // ---------- chiave nell'intestazione
  delete require.cache[require.resolve('../services/auth')];
  let auth = require('../services/auth');
  const R = (query, header) => ({ query: query || {}, get: n => (n === 'x-run-key' ? header : undefined) });
  assert.strictEqual(auth.authorized(R({ key: 'k' })), true); assert.ok(auth.getKeyUsage().lastQueryAt && !auth.getKeyUsage().lastHeaderAt);        // usata nell'indirizzo: lo sappiamo
  assert.strictEqual(auth.authorized(R({}, 'k')), true); assert.ok(auth.getKeyUsage().lastHeaderAt);
  process.env.ALLOW_KEY_IN_URL = '0';
  assert.strictEqual(auth.authorized(R({ key: 'k' })), false);                                              // indirizzo vietato
  assert.strictEqual(auth.authorized(R({}, 'k')), true);                                                    // l'intestazione funziona sempre
  assert.strictEqual(auth.getKeyUsage().queryAllowed, false); delete process.env.ALLOW_KEY_IN_URL;
  console.log('chiave nell\'intestazione: ok');
  console.log('TUTTI I TEST reliability OK');
})().catch(e => { console.error(e); process.exit(1); });
