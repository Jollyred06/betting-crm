// Test del downloader senza rete e senza database: store in memoria + finta API con le forme di risposta REALI viste nell'API Tester.
const assert = require('assert');
const { createDownloader, parseStats, parseOdds, parseMatchRow, toCsv } = require('../services/xgDownloader');

const statsSample = { data: { match_id: 'mt_013492074', overview: { expected_goals: { all: { home: 1.13, away: 2.7 } } }, np_expected_goals: { all: { home: 1.27, away: 2.7 } } } };
const oddsSample = { data: { bookmakers: [{ bookmaker: 'Bet365', markets: {
  match_odds: { home: { opening: null, last_seen: '1.850' }, draw: { opening: null, last_seen: '3.500' }, away: { opening: null, last_seen: '4.330' } },
  total_goals: { '2.5': { over: { last_seen: '1.670' }, under: { last_seen: '2.200' } }, '1.5': { over: { last_seen: '1.200' }, under: { last_seen: '4.500' } }, '3.5': { over: { last_seen: '2.500' }, under: { last_seen: '1.530' } } },
  btts: { yes: { last_seen: '1.530' }, no: { last_seen: '2.380' } },
  double_chance: { home_draw: { last_seen: '1.200' }, home_away: { last_seen: '1.290' }, draw_away: { last_seen: '1.910' } },
  draw_no_bet: { home: { last_seen: '1.330' }, away: { last_seen: '3.250' } } } }] } };
const matchSample = { id: 'mt_013492074', status: 'finished', utc_date: '2025-05-25T18:45:00.000Z', home_team: { id: 'tm_1', name: 'Atalanta' }, away_team: { id: 'tm_2', name: 'Parma' },
  score: { home: 2, away: 3, regulation: { home: 2, away: 3 } } };

// --- parser
assert.deepStrictEqual(parseStats(statsSample), { xgHome: 1.13, xgAway: 2.7, npxgHome: 1.27, npxgAway: 2.7 });
let o = parseOdds(oddsSample);
assert.deepStrictEqual(o.b365, { h: 1.85, d: 3.5, a: 4.33, o25: 1.67, u25: 2.2, o15: 1.2, u15: 4.5, o35: 2.5, u35: 1.53, bttsY: 1.53, bttsN: 2.38, dcHd: 1.2, dcHa: 1.29, dcDa: 1.91, dnbH: 1.33, dnbA: 3.25 });
assert.strictEqual(o.pin.h, null); assert.strictEqual(o.pin.bttsY, null);   // nessun Pinnacle: null, non errore
assert.deepStrictEqual(parseStats({}), { xgHome: null, xgAway: null, npxgHome: null, npxgAway: null });
assert.strictEqual(parseMatchRow({ ...matchSample, status: 'scheduled' }, 's', 0), null);
assert.strictEqual(parseMatchRow(matchSample, 's1', 2).hg, 2);
assert.strictEqual(toCsv([{ a: 'x,y', b: null, c: 1 }]), 'a,b,c\n"x,y",,1');
console.log('parser: ok');

