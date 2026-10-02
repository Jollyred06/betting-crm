/**
 * Scarica da TheStatsAPI lo storico Serie A (risultati + xG + quote Bet365/Pinnacle) e lo salva
 * nella tabella xg_matches. Gira in background sul server, con ripresa automatica: se il server
 * si riavvia o si ferma, riparte da dove era rimasto (le partite gia' scaricate non si rifanno).
 * Rispetta il limite del piano di prova (~30 richieste al minuto).
 */
const BASE = 'https://api.thestatsapi.com/api/football';
// Campionati in ordine di priorita'. La Serie A e' gia' nota; gli altri vengono cercati da soli nell'API
// (per paese e nome) e si scaricano solo se l'API dichiara che hanno xG e quote.
const LEAGUES = [
  { key: 'SA', competition: 'comp_5840', seasons: 6 },
  { key: 'BL1', country: 'Germany', pick: /^bundesliga$/i, seasons: 5 },
  { key: 'BRA', country: 'Brazil', pick: /^(serie a|s[eé]rie a|brasileir)/i, seasons: 5 },
  { key: 'PL', country: 'England', pick: /^premier league$/i, seasons: 5 },
  { key: 'LL', country: 'Spain', pick: /^(la ?liga|primera divisi[oó]n)$/i, seasons: 5 },
  { key: 'L1', country: 'France', pick: /^ligue 1$/i, seasons: 5 }
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
  const line = l => (m.total_goals && m.total_goals[l]) || {};
  const dc = m.double_chance || {}, dnb = m.draw_no_bet || {}, bt = m.btts || {};
  return {
    h: last(m.match_odds && m.match_odds.home), d: last(m.match_odds && m.match_odds.draw), a: last(m.match_odds && m.match_odds.away),
    o25: last(line('2.5').over), u25: last(line('2.5').under),
    o15: last(line('1.5').over), u15: last(line('1.5').under), o35: last(line('3.5').over), u35: last(line('3.5').under),
    bttsY: last(bt.yes), bttsN: last(bt.no),
    dcHd: last(dc.home_draw), dcHa: last(dc.home_away), dcDa: last(dc.draw_away),
    dnbH: last(dnb.home), dnbA: last(dnb.away)
  };
}

function parseOdds(json) {
  const books = (json && json.data && json.data.bookmakers) || [];
  const find = re => books.find(b => re.test(b.bookmaker || ''));
  return { b365: parseBook(find(/bet365/i)), pin: parseBook(find(/pinnacle/i)) };
}

