// Test del tracker senza rete e senza database: segnali contro Pinnacle, chiusura automatica, riepilogo e flusso giornaliero completo.
const assert = require('assert'), path = require('path'), Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {                       // moduli esterni non installati qui: finti
  if (request === 'dotenv') return { config() {} };
  if (request === 'axios') return { create: () => ({ get() { throw new Error('rete non disponibile nel test'); } }), get() { throw new Error('rete'); } };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  return origLoad.apply(this, arguments);
};
const { analyzeEvent } = require('../services/sharpSignals');
const settler = require('../services/settler');
const { summarize, formatReport } = require('../services/weeklyReport');

// --- 1) segnali contro Pinnacle (evento nel formato di The Odds API)
const bk = (key, h, d, a, title) => ({ key, title: title || key, markets: [{ key: 'h2h', outcomes: [{ name: 'Inter Milan', price: h }, { name: 'Draw', price: d }, { name: 'AC Milan', price: a }] }] });
const ev = { home_team: 'Inter Milan', away_team: 'AC Milan', commence_time: '2026-10-04T18:45:00Z', bookmakers: [
  bk('pinnacle', 2.00, 3.50, 3.80), bk('williamhill', 1.95, 3.40, 3.70), bk('betclic', 2.05, 3.45, 3.75), bk('unibet_eu', 1.98, 3.45, 4.20, 'Unibet'), bk('betfair_ex_eu', 2.02, 3.50, 3.80) ] };
let a = analyzeEvent(ev);
assert.strictEqual(a.ok, true); assert.strictEqual(a.source, 'pinnacle');
const p = a.fair; assert.ok(Math.abs(p.home + p.draw + p.away - 1) < 1e-12);
// Pinnacle: 1/2 + 1/3.5 + 1/3.8 = 1.0486 -> fair away = 0.2632/1.0486 = 0.2510; migliore quota away 4.20 -> edge = 4.20*0.2510-1 = +5.4%
const away = a.candidates.find(c => c.selection === 'away');
assert.ok(away && away.bookmaker === 'Unibet' && away.odd === 4.20 && Math.abs(away.edge - 0.0541) < 0.002, JSON.stringify(a.candidates));
assert.ok(!a.candidates.some(c => c.selection === 'home'));                       // home: 2.05*0.4774-1 = -2.1%: nessun segnale
// quote troppo alte (>15%) scartate; Pinnacle e exchange non contano come "morbidi"
const wild = { ...ev, bookmakers: [...ev.bookmakers, bk('sport888', 1.9, 3.4, 6.0)] };
assert.ok(!analyzeEvent(wild).candidates.some(c => c.selection === 'away'));      // 6.0*0.251-1 = +50%: quota sbagliata, scartata
assert.strictEqual(analyzeEvent({ ...ev, bookmakers: ev.bookmakers.filter(b => b.key !== 'pinnacle' && b.key !== 'betfair_ex_eu') }).ok, false);   // senza riferimento: nessun segnale
assert.strictEqual(analyzeEvent({ ...ev, bookmakers: ev.bookmakers.filter(b => b.key !== 'pinnacle') }).source, 'betfair_ex_eu');               // ripiego sull'exchange
assert.strictEqual(analyzeEvent({ ...ev, bookmakers: [ev.bookmakers[0], ev.bookmakers[1], ev.bookmakers[3]] }).candidates.length, 0);            // meno di 3 bookmaker morbidi: niente
console.log('segnali contro Pinnacle: ok');

// --- 2) chiusura automatica
assert.strictEqual(settler.outcomeFromScore('home', 2, 1), 'won'); assert.strictEqual(settler.outcomeFromScore('draw', 2, 1), 'lost'); assert.strictEqual(settler.outcomeFromScore('away', 0, 0), 'lost');
const closeRow = { close_avg_h: '2.00', close_avg_d: '3.50', close_avg_a: '3.80' };
const fair = settler.closingFair(closeRow, 'away'); assert.ok(Math.abs(fair - 0.2510) < 0.001);
assert.ok(Math.abs(settler.clvPct(4.20, fair) - 5.4) < 0.2); assert.strictEqual(settler.closingFair({ close_avg_h: null }, 'home'), null);
const names = ['Inter', 'Milan', 'Roma', 'Verona'];
const rows = [{ date: '2026-10-04', home: 'Inter', away: 'Milan', hg: 2, ag: 1 }, { date: '2026-10-11', home: 'Roma', away: 'Verona', hg: 0, ag: 0 }];
assert.strictEqual(settler.findResult(rows, 'FC Internazionale Milano', 'AC Milan', '2026-10-04', names).hg, 2);
assert.strictEqual(settler.findResult(rows, 'FC Internazionale Milano', 'AC Milan', '2026-10-05', names).hg, 2);   // data entro 1 giorno (fuso orario)
assert.strictEqual(settler.findResult(rows, 'FC Internazionale Milano', 'AC Milan', '2026-10-08', names), null);  // troppo distante
assert.strictEqual(settler.findResult(rows, 'AC Milan', 'FC Internazionale Milano', '2026-10-04', names), null);  // casa/trasferta invertiti: non e' la stessa partita
console.log('chiusura automatica (logica): ok');

