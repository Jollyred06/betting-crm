/**
 * Storico partite (risultati + quote di chiusura medie) da football-data.co.uk.
 * Serve al modello V1, che usa le ultime 60 partite di ogni squadra.
 * - importLocalFiles: carica i CSV messi nella cartella data/history (una tantum)
 * - refreshCurrentSeason: scarica ogni giorno il file della stagione in corso
 */
const fs = require('fs');
const path = require('path');

// Codice del file su football-data.co.uk per ogni lega (per ora solo Serie A è validata).
const { LEAGUES } = require('./leagues');
const LEAGUE_CSV = Object.fromEntries(Object.entries(LEAGUES).map(([c, l]) => [c, l.csv]));

function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map(h => h.trim());
  return rows.filter(r => r.length > 1).map(r => {
    const o = {};
    header.forEach((h, i) => { o[h] = r[i] === undefined ? '' : r[i].trim(); });
    return o;
  });
}

function parseDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s || '');
  if (!m) return null;
  let y = parseInt(m[3], 10);
  if (y < 100) y += 2000;
  return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

const num = v => (v === '' || v === undefined || isNaN(Number(v)) ? null : Number(v));

function rowsToMatches(leagueCode, rows) {
  const out = [];
  for (const r of rows) {
    const date = parseDate(r.Date);
    const hg = num(r.FTHG), ag = num(r.FTAG);
    if (!date || !r.HomeTeam || !r.AwayTeam || hg === null || ag === null) continue; // partite non ancora giocate
    out.push({
      league: leagueCode, date, home: r.HomeTeam, away: r.AwayTeam, hg, ag,
      closeH: num(r.AvgCH), closeD: num(r.AvgCD), closeA: num(r.AvgCA),
      closeO25: num(r['AvgC>2.5']), closeU25: num(r['AvgC<2.5'])
    });
  }
  return out;
}

async function upsertMatches(pool, matches) {
  const seen = new Map();
  for (const m of matches) seen.set(`${m.league}|${m.date}|${m.home}|${m.away}`, m); // niente doppioni nello stesso comando
  const list = [...seen.values()];
  let done = 0;
  for (let i = 0; i < list.length; i += 200) {
    const batch = list.slice(i, i + 200);
    const params = [];
    const values = batch.map((m, k) => {
      const b = k * 11;
      params.push(m.league, m.date, m.home, m.away, m.hg, m.ag, m.closeH, m.closeD, m.closeA, m.closeO25, m.closeU25);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11})`;
    });
    await pool.query(
      `INSERT INTO historical_matches (league_code, match_date, home_team, away_team, home_goals, away_goals,
         close_avg_h, close_avg_d, close_avg_a, close_avg_o25, close_avg_u25)
       VALUES ${values.join(',')}
       ON CONFLICT (league_code, match_date, home_team, away_team) DO UPDATE SET
         home_goals = EXCLUDED.home_goals, away_goals = EXCLUDED.away_goals,
         close_avg_h = EXCLUDED.close_avg_h, close_avg_d = EXCLUDED.close_avg_d, close_avg_a = EXCLUDED.close_avg_a,
         close_avg_o25 = EXCLUDED.close_avg_o25, close_avg_u25 = EXCLUDED.close_avg_u25`,
      params
    );
    done += batch.length;
  }
  return done;
}

/** Carica i CSV nella cartella data/history (nome file: LEGA_STAGIONE.csv, es. SA_2526.csv). */
async function importLocalFiles(pool) {
  const dir = path.join(__dirname, '..', 'data', 'history');
  const summary = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const m = /^([A-Z0-9]+)_\d{4}\.csv$/.exec(f);
    if (!m) continue;
    const matches = rowsToMatches(m[1], parseCsv(fs.readFileSync(path.join(dir, f), 'utf8')));
    const n = await upsertMatches(pool, matches);
    summary.push({ file: f, partite: n });
  }
  return summary;
}

/** Codice stagione dei file (es. 2026-10-04 -> "2627"). */
function seasonCode(dateStr) {
  const y = parseInt(dateStr.slice(0, 4), 10), mo = parseInt(dateStr.slice(5, 7), 10);
  const start = mo >= 7 ? y : y - 1;
  return `${String(start).slice(2)}${String(start + 1).slice(2)}`;
}

/** Scarica il file della stagione in corso e aggiorna il database. Non lancia errori: li restituisce. */
async function refreshCurrentSeason(pool, leagueCode, todayStr) {
  const csv = LEAGUE_CSV[leagueCode];
  if (!csv) return { ok: false, error: `lega ${leagueCode} senza file storico` };
  const url = `https://www.football-data.co.uk/mmz4281/${seasonCode(todayStr)}/${csv}.csv`;
  try {
    const axios = require('axios'); // caricato solo qui: le altre funzioni restano testabili senza rete
    const { data } = await axios.get(url, { responseType: 'text', timeout: 20000, headers: { 'User-Agent': 'betting-crm/1.0' } });
    const matches = rowsToMatches(leagueCode, parseCsv(data));
    const n = await upsertMatches(pool, matches);
    return { ok: true, url, partite: n };
  } catch (err) {
    return { ok: false, url, error: err.message };
  }
}

/** Carica dal database le partite recenti di una lega, in ordine cronologico. */
async function loadMatches(pool, leagueCode) {
  const { rows } = await pool.query(
    `SELECT match_date::text AS date, home_team AS home, away_team AS away, home_goals AS hg, away_goals AS ag
     FROM historical_matches
     WHERE league_code = $1 AND match_date >= (CURRENT_DATE - INTERVAL '1200 days')
     ORDER BY match_date, id`,
    [leagueCode]
  );
  return rows;
}

module.exports = { LEAGUE_CSV, parseCsv, parseDate, rowsToMatches, upsertMatches, importLocalFiles, refreshCurrentSeason, loadMatches, seasonCode };