function parseMatchRow(m, seasonId, rank, leagueKey = 'SA') {
  if (!m || m.status !== 'finished' || !m.score) return null;
  const reg = m.score.regulation || m.score;
  if (num(reg.home) === null || num(reg.away) === null) return null;
  return { matchId: m.id, seasonId, seasonRank: rank, leagueKey, utcDate: m.utc_date, home: m.home_team && m.home_team.name,
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

function createDownloader({ store, http, sleep = ms => new Promise(r => setTimeout(r, ms)), delayMs = DELAY_MS, leagues = LEAGUES }) {
  let running = false, stop = false, lastError = null, calls = 0;
  const notes = [];

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

  /** Trova competizione e stagioni di un campionato e le mette in coda (una volta sola, poi resta salvato). */
  async function resolveLeague(idx) {
    const L = leagues[idx];
    if (await store.leagueResolved(L.key)) return;
    let comp = L.competition ? { id: L.competition, name: L.key } : null;
    if (!comp) {
      let page = 1, totalPages = 1; const found = [];
      while (page <= totalPages) {
        const j = await call('/competitions', { country: L.country, type: 'league', page, per_page: 100 });
        totalPages = (j.meta && j.meta.total_pages) || 1;
        for (const c of j.data || []) if (L.pick.test(c.name || '')) found.push(c);
        page++;
      }
      comp = found.find(c => c.xg_available && c.odds_available) || null;
      if (!comp) {
        const why = found.length ? `${found.map(c => c.name).join('/')} senza xG o quote` : 'non trovato';
        notes.push(`${L.key}: ${why}`);
        await store.addSeason({ seasonId: `none_${L.key}`, competitionId: null, leagueKey: L.key, rank: idx * 10, label: why, done: true });
        return;
      }
    }
    const sj = await call(`/competitions/${comp.id}/seasons`);
    const list = (sj.data || []).slice(0, L.seasons);
    if (!list.length) { notes.push(`${L.key}: nessuna stagione`); await store.addSeason({ seasonId: `none_${L.key}`, competitionId: comp.id, leagueKey: L.key, rank: idx * 10, label: 'nessuna stagione', done: true }); return; }
    for (let i = 0; i < list.length; i++) {
      await store.addSeason({ seasonId: list[i].id, competitionId: comp.id, leagueKey: L.key, rank: idx * 10 + i, label: `${comp.name} ${list[i].year || ''}`.trim(), done: false });
    }
  }

  async function discoverSeason(S) {
    let perPage = 100, page = 1, totalPages = 1, saved = 0;
    const competition = S.competitionId || (leagues.find(l => l.key === S.leagueKey) || {}).competition;
    while (page <= totalPages && !stop) {
      let json;
      try { json = await call('/matches', { competition_id: competition, season_id: S.seasonId, page, per_page: perPage }); }
      catch (err) {
        if (perPage !== undefined && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 && page === 1 && perPage === 100) {
          perPage = undefined; continue;      // per_page non accettato: riprova senza
        }
        throw err;
      }
      totalPages = (json.meta && json.meta.total_pages) || 1;
      for (const m of json.data || []) {
        const row = parseMatchRow(m, S.seasonId, S.rank, S.leagueKey);
        if (row) { await store.upsertMatch(row); saved++; }
      }
      page++;
    }
    if (!stop) await store.markSeasonDone(S.seasonId);
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
      if (store.resetLegacyOdds) await store.resetLegacyOdds();
      for (let i = 0; i < leagues.length && !stop; i++) {
        try { await resolveLeague(i); }
        catch (err) { lastError = `lega ${leagues[i].key}: ${err.message}`; if (err.status === 401 || err.status === 403) break; }
      }
      while (!stop) {
        const S = await store.nextSeasonToDiscover();
        if (!S) break;
        try { await discoverSeason(S); }
        catch (err) { lastError = `elenco ${S.seasonId}: ${err.message}`; if (err.status === 401 || err.status === 403) break; await store.markSeasonDone(S.seasonId); }
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
    async status() { return { running, calls, lastError, notes, ...(await store.counts()) }; },
    /** Da chiamare ad ogni ping: se c'e' ancora lavoro e il processo e' fermo, riparte. */
    async ensureRunning() {
      if (running) return false;
      const c = await store.counts();
      if (c.leaguesResolved < leagues.length || c.seasonsPending > 0 || c.pending > 0) { run().catch(e => { lastError = e.message; }); return true; }
      return false;
    }
  };
}

/** Store su Postgres (tabelle xg_matches e xg_seasons, vedi db/schema.sql). */
function pgStore(pool) {
  const q = (sql, params) => pool.query(sql, params);
  return {
    async upsertMatch(r) {
      await q(`INSERT INTO xg_matches (match_id, season_id, season_rank, league_key, utc_date, home_team, away_team, home_goals, away_goals)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               ON CONFLICT (match_id) DO UPDATE SET home_goals = EXCLUDED.home_goals, away_goals = EXCLUDED.away_goals`,
        [r.matchId, r.seasonId, r.seasonRank, r.leagueKey || 'SA', r.utcDate, r.home, r.away, r.hg, r.ag]);
    },
    async markSeasonDone(id) { await q(`UPDATE xg_seasons SET done = TRUE WHERE season_id = $1`, [id]); },
    async leagueResolved(key) { return (await q(`SELECT 1 FROM xg_seasons WHERE league_key = $1 LIMIT 1`, [key])).rows.length > 0; },
    async addSeason(x) {
      await q(`INSERT INTO xg_seasons (season_id, competition_id, league_key, season_order, label, done) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (season_id) DO NOTHING`,
        [x.seasonId, x.competitionId, x.leagueKey, x.rank, x.label, x.done]);
    },
    async nextSeasonToDiscover() {
      const { rows } = await q(`SELECT season_id, competition_id, league_key, season_order AS rank FROM xg_seasons WHERE done = FALSE ORDER BY season_order LIMIT 1`);
      return rows[0] ? { seasonId: rows[0].season_id, competitionId: rows[0].competition_id, leagueKey: rows[0].league_key, rank: rows[0].rank } : null;
    },
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
      const b = o.b365;
      await q(`UPDATE xg_matches SET b365_h=$2,b365_d=$3,b365_a=$4,b365_o25=$5,b365_u25=$6,
               pin_h=$7,pin_d=$8,pin_a=$9,pin_o25=$10,pin_u25=$11,
               b365_o15=$12,b365_u15=$13,b365_o35=$14,b365_u35=$15,b365_btts_y=$16,b365_btts_n=$17,
               b365_dc_hd=$18,b365_dc_ha=$19,b365_dc_da=$20,b365_dnb_h=$21,b365_dnb_a=$22,
               odds_v2=TRUE, odds_done=TRUE WHERE match_id=$1`,
        [id, b.h, b.d, b.a, b.o25, b.u25, o.pin.h, o.pin.d, o.pin.a, o.pin.o25, o.pin.u25,
          b.o15, b.u15, b.o35, b.u35, b.bttsY, b.bttsN, b.dcHd, b.dcHa, b.dcDa, b.dnbH, b.dnbA]);
    },
    /** Una tantum: le quote scaricate col codice vecchio non hanno i nuovi mercati, quindi si rifanno (solo le quote, non l'xG). */
    async resetLegacyOdds() { await q(`UPDATE xg_matches SET odds_done = FALSE WHERE odds_done AND NOT odds_v2`); },
    async markError(id, msg) { await q(`UPDATE xg_matches SET attempts = attempts + 1, last_error = $2 WHERE match_id = $1`, [id, String(msg).slice(0, 300)]); },
    async counts() {
      const m = (await q(`SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE stats_done AND odds_done)::int AS complete,
          COUNT(*) FILTER (WHERE (NOT stats_done OR NOT odds_done) AND attempts < 3)::int AS pending,
          COUNT(*) FILTER (WHERE (NOT stats_done OR NOT odds_done) AND attempts >= 3)::int AS failed,
          COUNT(*) FILTER (WHERE b365_h IS NOT NULL)::int AS with_bet365,
          COUNT(*) FILTER (WHERE b365_btts_y IS NOT NULL)::int AS with_btts,
          COUNT(*) FILTER (WHERE pin_h IS NOT NULL)::int AS with_pinnacle
        FROM xg_matches`)).rows[0];
      const sp = (await q(`SELECT COUNT(*) FILTER (WHERE NOT done)::int AS pending, COUNT(DISTINCT league_key)::int AS leagues, COUNT(*) FILTER (WHERE done AND season_id NOT LIKE 'none_%')::int AS done FROM xg_seasons`)).rows[0];
      const byLeague = (await q(`SELECT league_key AS lega, COUNT(*)::int AS partite, COUNT(*) FILTER (WHERE stats_done AND odds_done)::int AS complete FROM xg_matches GROUP BY league_key ORDER BY league_key`)).rows;
      return { byLeague, leaguesResolved: sp.leagues, seasonsPending: sp.pending, total: m.total, complete: m.complete, pending: m.pending, failed: m.failed, withBet365: m.with_bet365, withBtts: m.with_btts, withPinnacle: m.with_pinnacle, seasonsDone: sp.done };
    },
    async exportRows() {
      return (await q(`SELECT league_key, match_id, season_id, utc_date, home_team, away_team, home_goals, away_goals,
        xg_home, xg_away, npxg_home, npxg_away, b365_h, b365_d, b365_a, b365_o25, b365_u25,
        pin_h, pin_d, pin_a, pin_o25, pin_u25,
        b365_o15, b365_u15, b365_o35, b365_u35, b365_btts_y, b365_btts_n, b365_dc_hd, b365_dc_ha, b365_dc_da, b365_dnb_h, b365_dnb_a
        FROM xg_matches WHERE stats_done ORDER BY utc_date`)).rows;
    }
  };
}

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = v => { if (v === null || v === undefined) return ''; const s = v instanceof Date ? v.toISOString() : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

module.exports = { createDownloader, pgStore, makeHttp, parseStats, parseOdds, parseMatchRow, toCsv, LEAGUES };
