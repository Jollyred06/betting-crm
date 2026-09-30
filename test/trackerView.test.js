// Dati della pagina tracker: verdetto onesto, segnali con nomi e scelta leggibile, lettura del log dell'ultimo giro.
const assert = require('assert');
const Module = require('module'), origLoad = Module._load;
Module._load = function (request) { if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } }; if (request === 'dotenv') return { config() {} }; return origLoad.apply(this, arguments); };
const view = require('../services/trackerView');

// --- verdetto: mai "positivo" senza campione e intervallo
const base = { signals: 0, settled: 0, pending: 0, avgClvPct: null, clvCi95: null };
assert.strictEqual(view.verdict(base).level, 'wait');
assert.strictEqual(view.verdict({ ...base, signals: 12, settled: 5 }).level, 'wait');                                            // pochi dati
assert.strictEqual(view.verdict({ ...base, signals: 60, settled: 50, avgClvPct: 3 }).level, 'wait');                              // nessun intervallo: non si giudica
const early = view.verdict({ ...base, signals: 80, settled: 60, avgClvPct: 4, clvCi95: [1, 7] });
assert.strictEqual(early.level, 'wait'); assert.ok(/Promettente/.test(early.title));   // <100 chiusi: mai "positivo", anche con intervallo sopra lo zero
assert.strictEqual(view.verdict({ ...base, signals: 150, settled: 120, avgClvPct: 3, clvCi95: [1, 5] }).level, 'good');
assert.ok(/non e' ancora una prova/i.test(view.verdict({ ...base, signals: 150, settled: 120, avgClvPct: 3, clvCi95: [1, 5] }).text));
assert.strictEqual(view.verdict({ ...base, signals: 150, settled: 120, avgClvPct: -2, clvCi95: [-4, -0.5] }).level, 'bad');
assert.strictEqual(view.verdict({ ...base, signals: 150, settled: 120, avgClvPct: 1, clvCi95: [-1, 3] }).level, 'neutral');
console.log('verdetto: ok');

// --- scelta leggibile
assert.strictEqual(view.pick({ selection: 'home', home: 'Inter', away: 'Milan' }), 'Inter');
assert.strictEqual(view.pick({ selection: 'away', home: 'Inter', away: 'Milan' }), 'Milan');
assert.strictEqual(view.pick({ selection: 'draw', home: 'Inter', away: 'Milan' }), 'Pareggio');

// --- log dell'ultimo giro
const run = view.parseRun({ run_at: '2026-10-02T09:00:00Z', success: true, value_bets_found: 2, odds_api_requests: 3, error_message: null,
  log_text: ['Esiti registrati in automatico: 1; ancora in attesa del risultato: 0.', "T1: prossima partita il 2026-10-09 17:00 UTC (oltre 24 ore): quote non richieste, nessun credito speso.",
    "SEGNALE A vs B: away a 4.20 (Unibet), probabilita' Pinnacle 25.1%, vantaggio +5.4%.", 'NOMI SQUADRA NON RICONOSCIUTI (mandami questa riga per aggiungerli): T1: X',
    'Analisi completata. Segnali salvati: 2. Richieste football-data.org: 3, The Odds API: 3 (crediti usati nel mese: 64, rimasti: 436).'].join('\n') });
assert.deepStrictEqual(run.credits, { used: 64, remaining: 436 });
assert.deepStrictEqual(run.lines.map(l => l.kind), ['info', 'saving', 'signal', 'warn', 'info']);
assert.strictEqual(view.parseRun(null), null);
console.log('log ultimo giro: ok');

(async () => {
  // --- segnali e riepilogo con un finto database
  const sigRows = [
    { id: 1, selection: 'away', bookmaker_odd: '4.20', bookmaker_name: 'Unibet', edge_pct: '5.4', recommended_stake: '2', status: 'won', result_score: '1-2', clv_pct: '3.1', league_code: 'T1', sharp_source: 'pinnacle', created_at: '2026-10-09', kickoff: '2026-10-09T17:00:00Z', home: 'Galatasaray SK', away: 'Fenerbahçe' },
    { id: 2, selection: 'draw', bookmaker_odd: '3.80', bookmaker_name: 'Betclic', edge_pct: '3.2', recommended_stake: '2', status: 'pending', result_score: null, clv_pct: null, league_code: 'SP2', sharp_source: 'pinnacle', created_at: '2026-10-09', kickoff: '2026-10-10T18:30:00Z', home: 'Almeria', away: 'Sp Gijon' } ];
  let lastSql = '';
  const pool = { query: async (sql, params) => {
    lastSql = sql;
    if (/FROM value_bets vb JOIN fixtures/.test(sql)) return { rows: sigRows };
    if (/FROM run_logs/.test(sql)) return { rows: [{ run_at: '2026-10-02T09:00:00Z', success: true, value_bets_found: 1, odds_api_requests: 2, log_text: 'Analisi completata. (crediti usati nel mese: 50, rimasti: 450).', error_message: null }] };
    if (/FROM league_schedule/.test(sql)) return { rows: [{ league_code: 'T1', next_start: '2026-10-09T17:00:00Z', checked_at: '2026-10-02T09:00:00Z' }] };
    if (/FROM value_bets/.test(sql)) return { rows: [{ odd: '4.20', status: 'won', edge_pct: '5.4', clv_pct: '3.1' }, { odd: '3.80', status: 'pending', edge_pct: '3.2', clv_pct: null }] };
    return { rows: [] }; } };
  const s = await view.getSignals(pool, { status: 'settled' });
  assert.ok(/vb.status IN \('won','lost'\)/.test(lastSql));                                  // filtro "chiusi"
  assert.strictEqual(s[0].pick, 'Fenerbahçe'); assert.strictEqual(s[0].leagueName, 'Super Lig (Turchia)'); assert.strictEqual(s[1].pick, 'Pareggio'); assert.strictEqual(s[0].clvPct, 3.1); assert.strictEqual(s[1].clvPct, null);
  const o = await view.getOverview(pool);
  assert.strictEqual(o.total.signals, 2); assert.strictEqual(o.total.settled, 1); assert.strictEqual(o.progress.target, 300); assert.strictEqual(o.progress.pct, 0);   // 1 su 300 = 0%
  assert.strictEqual(o.lastRun.credits.remaining, 450); assert.strictEqual(o.schedule[0].name, 'Super Lig (Turchia)'); assert.strictEqual(o.verdict.level, 'wait');
  console.log('segnali e riepilogo (finto database): ok');
  console.log('TUTTI I TEST trackerView OK');
})().catch(e => { console.error(e); process.exit(1); });