// --- store in memoria
function memStore() {
  const rows = new Map(), seasons = new Map();
  return {
    rows, seasons,
    async upsertMatch(r) { const x = rows.get(r.matchId) || { matchId: r.matchId, statsDone: false, oddsDone: false, attempts: 0 }; rows.set(r.matchId, { ...x, ...r }); },
    async markSeasonDone(id) { seasons.get(id).done = true; },
    async leagueResolved(key) { return [...seasons.values()].some(s => s.leagueKey === key); },
    async addSeason(x) { if (!seasons.has(x.seasonId)) seasons.set(x.seasonId, { ...x }); },
    async nextSeasonToDiscover() { return [...seasons.values()].filter(s => !s.done).sort((a, b) => a.rank - b.rank)[0] || null; },
    async nextPending(max) { return [...rows.values()].filter(r => (!r.statsDone || !r.oddsDone) && r.attempts < max).sort((a, b) => a.seasonRank - b.seasonRank || (a.utcDate < b.utcDate ? -1 : 1))[0] || null; },
    async saveStats(id, s) { Object.assign(rows.get(id), { ...s, statsDone: true }); },
    async saveOdds(id, o) { Object.assign(rows.get(id), { o, oddsDone: true, v2: true }); },
    async resetLegacyOdds() { for (const r of rows.values()) if (r.oddsDone && !r.v2) r.oddsDone = false; },
    async markError(id, m) { const r = rows.get(id); r.attempts++; r.err = m; },
    async counts() {
      const v = [...rows.values()], ss = [...seasons.values()];
      return { total: v.length, complete: v.filter(r => r.statsDone && r.oddsDone).length, pending: v.filter(r => (!r.statsDone || !r.oddsDone) && r.attempts < 3).length,
        failed: v.filter(r => (!r.statsDone || !r.oddsDone) && r.attempts >= 3).length, withBet365: v.filter(r => r.o && r.o.b365.h !== null).length, withPinnacle: 0,
        seasonsDone: ss.filter(s => s.done && !s.seasonId.startsWith('none_')).length, seasonsPending: ss.filter(s => !s.done).length,
        leaguesResolved: new Set(ss.map(s => s.leagueKey)).size };
    }
  };
}

