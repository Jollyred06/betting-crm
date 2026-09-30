const pool = require('../db/pool');
const footballData = require('./footballData');
const oddsApi = require('./oddsApi');
const history = require('./history');
const { LEAGUES } = require('./leagues');
const { sameTeam, resolveHistoryTeam } = require('./teamNames');
const { analyzeEvent } = require('./sharpSignals');
const { settlePending } = require('./settler');
require('dotenv').config();

/**
 * TRACKER (senza soldi veri). Ogni giorno:
 * 1. chiude in automatico i segnali di cui c'e' il risultato (e calcola il valore rispetto alla chiusura);
 * 2. per i campionati con partite oggi, confronta la migliore quota tra i bookmaker con la probabilita'
 *    "onesta" di Pinnacle (strategia A del test su 19 campionati);
 * 3. salva i segnali con quota, bookmaker e probabilita' di riferimento. Nessuna notifica giornaliera:
 *    il riepilogo arriva una volta a settimana (POST /api/weekly-report).
 * Nei test questa strategia NON ha mostrato un vantaggio dimostrato: qui serve a misurarla dal vivo.
 */
const COMPETITIONS = (process.env.COMPETITIONS || 'SA,PL,BL1,PD,FL1,DED,PPL,ELC').split(',').map(s => s.trim()).filter(c => LEAGUES[c]);
const MIN_EDGE = 0.03, MAX_EDGE = 0.15;
const MAX_DAILY_SIGNALS = parseInt(process.env.MAX_DAILY_SIGNALS || '25', 10);
const TRACK_STAKE = parseFloat(process.env.TRACK_STAKE || '2');   // puntata fissa "di carta", per confrontare i segnali tra loro

async function upsertTeamAndFixture(match, competitionCode) {
  const { homeTeam, awayTeam, score, id, utcDate, status } = match;
  const leagueId = competitionCode.charCodeAt(0);
  for (const t of [homeTeam, awayTeam]) {
    await pool.query(`INSERT INTO teams (id, name, league_id) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`, [t.id, t.name, leagueId]);
  }
  await pool.query(
    `INSERT INTO fixtures (id, league_id, season, date, home_team_id, away_team_id, home_goals, away_goals, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET status = $9`,
    [id, leagueId, new Date().getFullYear(), utcDate, homeTeam.id, awayTeam.id, score?.fullTime?.home ?? null, score?.fullTime?.away ?? null, status]);
}

