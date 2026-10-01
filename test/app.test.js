// Centro di controllo: controlli di salute, chiave nell'intestazione e pagina (con un finto browser) su dati reali.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const Module = require('module'), origLoad = Module._load;
Module._load = function (request) { if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } }; if (request === 'dotenv') return { config() {} }; return origLoad.apply(this, arguments); };
const view = require('../services/trackerView');
const ms = require('../services/milestones');
const { authorized } = require('../services/auth');

// --- chiave: nell'indirizzo O nell'intestazione, mai indovinabile per lunghezza
process.env.RUN_SECRET_KEY = 'segreta123';
const req = (query, header) => ({ query: query || {}, get: n => (n === 'x-run-key' ? header : undefined) });
assert.strictEqual(authorized(req({ key: 'segreta123' })), true);
assert.strictEqual(authorized(req({}, 'segreta123')), true);
assert.strictEqual(authorized(req({ key: 'sbagliata1' })), false); assert.strictEqual(authorized(req({})), false); assert.strictEqual(authorized(req({}, 'x')), false);
delete process.env.RUN_SECRET_KEY; assert.strictEqual(authorized(req({ key: '' })), false);   // chiave non impostata: nessun accesso, neanche con chiave vuota
console.log('chiave: ok');

// --- configurazione
const cfg = view.getConfig({ COMPETITIONS: 'SA,T1,XX', MIN_EDGE: '0.02', TELEGRAM_BOT_TOKEN: 't' });
assert.deepStrictEqual(cfg.competitions.map(c => c.code), ['SA', 'T1']); assert.strictEqual(cfg.minEdgePct, 2); assert.strictEqual(cfg.notify.telegram, true); assert.strictEqual(cfg.notify.whatsapp, false);
assert.strictEqual(cfg.competitions[1].source, 'The Odds API');
console.log('configurazione: ok');

// --- salute
const NOW = new Date('2026-10-05T10:00:00Z');
const mkPool = ({ run, oldPending = 0, noSchedule = false } = {}) => ({ query: async sql => {
  if (/FROM run_logs/.test(sql)) return { rows: run ? [run] : [] };
  if (/COUNT\(\*\)::int AS n FROM value_bets/.test(sql)) return { rows: [{ n: oldPending }] };
  if (/FROM league_schedule/.test(sql)) { if (noSchedule) throw new Error('relation "league_schedule" does not exist'); return { rows: [] }; }
  return { rows: [] }; } });
