const crypto = require('crypto');
const pool = require('../db/pool');
const footballData = require('./footballData');
const oddsApi = require('./oddsApi');
const history = require('./history');
const { LEAGUES, DEFAULT_COMPETITIONS } = require('./leagues');
const { sameTeam, resolveHistoryTeam } = require('./teamNames');
const { analyzeEvent, sharpReference } = require('./sharpSignals');
const { settlePending } = require('./settler');
require('dotenv').config();

/**
 * TRACKER (senza soldi veri). Ogni giorno:
 * 1. chiude in automatico i segnali di cui c'e' il risultato (e calcola il valore rispetto alla chiusura);
 * 2. per ogni campionato confronta la migliore quota tra i bookmaker con la probabilita' "onesta" di Pinnacle
 *    (strategia A del test su 19 campionati). Due modalita':
 *      - campionati coperti da football-data.org: le partite di oggi arrivano da li' e si abbinano alle quote per nome;
 *      - gli altri (Turchia, Grecia, Belgio, Scozia...): le partite arrivano direttamente da The Odds API (prossime 24 ore);
 * 3. salva i segnali con quota, bookmaker e probabilita' di riferimento. Nessuna notifica giornaliera:
 *    il riepilogo arriva una volta a settimana (POST /api/weekly-report).
 * Un segnale si salva solo se entrambe le squadre si riconoscono nello storico: cosi' si puo' sempre chiudere in automatico.
 * Nei test questa strategia NON ha mostrato un vantaggio dimostrato: qui serve a misurarla dal vivo.
 */
const COMPETITIONS = (process.env.COMPETITIONS || DEFAULT_COMPETITIONS).split(',').map(s => s.trim()).filter(c => LEAGUES[c]);
const MIN_EDGE = parseFloat(process.env.MIN_EDGE || '0.03'), MAX_EDGE = 0.15;   // MIN_EDGE modificabile da Render (es. 0.02 = piu' segnali, piu' deboli)
const MAX_DAILY_SIGNALS = parseInt(process.env.MAX_DAILY_SIGNALS || '40', 10);
const TRACK_STAKE = parseFloat(process.env.TRACK_STAKE || '2');   // puntata fissa "di carta", per confrontare i segnali tra loro
const WINDOW_HOURS = 24;

/** Memoria della "prossima partita" di ogni campionato, per non spendere crediti quando non si gioca. Se la tabella manca, si procede senza. */
async function scheduleSkip(code) {
  try {
    const { rows } = await pool.query(`SELECT next_start, checked_at FROM league_schedule WHERE league_code = $1`, [code]);
    if (!rows.length) return null;
    const next = rows[0].next_start ? new Date(rows[0].next_start).getTime() : null, checked = new Date(rows[0].checked_at).getTime();
    if (next && next > Date.now() + (WINDOW_HOURS + 1) * 3600 * 1000)
      return `prossima partita il ${new Date(next).toISOString().slice(0, 16).replace('T', ' ')} UTC (oltre ${WINDOW_HOURS} ore): quote non richieste, nessun credito speso.`;
    if (!next && Date.now() - checked < 3 * 24 * 3600 * 1000) return 'nessuna partita in programma all\'ultimo controllo: quote non richieste, nessun credito speso.';
  } catch (err) { /* tabella non ancora creata: nessun risparmio, ma tutto funziona */ }
  return null;
}
async function saveSchedule(code, events) {
  try {
    const future = events.map(e => Date.parse(e.commence_time)).filter(t => t > Date.now()).sort((a, b) => a - b);
    await pool.query(`INSERT INTO league_schedule (league_code, next_start, checked_at) VALUES ($1,$2,NOW())
                      ON CONFLICT (league_code) DO UPDATE SET next_start = EXCLUDED.next_start, checked_at = NOW()`, [code, future.length ? new Date(future[0]).toISOString() : null]);
  } catch (err) { /* vedi sopra */ }
}

const stableInt = s => 1000000000 + (parseInt(crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8), 16) % 1000000000);

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