async function runDailyAnalysisInner() {
  const log = [];
  const todayStr = new Date().toISOString().slice(0, 10);
  let signalsSaved = 0, fixturesAnalyzed = 0;

  // 1) chiusura automatica dei segnali passati
  try {
    const s = await settlePending(pool);
    log.push(`Esiti registrati in automatico: ${s.settled}; ancora in attesa del risultato: ${s.stillPending}.`);
  } catch (err) { log.push(`Chiusura automatica non riuscita: ${err.message}`); }

  // 2) partite di oggi
  const fixtures = await footballData.getTodayFixtures(COMPETITIONS);
  log.push(`Partite di oggi trovate: ${fixtures.length} (campionati seguiti: ${COMPETITIONS.join(', ')}).`);
  const byLeague = {};
  for (const m of fixtures) { const c = m.competition?.code; if (LEAGUES[c]) (byLeague[c] = byLeague[c] || []).push(m); }

  const candidates = [];
  for (const [code, matches] of Object.entries(byLeague)) {
    // storico del campionato: serve ad abbinare i nomi delle squadre e, dopo, a chiudere i segnali
    const r = await history.refreshCurrentSeason(pool, code, todayStr);
    if (!r.ok) log.push(`${code}: aggiornamento storico non riuscito (${r.error}).`);
    const rows = await history.loadMatches(pool, code);
    const names = [...new Set(rows.flatMap(x => [x.home, x.away]))];
    if (!names.length) { log.push(`${code}: nessuno storico per abbinare i nomi delle squadre, campionato saltato.`); continue; }

    let events = [];
    try { events = await oddsApi.getOddsForCompetition(code); }
    catch (err) { log.push(`${code}: quote non disponibili (${err.message}).`); continue; }
    let withSharp = 0, matched = 0;
    for (const match of matches) {
      const label = `${match.homeTeam.name} vs ${match.awayTeam.name}`;
      await upsertTeamAndFixture(match, code);
      if (new Date(match.utcDate) <= new Date()) { log.push(`${label}: gia' iniziata, salto.`); continue; }
      const ev = events.find(e => sameTeam(e.home_team, match.homeTeam.name, names) && sameTeam(e.away_team, match.awayTeam.name, names)
        && Math.abs(new Date(e.commence_time) - new Date(match.utcDate)) < 12 * 3600 * 1000);
      if (!ev) { log.push(`${label}: nessuna quota corrispondente.`); continue; }
      matched++; fixturesAnalyzed++;
      const a = analyzeEvent(ev, { minEdge: MIN_EDGE, maxEdge: MAX_EDGE });
      if (!a.ok) { log.push(`${label}: ${a.reason}.`); continue; }
      withSharp++;
      for (const c of a.candidates) candidates.push({ ...c, code, fixtureId: match.id, label, source: a.source });
    }
    log.push(`${code}: ${matches.length} partite, ${matched} con quote, ${withSharp} con riferimento Pinnacle/exchange.`);
  }

  // 3) salvataggio (senza doppioni), dal vantaggio piu' piccolo: nei test i vantaggi grandi erano piu' spesso errori
  candidates.sort((x, y) => x.edge - y.edge);
  for (const c of candidates.slice(0, MAX_DAILY_SIGNALS)) {
    const dup = await pool.query(`SELECT 1 FROM value_bets WHERE fixture_id=$1 AND market='1X2' AND selection=$2 AND strategy='A_sharp'`, [c.fixtureId, c.selection]);
    if (dup.rows.length) continue;
    await pool.query(
      `INSERT INTO value_bets (fixture_id, market, selection, bookmaker_odd, bookmaker_name, estimated_probability, implied_probability,
                               edge_pct, recommended_stake, model_version, strategy, sharp_source, league_code)
       VALUES ($1,'1X2',$2,$3,$4,$5,$6,$7,$8,'sharp-v1','A_sharp',$9,$10)`,
      [c.fixtureId, c.selection, c.odd, c.bookmaker, c.fair, 1 / c.odd, c.edge * 100, TRACK_STAKE, c.source, c.code]);
    log.push(`SEGNALE ${c.label}: ${c.selection} a ${c.odd.toFixed(2)} (${c.bookmaker}), probabilita' Pinnacle ${(c.fair * 100).toFixed(1)}%, vantaggio +${(c.edge * 100).toFixed(1)}%.`);
    signalsSaved++;
  }
  if (candidates.length > MAX_DAILY_SIGNALS) log.push(`Candidati oltre il limite giornaliero (${MAX_DAILY_SIGNALS}): ${candidates.length - MAX_DAILY_SIGNALS} non salvati.`);
  log.push(`Analisi completata. Segnali salvati: ${signalsSaved}. Richieste football-data.org: ${footballData.getRequestCount()}, The Odds API: ${oddsApi.getRequestCount()}.`);
  return { log, totalValueBetsFound: signalsSaved, fixturesAnalyzed, footballDataRequestsUsed: footballData.getRequestCount(), oddsApiRequestsUsed: oddsApi.getRequestCount() };
}

async function runDailyAnalysis() {
  try {
    const result = await runDailyAnalysisInner();
    await pool.query(
      `INSERT INTO run_logs (success, fixtures_found, value_bets_found, football_data_requests, odds_api_requests, log_text) VALUES ($1,$2,$3,$4,$5,$6)`,
      [true, result.fixturesAnalyzed, result.totalValueBetsFound, result.footballDataRequestsUsed, result.oddsApiRequestsUsed, result.log.join('\n')]);
    return result;
  } catch (err) {
    await pool.query(`INSERT INTO run_logs (success, error_message) VALUES ($1, $2)`, [false, err.message]);
    throw err;
  }
}

module.exports = { runDailyAnalysis };