const okRun = { run_at: '2026-10-05T09:00:00Z', success: true, value_bets_found: 2, odds_api_requests: 3, error_message: null, log_text: 'Analisi completata. (crediti usati nel mese: 100, rimasti: 400).' };
(async () => {
  let h = await view.getHealth(mkPool({ run: okRun }), NOW);
  assert.strictEqual(h.todo.level, 'ok'); assert.ok(/Non devi fare niente/.test(h.todo.text));
  h = await view.getHealth(mkPool({ run: { ...okRun, run_at: '2026-10-03T09:00:00Z' } }), NOW);                       // ultimo giro 49 ore fa
  assert.strictEqual(h.todo.level, 'bad'); assert.ok(/cron-job\.org/.test(h.todo.text));
  // dopo le 11:20 ora italiana il giro di oggi deve esserci: se manca l'app lo dice subito, senza aspettare 26 ore
  h = await view.getHealth(mkPool({ run: { ...okRun, run_at: '2026-10-04T09:00:00Z' } }), NOW);                      // ultimo giro ieri, ora sono le 12:00 italiane
  assert.strictEqual(h.todo.level, 'bad'); assert.ok(/Il giro di oggi non è partito/.test(h.todo.title) && /sveglia/.test(h.todo.text));
  h = await view.getHealth(mkPool({ run: { ...okRun, run_at: '2026-10-04T09:00:00Z' } }), new Date('2026-10-05T08:00:00Z'));   // le 10:00 italiane: e' presto, nessun allarme
  assert.strictEqual(h.todo.level, 'ok');
  h = await view.getHealth(mkPool({ run: { ...okRun, run_at: '2026-10-05T07:30:00Z' } }), NOW);                      // giro manuale alle 9:30, ma niente giro delle 11:00
  assert.strictEqual(h.todo.level, 'bad');
  h = await view.getHealth(mkPool({ run: { ...okRun, run_at: '2026-10-05T08:55:00Z' } }), NOW);                      // giro delle 10:55 italiane circa: va bene
  assert.strictEqual(h.todo.level, 'ok');
  h = await view.getHealth(mkPool({ run: { ...okRun, success: false, error_message: 'HTTP 401' } }), NOW);
  assert.strictEqual(h.todo.level, 'bad'); assert.ok(/401/.test(h.todo.text));
  h = await view.getHealth(mkPool({ run: { ...okRun, log_text: 'x (crediti usati nel mese: 470, rimasti: 30).' } }), NOW);
  assert.ok(h.items.some(i => i.title === 'Crediti delle quote' && i.level === 'bad'));
  h = await view.getHealth(mkPool({ run: { ...okRun, log_text: "NOMI SQUADRA NON RICONOSCIUTI (mandami questa riga per aggiungerli): T1: Amed SK | G1: Volos FC" } }), NOW);
  const nm = h.items.find(i => i.title.startsWith('Nomi')); assert.ok(nm && nm.level === 'warn' && /T1: Amed SK/.test(nm.text) && !/mandami questa riga/.test(nm.text));
  h = await view.getHealth(mkPool({ run: okRun, oldPending: 3 }), NOW); assert.ok(h.items.some(i => i.title === 'Segnali senza risultato'));
  h = await view.getHealth(mkPool({ run: okRun, noSchedule: true }), NOW); assert.ok(h.items.some(i => /Risparmio crediti/.test(i.title)));
  h = await view.getHealth(mkPool({}), NOW); assert.strictEqual(h.todo.level, 'warn');                              // nessun giro mai registrato
  console.log('controlli di salute: ok');

  // --- pagina con finto browser e dati reali
  const sigRows = [{ id: 1, selection: 'away', bookmaker_odd: '4.20', bookmaker_name: 'Unibet', edge_pct: '5.4', recommended_stake: '2', status: 'won', result_score: '1-2', clv_pct: '3.1', league_code: 'T1', sharp_source: 'pinnacle', created_at: 'x', kickoff: '2026-10-09T17:00:00Z', home: 'Galatasaray SK', away: 'Fenerbahçe' }];
  const pool = { query: async sql => {
    if (/FROM value_bets vb JOIN fixtures/.test(sql)) return { rows: sigRows };
    if (/FROM run_logs/.test(sql)) return { rows: [okRun, { ...okRun, run_at: '2026-10-04T09:00:00Z', log_text: 'SEGNALE A vs B: x\nT1: quote non richieste, nessun credito speso.' }] };
    if (/FROM league_schedule/.test(sql)) return { rows: [{ league_code: 'T1', next_start: '2099-10-09T17:00:00Z', checked_at: 'x' }] };
    if (/COUNT\(\*\)::int AS n FROM value_bets/.test(sql)) return { rows: [{ n: 0 }] };
    if (/FROM value_bets/.test(sql)) return { rows: [{ odd: '4.20', status: 'won', edge_pct: '5.4', clv_pct: '3.1' }] };
    return { rows: [] }; } };
  const data = { '/api/tracker/overview': await view.getOverview(pool), '/api/tracker/health': await view.getHealth(pool, NOW), '/api/tracker/signals': await view.getSignals(pool, {}),
    '/api/tracker/runs': await view.getRuns(pool, 14), '/api/tracker/milestones': { settledNow: 34, rule: ms.RULE, targets: [100, 200, 300].map(x => ({ target: x, reached: false, progress: 34 })) }, '/api/tracker/config': view.getConfig({ COMPETITIONS: 'SA,T1' }) };
  const script = /<script>([\s\S]*)<\/script>/.exec(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8'))[1];
  const els = {}, calls = [], store = {};
  let downloads = 0;
  const el = id => els[id] || (els[id] = { id, innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, value: '', disabled: false, classList: { remove() {}, add() {} } });
  let confirmAnswer = true, status401 = false;
  const ctx = { console, document: { getElementById: el, querySelectorAll: () => [{ disabled: false }], createElement: () => ({ click() { downloads++; } }) },
    URL: { createObjectURL: () => 'blob:x' },
    localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
    confirm: () => confirmAnswer,
    fetch: async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', key: opts.headers && opts.headers['x-run-key'] });
      const base = url.split('?')[0];
      if (base === '/api/tracker/auth-check') return { ok: opts.headers['x-run-key'] === 'segreta123', status: opts.headers['x-run-key'] === 'segreta123' ? 200 : 401, json: async () => ({}) };
      if (base === '/api/run-daily') return status401 ? { ok: false, status: 401, json: async () => ({ error: 'Chiave non valida' }) } : { ok: true, status: 200, json: async () => ({ success: true, log: ['SEGNALE X vs Y: home a 3.00', 'T1: prossima partita il 2026-10-09: quote non richieste, nessun credito speso.'] }) };
      if (base === '/api/notify-test') return { ok: true, status: 200, json: async () => ({ success: true, configured: false, sent: false, missing: ['TELEGRAM_CHAT_ID'] }) };
      if (base === '/api/notify-chat-id') return { ok: true, status: 200, json: async () => ({ success: true, configured: true, chats: [{ id: '123456789', name: 'Christian' }] }) };
      if (base === '/api/tracker/export.csv') return { ok: true, status: 200, blob: async () => ({}), json: async () => { throw new Error('non e json'); } };
      if (base === '/api/settle-pending') return { ok: true, status: 200, json: async () => ({ success: true, settled: 2, stillPending: 1, tappe: [100] }) };
      if (base === '/api/weekly-report') return { ok: true, status: 200, json: async () => ({ success: true, text: 'Riepilogo\nriga due' }) };
      if (data[base]) return { ok: true, status: 200, json: async () => data[base] };
      return { ok: false, status: 404, json: async () => ({ error: 'non trovato' }) };
    } };
  vm.createContext(ctx); vm.runInContext(script, ctx);
  const tick = () => new Promise(r => setTimeout(r, 30));
  await tick();
  assert.ok(/Tutto in ordine/.test(els.todo.innerHTML) && /todo ok/.test(els.todo.className), els.todo.innerHTML);
  assert.ok(/Troppo presto/.test(els.verdict.innerHTML)); assert.ok(/1 su 300/.test(els.barText.textContent));
  assert.ok(/Giro automatico/.test(els.checks.innerHTML) && /Super Lig/.test(els.schedule.innerHTML));
  assert.ok(/Tappa 100/.test(els.milestones.innerHTML) && /34 su 100 segnali chiusi/.test(els.milestones.innerHTML) && /La regola della decisione/.test(els.milestones.innerHTML) && /prima di vedere i dati/.test(els.milestones.innerHTML));
  // tappe raggiunte: fotografia e decisione, tutto ripulito (nessun codice dai dati)
  const snap = ms.buildSnapshot(Array.from({ length: 300 }, (_, i) => ({ id: i, odd: 4 + (i % 3), status: i % 5 ? 'lost' : 'won', edge_pct: 2 + (i % 8), clv_pct: ((i % 11) - 4) * 1.1, est_prob: 0.2, league_code: i % 2 ? 'SA' : 'SP2', selection: 'home', sharp_source: 'pinnacle' })), { pendingNow: 3 });
  vm.runInContext('renderMilestones(' + JSON.stringify({ rule: ms.RULE, targets: [{ target: 100, reached: true, reachedAt: '2026-11-12T10:00:00Z', hash: 'abcdef1234', snapshot: snap, decision: null }, { target: 200, reached: false, progress: 150 },
    { target: 300, reached: true, reachedAt: '2026-12-20T10:00:00Z', hash: '<b>x</b>', snapshot: snap, decision: { level: 'none', title: 'Nessun vantaggio dimostrato', text: 'La fascia include lo zero.' } }] }) + ')', ctx);
  assert.ok(/Tappa 100<\/b> raggiunta il/.test(els.milestones.innerHTML) && /Impronta abcdef1234/.test(els.milestones.innerHTML) && /Vinte contro attese/.test(els.milestones.innerHTML));
  assert.ok(/callout none/.test(els.milestones.innerHTML) && /Nessun vantaggio dimostrato/.test(els.milestones.innerHTML) && /150 su 200/.test(els.milestones.innerHTML));
  assert.ok(!/<b>x<\/b>/.test(els.milestones.innerHTML));
  vm.runInContext('renderMilestones(null)', ctx); assert.ok(/schema\.sql/.test(els.milestones.innerHTML));
  console.log('Home: ok');
  vm.runInContext("show('signals')", ctx); await tick();
  assert.ok(/Punta su <b>Fenerbahçe<\/b>/.test(els.signals.innerHTML) && />4,20</.test(els.signals.innerHTML));   // quota con la virgola, all'italiana
  vm.runInContext("show('logs')", ctx); await tick(); assert.ok(/Giri|segnali/.test(els.runs.innerHTML) && /class="saving"/.test(els.runs.innerHTML));
  vm.runInContext("show('info')", ctx); await tick(); assert.ok(/Super Lig/.test(els.config.innerHTML) && /Non collegato/.test(els.config.innerHTML));
  console.log('Segnali, Log, Info: ok');
  // azioni: senza chiave non parte nulla
  vm.runInContext("show('actions')", ctx); assert.strictEqual(els.lockBox.style.display, 'block');
  const before = calls.length; await vm.runInContext("act('run')", ctx); assert.strictEqual(calls.filter(c => c.url.split('?')[0] === '/api/run-daily').length, 0); assert.ok(calls.length >= before);
  // chiave sbagliata e giusta
  el('keyInput'); el('lockMsg');
  els.keyInput.value = 'sbagliata'; await vm.runInContext("unlock()", ctx); assert.ok(/non valida/.test(els.lockMsg.textContent)); assert.ok(!store.crmKey);
  els.keyInput.value = 'segreta123'; await vm.runInContext("unlock()", ctx); assert.strictEqual(store.crmKey, 'segreta123'); assert.strictEqual(els.actionsBox.style.display, 'block');
  // azioni con chiave nell'intestazione (mai nell'indirizzo)
  confirmAnswer = false; await vm.runInContext("act('run')", ctx); assert.strictEqual(calls.filter(c => c.url.split('?')[0] === '/api/run-daily').length, 0);   // conferma rifiutata: non parte
  confirmAnswer = true; await vm.runInContext("act('run')", ctx);
  const run = calls.find(c => c.url.split('?')[0] === '/api/run-daily'); assert.ok(run && run.method === 'POST' && run.key === 'segreta123' && !run.url.includes('key=') && /detail=1/.test(run.url));
  assert.ok(/class="signal"/.test(els.result.innerHTML) && /class="saving"/.test(els.result.innerHTML));
  await vm.runInContext("act('settle')", ctx); assert.ok(/registrati: 2/.test(els.result.innerHTML) && /Tappa raggiunta: 100/.test(els.result.innerHTML));
  const dl0 = downloads; await vm.runInContext("act('csv')", ctx);
  const csvCall = calls.find(c => c.url === '/api/tracker/export.csv'); assert.ok(csvCall && csvCall.key === 'segreta123' && !csvCall.url.includes('key='));
  assert.strictEqual(downloads, dl0 + 1); assert.ok(/File scaricato/.test(els.result.innerHTML));
  await vm.runInContext("act('weekly')", ctx); assert.ok(/Riepilogo<br>riga due/.test(els.result.innerHTML));
  await vm.runInContext("act('tgtest')", ctx); assert.ok(/Mancano su Render: TELEGRAM_CHAT_ID/.test(els.result.innerHTML));
  await vm.runInContext("act('tgid')", ctx); assert.ok(/chat id è <b>123456789<\/b> \(Christian\)/.test(els.result.innerHTML));
  // chiave scaduta/cambiata sul server: si richiede di nuovo
  status401 = true; confirmAnswer = true; await vm.runInContext("act('run')", ctx); assert.ok(!store.crmKey); assert.ok(/inseriscila di nuovo/.test(els.lockMsg.textContent));
  console.log('Azioni (chiave, conferma, risultati, chiave scaduta): ok');
  console.log('TUTTI I TEST app OK');
})().catch(e => { console.error(e); process.exit(1); });