/** Partita presa dalle quote (campionati non coperti da football-data.org): id stabili ricavati dall'evento. */
async function upsertEventFixture(ev, code) {
  const leagueId = code.charCodeAt(0);
  const fid = stableInt('ev:' + ev.id), hid = stableInt('team:' + ev.home_team), aid = stableInt('team:' + ev.away_team);
  await pool.query(`INSERT INTO teams (id, name, league_id) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`, [hid, ev.home_team, leagueId]);
  await pool.query(`INSERT INTO teams (id, name, league_id) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`, [aid, ev.away_team, leagueId]);
  await pool.query(
    `INSERT INTO fixtures (id, league_id, season, date, home_team_id, away_team_id, home_goals, away_goals, status)
     VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,'TIMED') ON CONFLICT (id) DO NOTHING`,
    [fid, leagueId, new Date().getFullYear(), ev.commence_time, hid, aid]);
  return fid;
}

async function runDailyAnalysisInner() {
  const log = [];
  const todayStr = new Date().toISOString().slice(0, 10);
  let signalsSaved = 0, fixturesAnalyzed = 0;
  const unresolved = {};                       // nomi squadra non riconosciuti, per campionato

  // 1) chiusura automatica dei segnali passati
  try {
    const s = await settlePending(pool);
    log.push(`Esiti registrati in automatico: ${s.settled}; ancora in attesa del risultato: ${s.stillPending}.`);
  } catch (err) { log.push(`Chiusura automatica non riuscita: ${err.message}`); }

  // 2) campionati in stagione su The Odds API (elenco gratuito)
  let activeKeys = null;
  try { activeKeys = oddsApi.getActiveSportKeys ? await oddsApi.getActiveSportKeys() : null; }
  catch (err) { log.push(`Elenco campionati attivi non disponibile (${err.message}): provo comunque tutti.`); }
  const isActive = code => !activeKeys || activeKeys.has(LEAGUES[code].oddsKey);

  const candidates = [];
  const context = {};                          // storico per campionato (nomi per abbinare e chiudere)
  async function leagueNames(code) {
    if (context[code]) return context[code];
    const r = await history.refreshCurrentSeason(pool, code, todayStr);
    if (!r.ok) log.push(`${code}: aggiornamento storico non riuscito (${r.error}).`);
    const rows = await history.loadMatches(pool, code);
    return (context[code] = [...new Set(rows.flatMap(x => [x.home, x.away]))]);
  }
  const noteUnresolved = (code, ...names) => { for (const n of names) (unresolved[code] = unresolved[code] || new Set()).add(n); };

  function analyze(ev, code, fixtureId, label, stats) {
    const a = analyzeEvent(ev, { minEdge: MIN_EDGE, maxEdge: MAX_EDGE });
    if (!a.ok) { log.push(`${label}: ${a.reason}.`); return; }
    stats.withSharp++;
    for (const c of a.candidates) candidates.push({ ...c, code, fixtureId, label, source: a.source });
  }

  // 2a) campionati coperti da football-data.org: le partite di oggi arrivano da li'
  const fdCodes = COMPETITIONS.filter(c => LEAGUES[c].fd);
  const evCodes = COMPETITIONS.filter(c => !LEAGUES[c].fd);
  const fixtures = fdCodes.length ? await footballData.getTodayFixtures(fdCodes) : [];
  log.push(`Partite di oggi (football-data.org): ${fixtures.length}. Campionati seguiti: ${COMPETITIONS.join(', ')}.`);
  const byLeague = {};
  for (const m of fixtures) { const c = m.competition?.code; if (LEAGUES[c]) (byLeague[c] = byLeague[c] || []).push(m); }

  for (const [code, matches] of Object.entries(byLeague)) {
    if (!isActive(code)) { log.push(`${code}: fuori stagione su The Odds API (${LEAGUES[code].oddsKey}), saltato.`); continue; }
    const names = await leagueNames(code);
    if (!names.length) { log.push(`${code}: nessuno storico per abbinare i nomi delle squadre, campionato saltato.`); continue; }
    let events = [];
    try { events = await oddsApi.getOddsForCompetition(code); }
    catch (err) { log.push(`${code}: quote non disponibili (${err.message}).`); continue; }
    const stats = { withSharp: 0 }; let matched = 0;
    for (const match of matches) {
      const label = `${match.homeTeam.name} vs ${match.awayTeam.name}`;
      await upsertTeamAndFixture(match, code);
      if (new Date(match.utcDate) <= new Date()) { log.push(`${label}: gia' iniziata, salto.`); continue; }
      if (!resolveHistoryTeam(match.homeTeam.name, names) || !resolveHistoryTeam(match.awayTeam.name, names)) {
        noteUnresolved(code, ...[match.homeTeam.name, match.awayTeam.name].filter(n => !resolveHistoryTeam(n, names)));
        log.push(`${label}: nome squadra non riconosciuto nello storico, salto.`); continue;
      }
      const ev = events.find(e => sameTeam(e.home_team, match.homeTeam.name, names) && sameTeam(e.away_team, match.awayTeam.name, names)
        && Math.abs(new Date(e.commence_time) - new Date(match.utcDate)) < 12 * 3600 * 1000);
      if (!ev) { log.push(`${label}: nessuna quota corrispondente.`); continue; }
      matched++; fixturesAnalyzed++;
      analyze(ev, code, match.id, label, stats);
    }
    log.push(`${code}: ${matches.length} partite, ${matched} con quote, ${stats.withSharp} con riferimento Pinnacle/exchange.`);
  }

  // 2b) campionati non coperti da football-data.org: partite e quote da The Odds API (prossime 24 ore)
  for (const code of evCodes) {
    if (!isActive(code)) { log.push(`${code}: fuori stagione o chiave non valida su The Odds API (${LEAGUES[code].oddsKey}), saltato.`); continue; }
    // risparmio crediti: se l'ultima volta la prossima partita era lontana (es. sosta per le nazionali), non si richiedono le quote
    const skip = await scheduleSkip(code);
    if (skip) { log.push(`${code}: ${skip}`); continue; }
    const names = await leagueNames(code);
    if (!names.length) { log.push(`${code}: nessuno storico per abbinare i nomi delle squadre, campionato saltato.`); continue; }
    let events = [];
    try { events = await oddsApi.getOddsForCompetition(code); }
    catch (err) { log.push(`${code}: quote non disponibili (${err.message}).`); continue; }
    await saveSchedule(code, events);
    // controllo "a secco" su TUTTE le partite ricevute (anche quelle dei prossimi giorni, stessa chiamata: nessun credito in piu'):
    // dice ora se Pinnacle c'e' e se i nomi si riconoscono, senza aspettare che riprenda il campionato
    const refs = events.map(e => sharpReference(e)).filter(Boolean);
    const sharpAll = refs.length, pinAll = refs.filter(r => r.source === 'pinnacle').length;
    noteUnresolved(code, ...events.flatMap(e => [e.home_team, e.away_team]).filter(n => !resolveHistoryTeam(n, names)));
    const now = Date.now();
    const upcoming = events.filter(e => { const t = Date.parse(e.commence_time); return t > now && t < now + WINDOW_HOURS * 3600 * 1000; });
    const stats = { withSharp: 0 };
    let analyzed = 0;
    for (const ev of upcoming) {
      const label = `${ev.home_team} vs ${ev.away_team}`;
      const bad = [ev.home_team, ev.away_team].filter(n => !resolveHistoryTeam(n, names));
      if (bad.length) { noteUnresolved(code, ...bad); log.push(`${label}: nome squadra non riconosciuto nello storico, salto.`); continue; }
      const fid = await upsertEventFixture(ev, code);
      analyzed++; fixturesAnalyzed++;
      analyze(ev, code, fid, label, stats);
    }
    log.push(`${code}: ${events.length} partite con quote (${sharpAll} con riferimento: ${pinAll} Pinnacle, ${sharpAll - pinAll} solo exchange), ${upcoming.length} nelle prossime ${WINDOW_HOURS} ore, ${analyzed} riconosciute, ${stats.withSharp} con riferimento nelle prossime ore.`);
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

  const bad = Object.entries(unresolved).map(([code, s]) => `${code}: ${[...s].join('; ')}`);
  if (bad.length) log.push(`NOMI SQUADRA NON RICONOSCIUTI (mandami questa riga per aggiungerli): ${bad.join(' | ')}`);
  const cr = oddsApi.getCredits ? oddsApi.getCredits() : {};
  log.push(`Analisi completata. Segnali salvati: ${signalsSaved}. Richieste football-data.org: ${footballData.getRequestCount()}, The Odds API: ${oddsApi.getRequestCount()}` +
    (cr && cr.remaining !== null && cr.remaining !== undefined ? ` (crediti usati nel mese: ${cr.used}, rimasti: ${cr.remaining}).` : '.'));
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

module.exports = { runDailyAnalysis, stableInt };
