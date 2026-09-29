/**
 * Scarica da TheStatsAPI lo storico Serie A (risultati + xG + quote Bet365/Pinnacle) e lo salva
 * nella tabella xg_matches. Gira in background sul server, con ripresa automatica: se il server
 * si riavvia o si ferma, riparte da dove era rimasto (le partite gia' scaricate non si rifanno).
 * Rispetta il limite del piano di prova (~30 richieste al minuto).
 */
const BASE = 'https://api.thestatsapi.com/api/football';
const COMPETITION = 'comp_5840'; // Serie A
// Prima le 4 stagioni del backtest, poi 2 stagioni extra come "riscaldamento" del modello.
const SEASONS = [
  ['sn_417582', '22/23'], ['sn_114559', '23/24'], ['sn_4591550', '24/25'], ['sn_3061436', '25/26'],
  ['sn_481684', '21/22'], ['sn_525423', '20/21']
];
const DELAY_MS = 2200;
const MAX_ATTEMPTS = 3;

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function parseStats(json) {
  const d = json && json.data;
  const xg = d && d.overview && d.overview.expected_goals && d.overview.expected_goals.all;
  const np = d && d.np_expected_goals && d.np_expected_goals.all;
  return { xgHome: num(xg && xg.home), xgAway: num(xg && xg.away), npxgHome: num(np && np.home), npxgAway: num(np && np.away) };
}

function parseBook(b) {
  const m = (b && b.markets) || {};
  const last = x => num(x && x.last_seen);
  const tg = m.total_goals && m.total_goals['2.5'];
  return {
    h: last(m.match_odds && m.match_odds.home), d: last(m.match_odds && m.match_odds.draw), a: last(m.match_odds && m.match_odds.away),
    o25: last(tg && tg.over), u25: last(tg && tg.under)
  };
}

function parseOdds(json) {
  const books = (json && json.data && json.data.bookmakers) || [];
  const find = re => books.find(b => re.test(b.bookmaker || ''));
  return { b365: parseBook(find(/bet365/i)), pin: parseBook(find(/pinnacle/i)) };
}

function parseMatchRow(m, seasonId, rank) {
  if (!m || m.status !== 'finished' || !m.score) return null;
  const reg = m.score.regulation || m.score;
  if (num(reg.home) === null || num(reg.away) === null) return null;
  return { matchId: m.id, seasonId, seasonRank: rank, utcDate: m.utc_date, home: m.home_team && m.home_team.name,
    away: m.away_team && m.away_team.name, hg: num(reg.home), ag: num(reg.away) };
}