(async () => {
  const leagues = [
    { key: 'SA', competition: 'comp_5840', seasons: 2 },
    { key: 'BL1', country: 'Germany', pick: /^bundesliga$/i, seasons: 1 },
    { key: 'BRA', country: 'Brazil', pick: /^(serie a|brasileir)/i, seasons: 1 },
    { key: 'PL', country: 'England', pick: /^premier league$/i, seasons: 1 }
  ];
  const mk = (id, sid, date, extra = {}) => ({ ...matchSample, id, season_id: sid, utc_date: date, ...extra });
  const log = [];
  let n429 = 0, perPageRejected = false;
  const fakeHttp = async (path, params) => {
    log.push(path + (params && params.country ? '?' + params.country : ''));
    if (path === '/competitions') {
      return { data: {
        Germany: [{ id: 'comp_bl2', name: '2. Bundesliga', xg_available: true, odds_available: true }, { id: 'comp_bl1', name: 'Bundesliga', xg_available: true, odds_available: true }],
        Brazil: [{ id: 'comp_br', name: 'Serie A', xg_available: true, odds_available: true }, { id: 'comp_brb', name: 'Serie B', xg_available: true, odds_available: true }],
        England: [{ id: 'comp_pl', name: 'Premier League', xg_available: false, odds_available: true }]   // senza xG: va saltata
      }[params.country], meta: { total_pages: 1 } };
    }
    const sm = path.match(/^\/competitions\/(\w+)\/seasons$/);
    if (sm) return { data: [{ id: 'S_' + sm[1] + '_new', year: '25/26' }, { id: 'S_' + sm[1] + '_old', year: '24/25' }, { id: 'S_' + sm[1] + '_older', year: '23/24' }] };
    if (path === '/matches') {
      if (params.per_page === 100 && !perPageRejected) { perPageRejected = true; const e = new Error('per_page non valido'); e.status = 422; throw e; }   // simula il rifiuto di per_page
      const sid = params.season_id;
      const data = sid === 'sn_417582' ? [[mk('m1', sid, '2024-01-01T00:00:00Z'), mk('m2', sid, '2024-01-02T00:00:00Z')], [mk('m3', sid, '2024-01-03T00:00:00Z', { status: 'scheduled' })]]
        : sid === 'sn_114559' ? [[mk('m4', sid, '2025-01-01T00:00:00Z')]]
        : [[mk('b_' + sid, sid, '2025-02-01T00:00:00Z')]];
      return { data: data[params.page - 1] || [], meta: { total_pages: data.length } };
    }
    if (path.endsWith('/stats')) { if (path.includes('m2') && n429++ === 0) { const e = new Error('rate'); e.status = 429; throw e; } return statsSample; }
    if (path.endsWith('/odds')) { if (path.includes('m4')) { const e = new Error('nf'); e.status = 404; throw e; } return oddsSample; }
    throw new Error('path inatteso ' + path);
  };
  const store = memStore(); const sleeps = [];
  // stato "reale" di partenza: Serie A gia' risolta con 2 stagioni (come dopo l'aggiornamento dello schema)
  await store.addSeason({ seasonId: 'sn_417582', competitionId: null, leagueKey: 'SA', rank: 0, label: 'x', done: false });
  await store.addSeason({ seasonId: 'sn_114559', competitionId: null, leagueKey: 'SA', rank: 1, label: 'y', done: false });
  await store.upsertMatch({ matchId: 'm1', seasonId: 'sn_417582', seasonRank: 0, leagueKey: 'SA', utcDate: '2024-01-01T00:00:00Z', home: 'A', away: 'B', hg: 2, ag: 3 });
  const d = createDownloader({ store, http: fakeHttp, sleep: async ms => { sleeps.push(ms); }, leagues });
  await d.run();
  const st = await d.status();
  assert.strictEqual(st.leaguesResolved, 4);
  assert.ok(st.notes.some(n => n.startsWith('PL:') && n.includes('senza xG')), 'PL senza xG deve essere saltata e annotata: ' + st.notes);
  assert.ok(!log.some(p => p.includes('comp_bl2')), 'ha scelto la 2. Bundesliga invece della Bundesliga');
  assert.ok(!log.some(p => p.includes('comp_brb')), 'ha scelto la Serie B invece della Serie A brasiliana');
  assert.ok([...store.rows.keys()].some(k => k.startsWith('b_S_comp_bl1')), 'nessuna partita Bundesliga');
  assert.ok([...store.rows.keys()].some(k => k.startsWith('b_S_comp_br_')), 'nessuna partita Brasile');
  assert.strictEqual([...store.rows.values()].filter(r => r.leagueKey === 'BL1').length, 1);   // 1 stagione richiesta per lega
  const c = await d.status();
  assert.strictEqual(c.pending, 0); assert.strictEqual(c.failed, 0);
  assert.strictEqual(store.rows.get('m4').o.b365.h, null);   // 404 sulle quote: non blocca, quote nulle
  assert.ok(sleeps.includes(60000));                         // ha aspettato dopo il 429
  assert.ok(sleeps.every(ms => ms === 2200 || ms === 60000));
  console.log('multi-campionato (ricerca lega, xG mancante, 429, per_page rifiutato, 404 quote): ok');

  // ripresa: seconda esecuzione non rifa nulla
  log.length = 0; await d.run();
  assert.strictEqual(log.length, 0);
  assert.strictEqual(await d.ensureRunning(), false);
  console.log('ripresa senza rifare il lavoro: ok');

  // dopo l'aggiornamento del codice: le quote vecchie si rifanno (una volta sola), l'xG no
  store.rows.get('m1').v2 = false; store.rows.get('m1').oddsDone = true;
  log.length = 0; await d.run();
  assert.deepStrictEqual(log, ['/matches/m1/odds']);
  await d.run(); assert.strictEqual(log.length, 1);
  console.log('rifacimento quote una tantum (senza rifare xG): ok');

  // chiave errata: si ferma subito
  const store2 = memStore(); let calls = 0;
  const d2 = createDownloader({ store: store2, http: async () => { calls++; const e = new Error('HTTP 401: unauthorized'); e.status = 401; throw e; }, sleep: async () => {}, leagues });
  await d2.run();
  assert.ok(calls <= 3, 'troppe chiamate con chiave errata: ' + calls);
  assert.ok((await d2.status()).lastError.includes('401'));
  console.log('chiave errata (401): si ferma subito: ok');
  console.log('TUTTI I TEST xgDownloader OK');
})().catch(e => { console.error(e); process.exit(1); });
