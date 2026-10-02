// App unica: controlli di salute, chiave, e tutta la pagina (Home, Segnali, Strategie, Bankroll, Altro) con un finto browser su dati reali.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const Module = require('module'), origLoad = Module._load;
Module._load = function (request) { if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } }; if (request === 'dotenv') return { config() {} }; return origLoad.apply(this, arguments); };
const view = require('../services/trackerView');
const ms = require('../services/milestones');
const { authorized } = require('../services/auth');

// --- chiave: nell'indirizzo O nell'intestazione
process.env.RUN_SECRET_KEY = 'segreta123';
const req = (query, header) => ({ query: query || {}, get: n => (n === 'x-run-key' ? header : undefined) });
assert.strictEqual(authorized(req({ key: 'segreta123' })), true); assert.strictEqual(authorized(req({}, 'segreta123')), true);
assert.strictEqual(authorized(req({ key: 'sbagliata1' })), false); assert.strictEqual(authorized(req({})), false); assert.strictEqual(authorized(req({}, 'x')), false);
delete process.env.RUN_SECRET_KEY; assert.strictEqual(authorized(req({ key: '' })), false);
console.log('chiave: ok');

const cfg = view.getConfig({ COMPETITIONS: 'SA,T1,XX', MIN_EDGE: '0.02', TELEGRAM_BOT_TOKEN: 't' });
assert.deepStrictEqual(cfg.competitions.map(c => c.code), ['SA', 'T1']); assert.strictEqual(cfg.minEdgePct, 2); assert.strictEqual(cfg.notify.telegram, true); assert.strictEqual(cfg.notify.whatsapp, false); assert.strictEqual(cfg.competitions[1].source, 'The Odds API');
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
  let h = await view.getHealth(mkPool({ run: okRun }), NOW); assert.strictEqual(h.todo.level, 'ok'); assert.ok(/Non devi fare niente/.test(h.todo.text));
  h = await view.getHealth(mkPool({ run: { ...okRun, run_at: '2026-10-03T09:00:00Z' } }), NOW); assert.strictEqual(h.todo.level, 'bad'); assert.ok(/cron-job\.org/.test(h.todo.text));
  h = await view.getHealth(mkPool({ run: { ...okRun, run_at: '2026-10-04T09:00:00Z' } }), NOW); assert.strictEqual(h.todo.level, 'bad'); assert.ok(/Il giro di oggi non è partito/.test(h.todo.title) && /sveglia/.test(h.todo.text));
  h = await view.getHealth(mkPool({ run: { ...okRun, run_at: '2026-10-04T09:00:00Z' } }), new Date('2026-10-05T08:00:00Z')); assert.strictEqual(h.todo.level, 'ok');
  h = await view.getHealth(mkPool({ run: { ...okRun, run_at: '2026-10-05T07:30:00Z' } }), NOW); assert.strictEqual(h.todo.level, 'bad');
  h = await view.getHealth(mkPool({ run: { ...okRun, run_at: '2026-10-05T08:55:00Z' } }), NOW); assert.strictEqual(h.todo.level, 'ok');
  h = await view.getHealth(mkPool({ run: { ...okRun, success: false, error_message: 'HTTP 401' } }), NOW); assert.strictEqual(h.todo.level, 'bad'); assert.ok(/401/.test(h.todo.text));
  h = await view.getHealth(mkPool({ run: { ...okRun, log_text: 'x (crediti usati nel mese: 470, rimasti: 30).' } }), NOW); assert.ok(h.items.some(i => i.title === 'Crediti delle quote' && i.level === 'bad'));
  h = await view.getHealth(mkPool({ run: { ...okRun, log_text: 'NOMI SQUADRA NON RICONOSCIUTI (mandami questa riga per aggiungerli): T1: Amed SK | G1: Volos FC' } }), NOW);
  const nm = h.items.find(i => i.title.startsWith('Nomi')); assert.ok(nm && nm.level === 'warn' && /T1: Amed SK/.test(nm.text) && !/mandami questa riga/.test(nm.text));
  h = await view.getHealth(mkPool({ run: okRun, oldPending: 3 }), NOW); assert.ok(h.items.some(i => i.title === 'Segnali senza risultato'));
  h = await view.getHealth(mkPool({ run: okRun, noSchedule: true }), NOW); assert.ok(h.items.some(i => /Risparmio crediti/.test(i.title)));
  h = await view.getHealth(mkPool({}), NOW); assert.strictEqual(h.todo.level, 'warn');
  console.log('controlli di salute: ok');

  // --- dati dell'app prodotti dal codice vero con un finto database
  const sigRows = [
    { id: 1, selection: 'away', bookmaker_odd: '4.20', bookmaker_name: 'Unibet', edge_pct: '5.4', recommended_stake: '2', status: 'won', result_score: '1-2', clv_pct: '3.1', league_code: 'T1', sharp_source: 'pinnacle', created_at: 'x', kickoff: '2026-10-09T17:00:00Z', home: 'Galatasaray SK', away: 'Fenerbahçe', n_books: 6, n_near_best: 3 },
    { id: 2, selection: 'draw', bookmaker_odd: '3.80', bookmaker_name: '<b>X</b>', edge_pct: '2.4', recommended_stake: '2', status: 'pending', result_score: null, clv_pct: null, league_code: 'SP2', sharp_source: 'pinnacle', created_at: 'x', kickoff: '2026-10-10T18:30:00Z', home: 'Almeria', away: 'Sp Gijon', n_books: 5, n_near_best: 1 }];
  const bankRows = [{ id: 1, bet_id: null, amount: '10', balance_after: '110', note: 'Deposito di prova', created_at: '2026-09-26T10:00:00Z' }, { id: 2, bet_id: 1, amount: '6.40', balance_after: '116.40', note: 'Esito automatico: won (1-2)', created_at: '2026-10-10T09:00:00Z' }, { id: 3, bet_id: 2, amount: '-2', balance_after: '114.40', note: 'Esito automatico: lost', created_at: '2026-10-11T09:00:00Z' }];
  const pool = { query: async sql => {
    if (/FROM value_bets vb JOIN fixtures/.test(sql)) return { rows: sigRows };
    if (/FROM bankroll_log/.test(sql)) return { rows: bankRows };
    if (/FROM run_logs/.test(sql)) return { rows: [okRun, { ...okRun, run_at: '2026-10-04T09:00:00Z', log_text: 'SEGNALE A vs B: x\nT1: quote non richieste, nessun credito speso.' }] };
    if (/FROM league_schedule/.test(sql)) return { rows: [{ league_code: 'T1', next_start: '2099-10-09T17:00:00Z', checked_at: 'x' }] };
    if (/COUNT\(\*\)::int AS n FROM value_bets/.test(sql)) return { rows: [{ n: 0 }] };
    if (/WHERE strategy IS NOT NULL/.test(sql)) return { rows: sigRows.map(r => ({ strategy: 'A_sharp', odd: r.bookmaker_odd, status: r.status, edge_pct: r.edge_pct, clv_pct: r.clv_pct, league_code: r.league_code, selection: r.selection })) };
    if (/FROM value_bets/.test(sql)) return { rows: sigRows.map(r => ({ odd: r.bookmaker_odd, status: r.status, edge_pct: r.edge_pct, clv_pct: r.clv_pct })) };
    return { rows: [] }; } };
  const data = { '/api/tracker/overview': await view.getOverview(pool), '/api/tracker/health': await view.getHealth(pool, NOW), '/api/tracker/signals': await view.getSignals(pool, {}),
    '/api/tracker/runs': await view.getRuns(pool, 14), '/api/tracker/config': view.getConfig({ COMPETITIONS: 'SA,T1' }), '/api/tracker/bankroll': await view.getBankroll(pool, { INITIAL_BANKROLL: '100' }),
    '/api/tracker/strategies': await view.getStrategies(pool), '/api/tracker/milestones': { settledNow: 34, rule: ms.RULE, targets: [100, 200, 300].map(x => ({ target: x, reached: false, progress: 34 })) } };
  const script = /<script>([\s\S]*)<\/script>/.exec(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8'))[1];
  const els = {}, calls = [], store = {}; let downloads = 0, confirmAnswer = true, status401 = false, moreOn = 'actions';
  const el = id => els[id] || (els[id] = { id, innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, value: '', disabled: false, classList: { remove() {}, add() {} } });
  const listeners = {};
  const ctx = { console, navigator: {}, document: { addEventListener: (ev, fn) => { listeners[ev] = fn; }, visibilityState: 'visible', getElementById: el, querySelectorAll: () => [{ disabled: false, classList: { remove() {}, add() {} } }], querySelector: sel => (/moreTabs button\.on/.test(sel) ? { dataset: { t: moreOn } } : null), createElement: () => ({ click() { downloads++; } }) },
    URL: { createObjectURL: () => 'blob:x' }, Blob: function () {},
    localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } }, confirm: () => confirmAnswer,
    fetch: async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', key: opts.headers && opts.headers['x-run-key'], body: opts.body });
      const base = url.split('?')[0], ok = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
      if (base === '/api/tracker/auth-check') return ok({}, opts.headers['x-run-key'] === 'segreta123' ? 200 : 401);
      if (base === '/api/run-daily') return status401 ? ok({ error: 'Chiave non valida' }, 401) : ok({ success: true, log: ['SEGNALE X vs Y: home a 3.00', 'T1: prossima partita il 2026-10-09: quote non richieste, nessun credito speso.'] });
      if (base === '/api/bankroll/adjust') return ok({ success: true, newBalance: 124.4 });
      if (base === '/api/tracker/export.csv') return { ok: true, status: 200, blob: async () => ({}), json: async () => { throw new Error('non è json'); } };
      if (base === '/api/system-check') return { ok: true, status: 200, json: async () => ({ success: true, summary: { ok: 5, warn: 1, bad: 1 }, items: [{ level: 'bad', title: 'Tabelle mancanti', text: 'Mancano: league_schedule. Esegui db/schema.sql.' }, { level: 'warn', title: 'Colonne mancanti', text: 'quotes' }, { level: 'ok', title: 'Database', text: 'Collegato.' }] }) };
      if (base === '/api/tracker/backup.json') return { ok: true, status: 200, blob: async () => ({}), json: async () => { throw new Error('non e json'); } };
      if (base === '/api/settle-pending') return ok({ success: true, settled: 2, stillPending: 1, tappe: [100] });
      if (base === '/api/weekly-report') return ok({ success: true, text: 'Riepilogo\nriga due' });
      if (base === '/api/notify-test') return ok({ success: true, configured: false, sent: false, missing: ['TELEGRAM_CHAT_ID'] });
      if (base === '/api/notify-chat-id') return ok({ success: true, configured: true, chats: [{ id: '123456789', name: 'Christian' }] });
      if (data[base]) return ok(data[base]);
      return ok({ error: 'non trovato' }, 404); } };
  vm.createContext(ctx); vm.runInContext(script, ctx);
  const tick = () => new Promise(r => setTimeout(r, 30));
  await tick();

  // HOME
  assert.ok(/Tutto in ordine/.test(els.todo.innerHTML) && /todo ok/.test(els.todo.className), els.todo.innerHTML);
  assert.ok(/Troppo presto/.test(els.verdict.innerHTML)); assert.ok(/1 su 300/.test(els.barText.textContent) || /0 su 300/.test(els.barText.textContent));
  assert.ok(/Giro automatico/.test(els.checks.innerHTML) && /Super Lig/.test(els.schedule.innerHTML));
  assert.ok(/Tappa 100/.test(els.milestones.innerHTML) && /34 su 100 segnali chiusi/.test(els.milestones.innerHTML) && /La regola della decisione/.test(els.milestones.innerHTML));
  assert.ok(/114,40 €/.test(els.bankMini.innerHTML) && /\+14,40 €/.test(els.bankMini.innerHTML) && /polyline/.test(els.bankMini.innerHTML), els.bankMini.innerHTML);   // saldo e variazione dal punto di partenza (100)
  const snap = ms.buildSnapshot(Array.from({ length: 300 }, (_, i) => ({ id: i, odd: 4 + (i % 3), status: i % 5 ? 'lost' : 'won', edge_pct: 2 + (i % 8), clv_pct: ((i % 11) - 4) * 1.1, est_prob: 0.2, league_code: i % 2 ? 'SA' : 'SP2', selection: 'home', sharp_source: 'pinnacle' })), { pendingNow: 3 });
  vm.runInContext('renderMilestones(' + JSON.stringify({ rule: ms.RULE, targets: [{ target: 100, reached: true, reachedAt: '2026-11-12T10:00:00Z', hash: 'abcdef1234', snapshot: snap, decision: null }, { target: 200, reached: false, progress: 150 },
    { target: 300, reached: true, reachedAt: '2026-12-20T10:00:00Z', hash: '<b>x</b>', snapshot: snap, decision: { level: 'none', title: 'Nessun vantaggio dimostrato', text: 'La fascia include lo zero.' } }] }) + ')', ctx);
  assert.ok(/Impronta abcdef1234/.test(els.milestones.innerHTML) && /callout none/.test(els.milestones.innerHTML) && /150 su 200/.test(els.milestones.innerHTML) && !/<b>x<\/b>/.test(els.milestones.innerHTML));
  assert.ok(!/class="sk/.test(els.verdict.innerHTML) && /Aggiornato alle \d\d:\d\d/.test(els.updLine.textContent));            // lo scheletro di caricamento e' sparito, c'e' l'orario
  console.log('Home (con bankroll e tappe): ok');

  // SEGNALI, STRATEGIE, BANKROLL
  vm.runInContext("show('signals')", ctx); await tick();
  assert.ok(/Punta su <b>Fenerbahçe<\/b>/.test(els.signals.innerHTML) && />4,20</.test(els.signals.innerHTML) && /&lt;b&gt;X&lt;\/b&gt;/.test(els.signals.innerHTML) && !/<b>X<\/b>/.test(els.signals.innerHTML));
  vm.runInContext("show('strategies')", ctx); await tick();
  assert.ok(/Migliore quota contro Pinnacle/.test(els.strategies.innerHTML) && /In prova dal vivo/.test(els.strategies.innerHTML) && /Da 2% a 3%/.test(els.strategies.innerHTML) && /Serie minori/.test(els.strategies.innerHTML));
  assert.ok(/Sempre la favorita/.test(els.discarded.innerHTML) && /Machine learning/.test(els.discarded.innerHTML) && /Valore delle rose/.test(els.discarded.innerHTML));
  vm.runInContext("show('bankroll')", ctx); await tick();
  assert.ok(/114,40 €/.test(els.bankFull.innerHTML) && /Ultimi movimenti/.test(els.bankFull.innerHTML) && /Deposito di prova/.test(els.bankFull.innerHTML) && /Calo massimo dal picco/.test(els.bankFull.innerHTML) && /\+6,40 €/.test(els.bankFull.innerHTML));
  assert.ok(/Quota vicina a questa offerta da 3 bookmaker/.test(els.signals.innerHTML));                                       // quota ottenibile
  assert.ok(/class="avail lone">Un solo bookmaker offre questa quota/.test(els.signals.innerHTML));                              // quota da sola: avviso
  console.log('Segnali, Strategie, Bankroll: ok');

  // ALTRO: log e info
  vm.runInContext("show('more')", ctx); await tick();
  moreOn = 'logs'; vm.runInContext("moreTab({ dataset: { t: 'logs' }, classList: { add() {} } })", ctx); await tick(); assert.ok(/class="saving"/.test(els.runs.innerHTML));
  moreOn = 'info'; vm.runInContext("moreTab({ dataset: { t: 'info' }, classList: { add() {} } })", ctx); await tick(); assert.ok(/Super Lig/.test(els.config.innerHTML) && /Non collegato/.test(els.config.innerHTML));
  console.log('Altro (log, info): ok');

  // CHIAVE su richiesta: nessuna chiamata protetta senza chiave, la finestra si apre e la chiave sbagliata non si salva
  el('keyInput'); el('lockMsg'); el('keyModal'); el('bankAmount'); el('bankNote'); el('bankMsg');
  els.bankAmount.value = '10';
  const pending = vm.runInContext("submitBank()", ctx); await tick();
  assert.strictEqual(els.keyModal.className, 'modal open'); assert.strictEqual(calls.filter(c => c.url === '/api/bankroll/adjust').length, 0);
  els.keyInput.value = 'sbagliata'; await vm.runInContext("unlock()", ctx); assert.ok(/non valida/.test(els.lockMsg.textContent)); assert.ok(!store.crmKey); assert.strictEqual(els.keyModal.className, 'modal open');
  els.keyInput.value = 'segreta123'; await vm.runInContext("unlock()", ctx); await pending;
  assert.strictEqual(store.crmKey, 'segreta123'); assert.strictEqual(els.keyModal.className, 'modal');
  // ...e l'azione che l'aveva richiesta riparte da sola, con la chiave nell'intestazione e l'importo giusto
  const dep = calls.find(c => c.url === '/api/bankroll/adjust'); assert.ok(dep && dep.method === 'POST' && dep.key === 'segreta123' && !dep.url.includes('key=') && JSON.parse(dep.body).amount === 10);
  assert.ok(/Nuovo saldo: 124,40 €/.test(els.bankMsg.textContent));
  // modalità: preleva e imposta saldo (il saldo attuale e' 114,40)
  vm.runInContext("setBankMode({ dataset: { m: 'withdraw' }, classList: { add() {} } })", ctx); els.bankAmount.value = '4'; await vm.runInContext("submitBank()", ctx);
  assert.strictEqual(JSON.parse(calls.filter(c => c.url === '/api/bankroll/adjust')[1].body).amount, -4);
  vm.runInContext("setBankMode({ dataset: { m: 'set' }, classList: { add() {} } })", ctx); els.bankAmount.value = '150'; await vm.runInContext("submitBank()", ctx);
  assert.strictEqual(JSON.parse(calls.filter(c => c.url === '/api/bankroll/adjust')[2].body).amount, 35.6);      // 150 - 114,40
  els.bankAmount.value = ''; await vm.runInContext("submitBank()", ctx); assert.ok(/importo valido/.test(els.bankMsg.textContent));
  console.log('Bankroll: gestione con chiave su richiesta: ok');

  // AZIONI con chiave già salvata
  confirmAnswer = false; await vm.runInContext("act('run')", ctx); assert.strictEqual(calls.filter(c => c.url.split('?')[0] === '/api/run-daily').length, 0);
  confirmAnswer = true; await vm.runInContext("act('run')", ctx);
  const run = calls.find(c => c.url.split('?')[0] === '/api/run-daily'); assert.ok(run && run.method === 'POST' && run.key === 'segreta123' && !run.url.includes('key=') && /detail=1/.test(run.url));
  assert.ok(/class="signal"/.test(els.result.innerHTML) && /class="saving"/.test(els.result.innerHTML));
  // controllo di sistema: mostra cosa non va, in chiaro
  await vm.runInContext("act('system')", ctx);
  assert.ok(/1 da sistemare/.test(els.result.innerHTML) && /Tabelle mancanti/.test(els.result.innerHTML) && /schema\.sql/.test(els.result.innerHTML) && /class="cm bad"/.test(els.result.innerHTML));
  // copia di sicurezza: scarica con la chiave nell'intestazione, e dice di conservarla
  const bk0 = downloads; await vm.runInContext("act('backup')", ctx);
  const bkCall = calls.find(c => c.url === '/api/tracker/backup.json'); assert.ok(bkCall && bkCall.key === 'segreta123' && !bkCall.url.includes('key='));
  assert.strictEqual(downloads, bk0 + 1); assert.ok(/Conservalo/.test(els.result.innerHTML));
  const dl0 = downloads; await vm.runInContext("act('csv')", ctx); assert.strictEqual(downloads, dl0 + 1); assert.ok(/File scaricato/.test(els.result.innerHTML));
  await vm.runInContext("act('settle')", ctx); assert.ok(/registrati: 2/.test(els.result.innerHTML) && /Tappa raggiunta: 100/.test(els.result.innerHTML));
  await vm.runInContext("act('weekly')", ctx); assert.ok(/Riepilogo<br>riga due/.test(els.result.innerHTML));
  await vm.runInContext("act('tgtest')", ctx); assert.ok(/Mancano su Render: TELEGRAM_CHAT_ID/.test(els.result.innerHTML));
  await vm.runInContext("act('tgid')", ctx); assert.ok(/chat id è <b>123456789<\/b> \(Christian\)/.test(els.result.innerHTML));
  status401 = true; await vm.runInContext("act('run')", ctx); assert.ok(!store.crmKey); assert.ok(/inseriscila di nuovo/.test(els.result.innerHTML));      // chiave non piu' valida: si richiede
  console.log('Azioni (chiave, conferma, risultati, chiave scaduta): ok');
  console.log('TUTTI I TEST app OK');
})().catch(e => { console.error(e); process.exit(1); });
