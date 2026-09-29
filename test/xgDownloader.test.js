// Test del downloader senza rete e senza database: store in memoria + finta API con le forme di risposta REALI viste nell'API Tester.
const assert = require('assert');
const { createDownloader, parseStats, parseOdds, parseMatchRow, toCsv } = require('../services/xgDownloader');

const statsSample = { data: { match_id: 'mt_013492074', overview: { expected_goals: { all: { home: 1.13, away: 2.7 } } }, np_expected_goals: { all: { home: 1.27, away: 2.7 } } } };
const oddsSample = { data: { bookmakers: [{ bookmaker: 'Bet365', markets: {
  match_odds: { home: { opening: null, last_seen: '1.850' }, draw: { opening: null, last_seen: '3.500' }, away: { opening: null, last_seen: '4.330' } },
  total_goals: { '2.5': { over: { last_seen: '1.670' }, under: { last_seen: '2.200' } }, '1.5': { over: { last_seen: '1.200' }, under: { last_seen: '4.500' } } } } }] } };
const matchSample = { id: 'mt_013492074', status: 'finished', utc_date: '2025-05-25T18:45:00.000Z', home_team: { id: 'tm_1', name: 'Atalanta' }, away_team: { id: 'tm_2', name: 'Parma' },
  score: { home: 2, away: 3, regulation: { home: 2, away: 3 } } };

// --- parser
assert.deepStrictEqual(parseStats(statsSample), { xgHome: 1.13, xgAway: 2.7, npxgHome: 1.27, npxgAway: 2.7 });
let o = parseOdds(oddsSample);
assert.deepStrictEqual(o.b365, { h: 1.85, d: 3.5, a: 4.33, o25: 1.67, u25: 2.2 });
assert.deepStrictEqual(o.pin, { h: null, d: null, a: null, o25: null, u25: null });   // nessun Pinnacle: null, non errore
assert.deepStrictEqual(parseStats({}), { xgHome: null, xgAway: null, npxgHome: null, npxgAway: null });
assert.strictEqual(parseMatchRow({ ...matchSample, status: 'scheduled' }, 's', 0), null);
assert.strictEqual(parseMatchRow(matchSample, 's1', 2).hg, 2);
assert.strictEqual(toCsv([{ a: 'x,y', b: null, c: 1 }]), 'a,b,c\n"x,y",,1');
console.log('parser: ok');

// --- store in memoria
function memStore() {
  const rows = new Map(), seasons = new Set();
  return {
    rows,
    async upsertMatch(r) { const x = rows.get(r.matchId) || { matchId: r.matchId, statsDone: false, oddsDone: false, attempts: 0 }; rows.set(r.matchId, { ...x, ...r }); },
    async markSeasonDone(id) { seasons.add(id); }, async isSeasonDone(id) { return seasons.has(id); },
    async nextPending(max) { return [...rows.values()].filter(r => (!r.statsDone || !r.oddsDone) && r.attempts < max).sort((a, b) => a.seasonRank - b.seasonRank || (a.utcDate < b.utcDate ? -1 : 1))[0] || null; },
    async saveStats(id, s) { Object.assign(rows.get(id), { ...s, statsDone: true }); },
    async saveOdds(id, o) { Object.assign(rows.get(id), { o, oddsDone: true }); },
    async markError(id, m) { const r = rows.get(id); r.attempts++; r.err = m; },
    async counts() { const v = [...rows.values()]; return { total: v.length, complete: v.filter(r => r.statsDone && r.oddsDone).length, pending: v.filter(r => (!r.statsDone || !r.oddsDone) && r.attempts < 3).length, failed: v.filter(r => (!r.statsDone || !r.oddsDone) && r.attempts >= 3).length, withBet365: v.filter(r => r.o && r.o.b365.h !== null).length, withPinnacle: 0, seasonsDone: seasons.size }; }
  };
}

(async () => {
  const seasons = [['sA', 'x'], ['sB', 'y']];
  const mk = (id, sid, date, extra = {}) => ({ ...matchSample, id, season_id: sid, utc_date: date, ...extra });
  const log = [];
  let n429 = 0, perPageRejected = false;
  const fakeHttp = async (path, params) => {
    log.push(path);
    if (path === '/matches') {
      if (params.per_page === 100 && !perPageRejected) { perPageRejected = true; const e = new Error('per_page non valido'); e.status = 422; throw e; }   // simula il rifiuto di per_page
      const data = { sA: [[mk('m1', 'sA', '2024-01-01T00:00:00Z'), mk('m2', 'sA', '2024-01-02T00:00:00Z')], [mk('m3', 'sA', '2024-01-03T00:00:00Z', { status: 'scheduled' })]], sB: [[mk('m4', 'sB', '2025-01-01T00:00:00Z')]] }[params.season_id];
      return { data: data[params.page - 1] || [], meta: { total_pages: data.length } };
    }
    if (path.endsWith('/stats')) { if (path.includes('m2') && n429++ === 0) { const e = new Error('rate'); e.status = 429; throw e; } return statsSample; }
    if (path.endsWith('/odds')) { if (path.includes('m4')) { const e = new Error('nf'); e.status = 404; throw e; } return oddsSample; }
    throw new Error('path inatteso ' + path);
  };
  const store = memStore(); const sleeps = [];
  const d = createDownloader({ store, http: fakeHttp, sleep: async ms => { sleeps.push(ms); }, seasons });
  await d.run();
  const st = await d.status();
  assert.strictEqual(st.total, 3);                       // m3 e' "scheduled": scartata
  assert.strictEqual(st.complete, 3);
  assert.strictEqual(st.seasonsDone, 2);
  assert.strictEqual(store.rows.get('m4').o.b365.h, null); // 404 sulle quote: non blocca, quote nulle
  assert.ok(sleeps.includes(60000));                     // ha aspettato dopo il 429
  assert.ok(sleeps.every(ms => ms === 2200 || ms === 60000));
  assert.strictEqual(perPageRejected, true);
  console.log('flusso completo (429, per_page rifiutato, 404 quote): ok');

  // ripresa: seconda esecuzione non rifa nulla
  log.length = 0; await d.run();
  assert.strictEqual(log.length, 0);
  assert.strictEqual(await d.ensureRunning(), false);
  console.log('ripresa senza rifare il lavoro: ok');

  // chiave errata: si ferma subito, senza martellare
  const store2 = memStore(); let calls = 0;
  const d2 = createDownloader({ store: store2, http: async () => { calls++; const e = new Error('HTTP 401: unauthorized'); e.status = 401; throw e; }, sleep: async () => {}, seasons });
  await d2.run();
  assert.ok(calls <= 2, 'troppe chiamate con chiave errata: ' + calls);
  assert.ok((await d2.status()).lastError.includes('401'));
  console.log('chiave errata (401): si ferma subito: ok');
  console.log('TUTTI I TEST xgDownloader OK');
})().catch(e => { console.error(e); process.exit(1); });