/** Client HTTP reale (axios caricato solo qui, cosi' il resto e' testabile senza rete). */
function makeHttp(apiKey) {
  const axios = require('axios');
  return async function get(path, params) {
    try {
      const { data } = await axios.get(BASE + path, { params, timeout: 30000, headers: { Authorization: `Bearer ${apiKey}` } });
      return data;
    } catch (err) {
      const e = new Error(err.response ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 200)}` : err.message);
      e.status = err.response ? err.response.status : 0;
      throw e;
    }
  };
}

function createDownloader({ store, http, sleep = ms => new Promise(r => setTimeout(r, ms)), delayMs = DELAY_MS, seasons = SEASONS, competition = COMPETITION }) {
  let running = false, stop = false, lastError = null, calls = 0;

  async function call(path, params) {
    for (let retry = 0; retry < 5; retry++) {
      await sleep(delayMs);
      calls++;
      try { return await http(path, params); }
      catch (err) {
        if (err.status === 429) { await sleep(60000); continue; }   // troppo veloci: pausa di un minuto
        throw err;
      }
    }
    throw new Error('troppi 429 consecutivi');
  }

  async function discoverSeason(seasonId, rank) {
    let perPage = 100, page = 1, totalPages = 1, saved = 0;
    while (page <= totalPages && !stop) {
      let json;
      try { json = await call('/matches', { competition_id: competition, season_id: seasonId, page, per_page: perPage }); }
      catch (err) {
        if (perPage !== undefined && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 && page === 1 && perPage === 100) {
          perPage = undefined; continue;      // per_page non accettato: riprova senza
        }
        throw err;
      }
      totalPages = (json.meta && json.meta.total_pages) || 1;
      for (const m of json.data || []) {
        const row = parseMatchRow(m, seasonId, rank);
        if (row) { await store.upsertMatch(row); saved++; }
      }
      page++;
    }
    if (!stop) await store.markSeasonDone(seasonId);
    return saved;
  }

  async function processMatch(p) {
    try {
      if (!p.statsDone) {
        const s = parseStats(await call(`/matches/${p.matchId}/stats`));
        await store.saveStats(p.matchId, s);
      }
      if (!p.oddsDone) {
        let o;
        try { o = parseOdds(await call(`/matches/${p.matchId}/odds`)); }
        catch (err) { if (err.status === 404) o = parseOdds(null); else throw err; }   // nessuna quota per questa partita
        await store.saveOdds(p.matchId, o);
      }
    } catch (err) {
      lastError = `${p.matchId}: ${err.message}`;
      await store.markError(p.matchId, err.message);
      if (err.status === 401 || err.status === 403) { stop = true; }   // chiave errata o piano non attivo: inutile insistere
    }
  }

  async function run() {
    if (running) return;
    running = true; stop = false;
    try {
      for (let i = 0; i < seasons.length && !stop; i++) {
        const [sid] = seasons[i];
        if (!(await store.isSeasonDone(sid))) {
          try { await discoverSeason(sid, i); } catch (err) { lastError = `elenco ${sid}: ${err.message}`; if (err.status === 401 || err.status === 403) break; }
        }
      }
      while (!stop) {
        const p = await store.nextPending(MAX_ATTEMPTS);
        if (!p) break;
        await processMatch(p);
      }
    } finally { running = false; }
  }

  return {
    run, requestStop: () => { stop = true; },
    isRunning: () => running,
    async status() { return { running, calls, lastError, ...(await store.counts()) }; },
    /** Da chiamare ad ogni ping: se c'e' ancora lavoro e il processo e' fermo, riparte. */
    async ensureRunning() {
      if (running) return false;
      const c = await store.counts();
      const seasonsPending = c.seasonsDone < seasons.length;
      if (seasonsPending || c.pending > 0) { run().catch(e => { lastError = e.message; }); return true; }
      return false;
    }
  };
}

/** Store su Postgres (tabelle xg_matches e xg_seasons, vedi db/schema.sql). */
function pgStore(pool) {
  const q = (sql, params) => pool.query(sql, params);
  return {
    async upsertMatch(r) {
      await q(`INSERT INTO xg_matches (match_id, season_id, season_rank, utc_date, home_team, away_team, home_goals, away_goals)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (match_id) DO UPDATE SET home_goals = EXCLUDED.home_goals, away_goals = EXCLUDED.away_goals`,
        [r.matchId, r.seasonId, r.seasonRank, r.utcDate, r.home, r.away, r.hg, r.ag]);
    },
    async markSeasonDone(id) { await q(`INSERT INTO xg_seasons (season_id) VALUES ($1) ON CONFLICT DO NOTHING`, [id]); },
    async isSeasonDone(id) { return (await q(`SELECT 1 FROM xg_seasons WHERE season_id = $1`, [id])).rows.length > 0; },
    async nextPending(maxAttempts) {
      const { rows } = await q(
        `SELECT match_id, stats_done, odds_done FROM xg_matches
         WHERE (stats_done = FALSE OR odds_done = FALSE) AND attempts < $1
         ORDER BY season_rank, utc_date LIMIT 1`, [maxAttempts]);
      return rows[0] ? { matchId: rows[0].match_id, statsDone: rows[0].stats_done, oddsDone: rows[0].odds_done } : null;
    },
    async saveStats(id, s) {
      await q(`UPDATE xg_matches SET xg_home=$2, xg_away=$3, npxg_home=$4, npxg_away=$5, stats_done=TRUE WHERE match_id=$1`,
        [id, s.xgHome, s.xgAway, s.npxgHome, s.npxgAway]);
    },
    async saveOdds(id, o) {
      await q(`UPDATE xg_matches SET b365_h=$2,b365_d=$3,b365_a=$4,b365_o25=$5,b365_u25=$6,
               pin_h=$7,pin_d=$8,pin_a=$9,pin_o25=$10,pin_u25=$11, odds_done=TRUE WHERE match_id=$1`,
        [id, o.b365.h, o.b365.d, o.b365.a, o.b365.o25, o.b365.u25, o.pin.h, o.pin.d, o.pin.a, o.pin.o25, o.pin.u25]);
    },
    async markError(id, msg) { await q(`UPDATE xg_matches SET attempts = attempts + 1, last_error = $2 WHERE match_id = $1`, [id, String(msg).slice(0, 300)]); },
    async counts() {
      const m = (await q(`SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE stats_done AND odds_done)::int AS complete,
          COUNT(*) FILTER (WHERE (NOT stats_done OR NOT odds_done) AND attempts < 3)::int AS pending,
          COUNT(*) FILTER (WHERE (NOT stats_done OR NOT odds_done) AND attempts >= 3)::int AS failed,
          COUNT(*) FILTER (WHERE b365_h IS NOT NULL)::int AS with_bet365,
          COUNT(*) FILTER (WHERE pin_h IS NOT NULL)::int AS with_pinnacle
        FROM xg_matches`)).rows[0];
      const s = (await q(`SELECT COUNT(*)::int AS n FROM xg_seasons`)).rows[0].n;
      return { total: m.total, complete: m.complete, pending: m.pending, failed: m.failed, withBet365: m.with_bet365, withPinnacle: m.with_pinnacle, seasonsDone: s };
    },
    async exportRows() {
      return (await q(`SELECT match_id, season_id, utc_date, home_team, away_team, home_goals, away_goals,
        xg_home, xg_away, npxg_home, npxg_away, b365_h, b365_d, b365_a, b365_o25, b365_u25,
        pin_h, pin_d, pin_a, pin_o25, pin_u25 FROM xg_matches WHERE stats_done ORDER BY utc_date`)).rows;
    }
  };
}

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = v => { if (v === null || v === undefined) return ''; const s = v instanceof Date ? v.toISOString() : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

module.exports = { createDownloader, pgStore, makeHttp, parseStats, parseOdds, parseMatchRow, toCsv, SEASONS };
