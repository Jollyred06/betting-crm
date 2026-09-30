/**
 * Scarica da football-data.co.uk risultati e quote di ~19 campionati (10 stagioni) e li unisce in UN solo CSV.
 * Serve a un test statistico su decine di migliaia di partite (invece di poche centinaia).
 * Gira in background sul server; niente database: il file finale resta in memoria e si scarica da /multi/export.csv.
 * Se il server si riavvia, basta rilanciare /multi/start (ci vogliono circa 6-8 minuti).
 */
const history = require('./history');

const LEAGUES = ['E0', 'E1', 'E2', 'E3', 'SC0', 'SC1', 'D1', 'D2', 'I1', 'I2', 'SP1', 'SP2', 'F1', 'F2', 'N1', 'B1', 'P1', 'T1', 'G1'];
const SEASONS = ['1617', '1718', '1819', '1920', '2021', '2122', '2223', '2324', '2425', '2526'];
const DELAY_MS = 1500;

// nome colonna nel file originale -> nome colonna nel CSV unico
const ODDS_MAP = {
  B365H: 'b365_h', B365D: 'b365_d', B365A: 'b365_a',
  PSH: 'ps_h', PSD: 'ps_d', PSA: 'ps_a',
  PSCH: 'psc_h', PSCD: 'psc_d', PSCA: 'psc_a',
  MaxH: 'max_h', MaxD: 'max_d', MaxA: 'max_a',
  AvgH: 'avg_h', AvgD: 'avg_d', AvgA: 'avg_a',
  MaxCH: 'maxc_h', MaxCD: 'maxc_d', MaxCA: 'maxc_a',
  AvgCH: 'avgc_h', AvgCD: 'avgc_d', AvgCA: 'avgc_a',
  'B365>2.5': 'b365_o25', 'B365<2.5': 'b365_u25',
  'P>2.5': 'ps_o25', 'P<2.5': 'ps_u25',
  'PC>2.5': 'psc_o25', 'PC<2.5': 'psc_u25',
  // Betfair Exchange (commissione bassa): presenti solo nelle stagioni piu' recenti, altrimenti vuote
  BFEH: 'bfe_h', BFED: 'bfe_d', BFEA: 'bfe_a',
  BFECH: 'bfec_h', BFECD: 'bfec_d', BFECA: 'bfec_a',
  'BFE>2.5': 'bfe_o25', 'BFE<2.5': 'bfe_u25'
};
const COLUMNS = ['league', 'season', 'date', 'home', 'away', 'fthg', 'ftag', 'ftr', ...Object.values(ODDS_MAP)];

const num = v => (v === '' || v === undefined || v === null || isNaN(Number(v)) ? '' : Number(v));

function normalizeRows(league, season, csvText) {
  const out = [];
  for (const r of history.parseCsv(csvText)) {
    const date = history.parseDate(r.Date);
    const hg = num(r.FTHG), ag = num(r.FTAG);
    if (!date || !r.HomeTeam || !r.AwayTeam || hg === '' || ag === '' || !['H', 'D', 'A'].includes(r.FTR)) continue;
    const row = { league, season, date, home: r.HomeTeam, away: r.AwayTeam, fthg: hg, ftag: ag, ftr: r.FTR };
    for (const [src, dst] of Object.entries(ODDS_MAP)) row[dst] = num(r[src]);
    out.push(row);
  }
  return out;
}

function toCsv(rows) {
  const esc = v => { const s = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [COLUMNS.join(','), ...rows.map(r => COLUMNS.map(c => esc(r[c])).join(','))].join('\n');
}

function makeHttp() {
  const axios = require('axios');
  return async function get(url) {
    try {
      const { data } = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, headers: { 'User-Agent': 'betting-crm/1.0 (uso personale)' } });
      return Buffer.from(data).toString('latin1');
    } catch (err) {
      const e = new Error(err.response ? `HTTP ${err.response.status}` : err.message);
      e.status = err.response ? err.response.status : 0;
      throw e;
    }
  };
}

function createJob({ http, sleep = ms => new Promise(r => setTimeout(r, ms)), delayMs = DELAY_MS, leagues = LEAGUES, seasons = SEASONS }) {
  const st = { running: false, finished: false, done: 0, total: leagues.length * seasons.length, ok: 0, missing: 0, failed: [], rows: [], csv: null, startedAt: null };

  async function fetchOne(league, season) {
    const url = `https://www.football-data.co.uk/mmz4281/${season}/${league}.csv`;
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(delayMs);
      try { return await http(url); }
      catch (err) {
        if (err.status === 404) return null;                      // quella lega non esiste in quella stagione
        if (err.status === 429) { await sleep(30000); continue; } // troppo veloci: pausa
        if (attempt === 3) throw err;
      }
    }
    throw new Error('troppi tentativi');
  }

  async function run() {
    if (st.running) return;
    Object.assign(st, { running: true, finished: false, done: 0, ok: 0, missing: 0, failed: [], rows: [], csv: null, startedAt: new Date().toISOString() });
    try {
      for (const season of seasons) {
        for (const league of leagues) {
          try {
            const text = await fetchOne(league, season);
            if (text === null) st.missing++;
            else { const rows = normalizeRows(league, season, text); if (rows.length) { st.rows.push(...rows); st.ok++; } else st.missing++; }
          } catch (err) { st.failed.push(`${league} ${season}: ${err.message}`); }
          st.done++;
        }
      }
      st.csv = toCsv(st.rows); st.finished = true;
    } finally { st.running = false; }
  }

  return {
    run,
    status: () => ({ running: st.running, finished: st.finished, fileElaborati: st.done, fileTotali: st.total, fileOk: st.ok, fileAssenti: st.missing, errori: st.failed.slice(0, 10), partite: st.rows.length, avviato: st.startedAt }),
    csv: () => st.csv
  };
}

module.exports = { createJob, makeHttp, normalizeRows, toCsv, COLUMNS, LEAGUES, SEASONS };