// --- 3) riepilogo
const bets = [ { odd: 4, status: 'won', edge_pct: 5, clv_pct: 3 }, { odd: 3, status: 'lost', edge_pct: 4, clv_pct: -1 }, { odd: 2, status: 'lost', edge_pct: 3, clv_pct: null }, { odd: 5, status: 'pending', edge_pct: 6, clv_pct: null } ];
const s = summarize(bets);
assert.strictEqual(s.signals, 4); assert.strictEqual(s.settled, 3); assert.strictEqual(s.pending, 1);
assert.ok(Math.abs(s.roiFlatPct - ((3 - 1 - 1) / 3) * 100) < 1e-9); assert.ok(Math.abs(s.avgClvPct - 1) < 1e-9); assert.strictEqual(s.nClv, 2); assert.strictEqual(s.clvCi95, null);   // < 20 dati: nessun intervallo
assert.strictEqual(summarize([]).roiFlatPct, null);
assert.ok(formatReport(s, s).includes('Servono circa 300 segnali'));
console.log('riepilogo: ok');

(async () => {
  // --- 4) settlePending con un finto database
  const q = [];
  const pool = { query: async (sql, params) => {
    q.push([sql, params]);
    if (/FROM value_bets vb JOIN fixtures/.test(sql)) return { rows: [
      { id: 1, selection: 'away', bookmaker_odd: '4.20', recommended_stake: '2', league_code: 'SA', date: '2026-10-04T18:45:00Z', home_name: 'FC Internazionale Milano', away_name: 'AC Milan' },
      { id: 2, selection: 'home', bookmaker_odd: '2.00', recommended_stake: '2', league_code: 'SA', date: '2026-10-11T18:45:00Z', home_name: 'AS Roma', away_name: 'Hellas Verona FC' },
      { id: 3, selection: 'home', bookmaker_odd: '2.00', recommended_stake: '2', league_code: 'SA', date: '2026-10-18T18:45:00Z', home_name: 'AS Roma', away_name: 'Hellas Verona FC' } ] };
    if (/FROM historical_matches/.test(sql)) return { rows: rows.map(r => ({ ...r, close_avg_h: '2.00', close_avg_d: '3.50', close_avg_a: '3.80' })) };
    if (/FROM bankroll_log/.test(sql)) return { rows: [{ balance_after: '100' }] };
    return { rows: [] };
  } };
  const r = await settler.settlePending(pool);
  assert.deepStrictEqual(r, { settled: 2, stillPending: 1 });            // la 3a partita non e' ancora nel file
  const upd = q.filter(x => /UPDATE value_bets/.test(x[0]));
  assert.strictEqual(upd[0][1][0], 'lost'); assert.strictEqual(upd[0][1][1], '2-1'); assert.ok(Math.abs(upd[0][1][3] - 5.4) < 0.2);   // Milan a 4.20 perde 2-1, CLV +5.4%
  assert.strictEqual(upd[1][1][0], 'lost');                                                                                          // Roma-Verona 0-0: 'home' perde
  console.log('chiusura automatica (con finto database): ok');

  // --- 5) flusso giornaliero completo con moduli finti
  const inserted = [], logs = [];
  const fakePool = { query: async (sql, params) => {
    if (/INSERT INTO value_bets/.test(sql)) { inserted.push(params); return { rows: [] }; }
    if (/INSERT INTO run_logs/.test(sql)) { logs.push(params); return { rows: [] }; }
    return { rows: [] }; } };
  const stub = (rel, exp) => { const f = require.resolve(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; };
  stub('../db/pool', fakePool);
  const future = new Date(Date.now() + 5 * 3600 * 1000).toISOString();
  stub('../services/footballData', { getRequestCount: () => 1, getTodayFixtures: async codes => [
    { id: 555, utcDate: future, status: 'TIMED', competition: { code: 'SA' }, homeTeam: { id: 1, name: 'FC Internazionale Milano' }, awayTeam: { id: 2, name: 'AC Milan' }, score: {} },
    { id: 556, utcDate: future, status: 'TIMED', competition: { code: 'PL' }, homeTeam: { id: 3, name: 'Arsenal FC' }, awayTeam: { id: 4, name: 'Chelsea FC' }, score: {} } ] });
  stub('../services/oddsApi', { getRequestCount: () => 1, getOddsForCompetition: async code => (code === 'SA' ? [{ ...ev, commence_time: future }] : (() => { throw new Error('HTTP 401'); })()) });
  const history = require('../services/history');
  history.refreshCurrentSeason = async () => ({ ok: true, partite: 10 });
  history.loadMatches = async (pl, code) => (code === 'SA' ? [{ home: 'Inter', away: 'Milan' }, { home: 'Roma', away: 'Verona' }] : [{ home: 'Arsenal', away: 'Chelsea' }]);
  const { runDailyAnalysis } = require('../services/orchestrator');
  const out = await runDailyAnalysis();
  assert.strictEqual(inserted.length, 1);                                   // un solo segnale: Milan a 4.20
  assert.strictEqual(inserted[0][1], 'away'); assert.strictEqual(inserted[0][2], 4.20); assert.strictEqual(inserted[0][3], 'Unibet'); assert.strictEqual(inserted[0][8], 'pinnacle'); assert.strictEqual(inserted[0][9], 'SA');
  assert.ok(out.log.some(l => /PL: quote non disponibili \(HTTP 401\)/.test(l)));   // errore su un campionato: non blocca gli altri
  assert.ok(logs.length === 1 && logs[0][0] === true);
  console.log('flusso giornaliero completo (finti API e database): ok');
  console.log('TUTTI I TEST tracker OK');
})().catch(e => { console.error(e); process.exit(1); });
