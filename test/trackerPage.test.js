// Esegue il codice della pagina tracker.html con un finto browser e i dati REALI prodotti da trackerView: niente errori, testi giusti.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const Module = require('module'), origLoad = Module._load;
Module._load = function (request) { if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } }; if (request === 'dotenv') return { config() {} }; return origLoad.apply(this, arguments); };
const view = require('../services/trackerView');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'tracker.html'), 'utf8');
const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];

const sigRows = [
  { id: 1, selection: 'away', bookmaker_odd: '4.20', bookmaker_name: 'Unibet', edge_pct: '5.4', recommended_stake: '2', status: 'won', result_score: '1-2', clv_pct: '3.1', league_code: 'T1', sharp_source: 'pinnacle', created_at: '2026-10-09', kickoff: '2026-10-09T17:00:00Z', home: 'Galatasaray SK', away: 'Fenerbahçe' },
  { id: 2, selection: 'draw', bookmaker_odd: '3.80', bookmaker_name: '<b>X</b>', edge_pct: '3.2', recommended_stake: '2', status: 'pending', result_score: null, clv_pct: null, league_code: 'SP2', sharp_source: 'pinnacle', created_at: '2026-10-09', kickoff: '2026-10-10T18:30:00Z', home: 'Almeria', away: 'Sp Gijon' }];
const pool = { query: async sql => {
  if (/FROM value_bets vb JOIN fixtures/.test(sql)) return { rows: sigRows };
  if (/FROM run_logs/.test(sql)) return { rows: [{ run_at: '2026-10-02T09:00:00Z', success: true, value_bets_found: 1, odds_api_requests: 2, error_message: null, log_text: 'SEGNALE A vs B: x\nAnalisi completata. (crediti usati nel mese: 50, rimasti: 450).' }] };
  if (/FROM league_schedule/.test(sql)) return { rows: [{ league_code: 'T1', next_start: '2026-10-09T17:00:00Z', checked_at: '2026-10-02T09:00:00Z' }] };
  if (/FROM value_bets/.test(sql)) return { rows: sigRows.map(r => ({ odd: r.bookmaker_odd, status: r.status, edge_pct: r.edge_pct, clv_pct: r.clv_pct })) };
  return { rows: [] }; } };

(async () => {
  const overview = await view.getOverview(pool), signals = await view.getSignals(pool, {});
  const els = {};
  const el = id => els[id] || (els[id] = { id, innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, classList: { remove() {}, add() {} } });
  const ctx = { document: { getElementById: el, querySelectorAll: () => [] }, console,
    fetch: async url => ({ json: async () => (url.includes('/overview') ? overview : signals) }) };
  vm.createContext(ctx); vm.runInContext(script, ctx);
  await new Promise(r => setTimeout(r, 50));
  assert.ok(/Troppo presto/.test(els.verdict.innerHTML), els.verdict.innerHTML);                        // 1 solo segnale chiuso
  assert.ok(/Segnali totali/.test(els.stats.innerHTML) && />2</.test(els.stats.innerHTML));
  assert.ok(/1 su 300 segnali chiusi/.test(els.barText.textContent));
  assert.ok(/Super Lig/.test(els.schedule.innerHTML));
  assert.ok(/crediti rimasti: <b>450<\/b>/.test(els.run.innerHTML));
  assert.ok(/class="signal"/.test(els.log.innerHTML));
  assert.ok(/Punta su <b>Fenerbahçe<\/b> a <b>4.20<\/b>/.test(els.signals.innerHTML) && /Pareggio/.test(els.signals.innerHTML));
  assert.ok(!/<b>X<\/b>/.test(els.signals.innerHTML) && /&lt;b&gt;X&lt;\/b&gt;/.test(els.signals.innerHTML));   // testo dei dati mostrato come testo, mai come codice
  console.log('pagina tracker (finto browser, dati reali): ok');
  // errore del server: messaggio chiaro, nessuna pagina bianca
  const ctx2 = { document: { getElementById: el, querySelectorAll: () => [] }, console, fetch: async () => ({ json: async () => ({ error: 'relation "league_schedule" does not exist' }) }) };
  vm.createContext(ctx2); vm.runInContext(script, ctx2); await new Promise(r => setTimeout(r, 50));
  assert.ok(/Non riesco a caricare i dati/.test(els.verdict.innerHTML));
  console.log('pagina tracker (errore del server): ok');
  console.log('TUTTI I TEST trackerPage OK');
})().catch(e => { console.error(e); process.exit(1); });
