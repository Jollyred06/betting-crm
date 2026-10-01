// Avvisi Telegram: testo del messaggio, invio con un finto Telegram, ricerca del chat id, e avviso dopo il salvataggio dei segnali.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
const sent = []; let telegramFail = null, updates = { result: [] };
const fakeAxios = { post: async (url, body) => { if (telegramFail) { const e = new Error('Request failed'); e.response = { data: { description: telegramFail } }; throw e; } sent.push({ url, body }); return {}; },
  get: async url => { if (/getUpdates/.test(url)) return { data: updates }; throw new Error('rete'); } };
Module._load = function (request) {
  if (request === 'axios') return fakeAxios;
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'dotenv') return { config() {} };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  return origLoad.apply(this, arguments); };
const { formatSignalsMessage } = require('../services/signalMessage');
const notifier = require('../services/notifier');

(async () => {
  // --- testo del messaggio
  const s = (over = {}) => ({ code: 'T1', selection: 'away', home: 'Brighton & Hove', away: 'Fenerbahçe <SK>', odd: 4.2, bookmaker: 'Unibet', edge: 0.054, kickoff: '2026-10-03T17:00:00Z', ...over });
  const one = formatSignalsMessage([s()]);
  assert.ok(/1 nuovo segnale/.test(one) && /Brighton &amp; Hove/.test(one) && /Fenerbahçe &lt;SK&gt;/.test(one) && !/<SK>/.test(one));   // nomi ripuliti: non rompono il messaggio
  assert.ok(/Punta su <b>Fenerbahçe &lt;SK&gt;<\/b> a <b>4.20<\/b> \(Unibet\) · vantaggio \+5.4%/.test(one));
  assert.ok(/19:00|sab 3 ott/.test(one));                                           // orario italiano (17:00 UTC = 19:00)
  assert.ok(/Super Lig \(Turchia\)/.test(one) && /senza soldi veri/.test(one));
  const many = formatSignalsMessage(Array.from({ length: 13 }, (_, i) => s({ home: 'Casa' + i })), { max: 10 });
  assert.ok(/13 nuovi segnali/.test(many) && /altri 3: aprili nell'app/.test(many) && !/Casa12/.test(many));
  assert.ok(/Pareggio/.test(formatSignalsMessage([s({ selection: 'draw' })])));
  console.log('testo del messaggio: ok');

  // --- invio
  delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHAT_ID;
  let r = await notifier.sendTelegramDetailed('x'); assert.deepStrictEqual(r, { configured: false, sent: false, missing: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'] }); assert.strictEqual(sent.length, 0);
  process.env.TELEGRAM_BOT_TOKEN = 'tok'; r = await notifier.sendTelegramDetailed('x'); assert.deepStrictEqual(r.missing, ['TELEGRAM_CHAT_ID']);
  process.env.TELEGRAM_CHAT_ID = '42'; r = await notifier.sendTelegramDetailed('ciao'); assert.strictEqual(r.sent, true);
  assert.ok(/bottok\/sendMessage/.test(sent[0].url) && sent[0].body.chat_id === '42' && sent[0].body.parse_mode === 'HTML');
  telegramFail = 'Forbidden: bot was blocked by the user'; r = await notifier.sendTelegramDetailed('x'); assert.strictEqual(r.sent, false); assert.ok(/blocked/.test(r.error));
  await notifier.sendTelegramNotification('x');            // un errore di invio non lancia mai eccezioni: l'analisi non si ferma
  telegramFail = null;
  console.log('invio Telegram: ok');

  // --- ricerca del chat id
  updates = { result: [{ message: { chat: { id: 123456789, first_name: 'Christian', type: 'private' } } }, { message: { chat: { id: 123456789, first_name: 'Christian' } } }] };
  let c = await notifier.findTelegramChats(); assert.deepStrictEqual(c.chats, [{ id: '123456789', name: 'Christian' }]);      // senza doppioni
  updates = { result: [] }; c = await notifier.findTelegramChats(); assert.deepStrictEqual(c.chats, []);
  delete process.env.TELEGRAM_BOT_TOKEN; c = await notifier.findTelegramChats(); assert.strictEqual(c.configured, false);
  console.log('ricerca chat id: ok');

  // --- il giro giornaliero avvisa solo se ci sono segnali NUOVI, e un errore del giro manda un avviso
  process.env.TELEGRAM_BOT_TOKEN = 'tok'; process.env.TELEGRAM_CHAT_ID = '42'; sent.length = 0;
  const stub = (rel, exp) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; };
  const inserted = []; let failRun = false; let dupAll = false;
  stub('../db/pool', { query: async (sql, params) => {
    if (/INSERT INTO value_bets/.test(sql)) { inserted.push(params); return { rows: [] }; }
    if (/SELECT 1 FROM value_bets WHERE fixture_id/.test(sql)) { if (failRun) throw new Error('database: connessione persa'); return { rows: dupAll ? [{}] : [] }; }
    return { rows: [] }; } });
  const future = new Date(Date.now() + 5 * 3600 * 1000).toISOString();
  const bk = (key, h, d, a, title) => ({ key, title: title || key, markets: [{ key: 'h2h', outcomes: [{ name: 'Galatasaray SK', price: h }, { name: 'Draw', price: d }, { name: 'Fenerbahçe', price: a }] }] });
  const ev = { id: 'e1', home_team: 'Galatasaray SK', away_team: 'Fenerbahçe', commence_time: future, bookmakers: [bk('pinnacle', 2, 3.5, 3.8), bk('williamhill', 1.95, 3.4, 3.7), bk('betclic', 2.05, 3.45, 3.75), bk('unibet_eu', 1.98, 3.45, 4.2, 'Unibet')] };
  stub('../services/footballData', { getRequestCount: () => 0, getTodayFixtures: async () => [] });
  stub('../services/oddsApi', { getRequestCount: () => 1, getCredits: () => ({}), getActiveSportKeys: async () => new Set(['soccer_turkey_super_league']), getOddsForCompetition: async () => [ev] });
  const history = require('../services/history'); history.refreshCurrentSeason = async () => ({ ok: true }); history.loadMatches = async () => [{ home: 'Galatasaray', away: 'Fenerbahce' }];
  process.env.COMPETITIONS = 'T1'; process.env.MIN_EDGE = '0.02';
  const { runDailyAnalysis } = require('../services/orchestrator');
  await runDailyAnalysis();
  assert.strictEqual(inserted.length, 1); assert.strictEqual(sent.length, 1);
  assert.ok(/1 nuovo segnale/.test(sent[0].body.text) && /Fenerbahçe/.test(sent[0].body.text) && /4\.20/.test(sent[0].body.text));
  sent.length = 0; dupAll = true; inserted.length = 0; await runDailyAnalysis();                    // stesso segnale già salvato: nessun secondo messaggio
  assert.strictEqual(inserted.length, 0); assert.strictEqual(sent.length, 0);
  failRun = true; dupAll = false;                                                                      // giro fallito a meta': avviso
  await runDailyAnalysis().then(() => assert.fail('doveva lanciare'), () => {});
  assert.strictEqual(sent.length, 1); assert.ok(/Il giro giornaliero è fallito/.test(sent[0].body.text) && /connessione persa/.test(sent[0].body.text));
  console.log('avvisi dopo il giro (nuovi segnali, nessun doppione, errore): ok');
  console.log('TUTTI I TEST notify OK');
})().catch(e => { console.error(e); process.exit(1); });
