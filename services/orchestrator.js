const crypto = require('crypto');
const pool = require('../db/pool');
const footballData = require('./footballData');
const oddsApi = require('./oddsApi');
const history = require('./history');
const { LEAGUES, DEFAULT_COMPETITIONS } = require('./leagues');
const { sameTeam, resolveHistoryTeam } = require('./teamNames');
const { analyzeEvent, sharpReference, analyzeTotals } = require('./sharpSignals');
const { settlePending } = require('./settler');
const { sendTelegramNotification } = require('./notifier');
const { checkMilestones } = require('./milestones');
const { formatSignalsMessage, esc } = require('./signalMessage');
require('dotenv').config();

/**
 * TRACKER (senza soldi veri). Ogni giorno:
 * 1. chiude in automatico i segnali di cui c'è il risultato (e calcola il valore rispetto alla chiusura);
 * 2. per ogni campionato confronta la migliore quota tra i bookmaker con la probabilità "onesta" di Pinnacle
 *    (strategia A del test su 19 campionati). Due modalita':
 *      - campionati coperti da football-data.org: le partite di oggi arrivano da li' e si abbinano alle quote per nome;
 *      - gli altri (Turchia, Grecia, Belgio, Scozia...): le partite arrivano direttamente da The Odds API (prossime 24 ore);
 * 3. salva i segnali con quota, bookmaker e probabilità di riferimento. Nessuna notifica giornaliera:
 *    il riepilogo arriva una volta a settimana (POST /api/weekly-report).
 * Un segnale si salva solo se entrambe le squadre si riconoscono nello storico: così si può sempre chiudere in automatico.
 * Nei test questa strategia NON ha mostrato un vantaggio dimostrato: qui serve a misurarla dal vivo.
 */
const COMPETITIONS = (process.env.COMPETITIONS || DEFAULT_COMPETITIONS).split(',').map(s => s.trim()).filter(c => LEAGUES[c]);
const MIN_EDGE = parseFloat(process.env.MIN_EDGE || '0.02'), MAX_EDGE = parseFloat(process.env.MAX_EDGE || '0.25');   // edge = quota_book * p_pinnacle_pre - 1, tra 2% e 25% (modificabili da Render)
const MAX_DAILY_SIGNALS = parseInt(process.env.MAX_DAILY_SIGNALS || '40', 10);
const MAX_DAILY_SIGNALS_OU = parseInt(process.env.MAX_DAILY_SIGNALS_OU || '20', 10);   // limite separato per l'Over/Under (attivo solo con TOTALS_ENABLED=1)
const TRACK_STAKE = parseFloat(process.env.TRACK_STAKE || '2');   // puntata fissa di carta in euro (2 = la puntata minima), niente Kelly: tutti i segnali pesano uguale
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

const missingColumn = err => /column .* does not exist|colonna .* non esiste/i.test(err.message);

/** Salva un segnale con le quote complete. Tre livelli: tutto (quota presa, massimo, Pinnacle pre, id evento) -> come prima -> versione base: non si perde mai un segnale. */
async function insertSignal(c) {
  const base = [c.fixtureId, c.selection, c.odd, c.bookmaker, c.fair, 1 / c.odd, c.edge * 100, TRACK_STAKE, c.source, c.code];
  const extra = [JSON.stringify(c.quotes || null), c.sharpOdd ?? null, c.nBooks ?? null, c.nNear ?? null];
  const closing = [c.presaOdd ?? c.odd, c.presaBook ?? c.bookmaker, c.maxOdd ?? null, c.maxBook ?? null, c.goldbetOdd ?? null, c.eventId ?? null, c.sharpOdds ? JSON.stringify(c.sharpOdds) : null];
  try {
    await pool.query(
      `INSERT INTO value_bets (fixture_id, market, selection, bookmaker_odd, bookmaker_name, estimated_probability, implied_probability,
                               edge_pct, recommended_stake, model_version, strategy, sharp_source, league_code, quotes, sharp_odd, n_books, n_near_best,
                               quota_presa, presa_book, quota_max, max_book, goldbet_odd, odds_event_id, pin_pre_odds)
       VALUES ($1,$22,$2,$3,$4,$5,$6,$7,$8,'sharp-v1',$23,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [...base, ...extra, ...closing, c.market || '1X2', c.strategy || 'A_sharp']);
  } catch (err) {
    if (!missingColumn(err) || c.strategy) throw err;   // i vecchi schemi senza colonne nuove valgono solo per l'1X2
    await insertSignalPrev(base, extra);
  }
}

async function insertSignalPrev(base, extra) {
  try {
    await pool.query(
      `INSERT INTO value_bets (fixture_id, market, selection, bookmaker_odd, bookmaker_name, estimated_probability, implied_probability,
                               edge_pct, recommended_stake, model_version, strategy, sharp_source, league_code, quotes, sharp_odd, n_books, n_near_best)
       VALUES ($1,'1X2',$2,$3,$4,$5,$6,$7,$8,'sharp-v1','A_sharp',$9,$10,$11,$12,$13,$14)`,
      [...base, ...extra]);
  } catch (err) {
    if (!missingColumn(err)) throw err;
    await pool.query(
      `INSERT INTO value_bets (fixture_id, market, selection, bookmaker_odd, bookmaker_name, estimated_probability, implied_probability,
                               edge_pct, recommended_stake, model_version, strategy, sharp_source, league_code)
       VALUES ($1,'1X2',$2,$3,$4,$5,$6,$7,$8,'sharp-v1','A_sharp',$9,$10)`, base);
  }
}

const SEL_IT = { home: 'vittoria casa (1)', draw: 'pareggio (X)', away: 'vittoria trasferta (2)' };
/** Riga del Log per ogni partita controllata: solo informativa, non cambia i segnali. */
function checkLine(label, code, a, minEdge, maxEdge) {
  const t = a.top;
  if (!t) return `CONTROLLO ${label} (${code}): meno di 3 bookmaker con quote, non valutabile.`;
  const pct = (t.edge * 100).toFixed(1);
  const esito = t.edge >= minEdge && t.edge <= maxEdge ? 'SEGNALE' : t.edge > maxEdge ? 'oltre il massimo, scartato' : 'sotto soglia';
  return `CONTROLLO ${label} (${code}): miglior vantaggio ${t.edge >= 0 ? '+' : ''}${pct}% su ${SEL_IT[t.selection]}, quota ${t.odd.toFixed(2)} (${t.bookmaker}), Pinnacle ${(t.fair * 100).toFixed(1)}%: ${esito}.`;
}

async function runDailyAnalysisInner() {
  const log = [];
  const todayStr = new Date().toISOString().slice(0, 10);
  let signalsSaved = 0, fixturesAnalyzed = 0, lowCredits = false;
  if (oddsApi.resetRun) oddsApi.resetRun();
  const unresolved = {};                       // nomi squadra non riconosciuti, per campionato

  // 1) chiusura automatica dei segnali passati
  try {
    const s = await settlePending(pool);
    log.push(`Esiti registrati in automatico: ${s.settled}; ancora in attesa del risultato: ${s.stillPending}.`);
    const m = s.manual;
    if (m && (m.checked || m.notYet)) {
      log.push(`Risultati scritti a mano controllati con il file ufficiale: ${m.same} uguali, ${m.corrected.length} corretti, ${m.notYet} non ancora nel file.`);
      for (const c of m.corrected) log.push(`CORREZIONE ${c.home} – ${c.away}: a mano ${c.was}, nel file ufficiale ${c.now}${c.delta ? ` (saldo ${c.delta > 0 ? '+' : ''}${c.delta.toFixed(2)} €)` : ''}.`);
      if (m.corrected.length) { try { await sendTelegramNotification(`⚠️ <b>Risultati corretti</b>\n` + m.corrected.map(c => `${c.home} – ${c.away}: a mano ${c.was}, ufficiale ${c.now}`).join('\n')); } catch (e) { /* avviso facoltativo */ } }
    }
  } catch (err) { log.push(`Chiusura automatica non riuscita: ${err.message}`); }
  try {
    const newly = await checkMilestones(pool);
    for (const t of newly) {
      log.push(`TAPPA raggiunta: ${t} segnali chiusi. Fotografia dei numeri salvata.`);
      await sendTelegramNotification(`📍 <b>Tappa raggiunta: ${t} segnali chiusi</b>\nLa fotografia dei numeri è salvata. Ora scarica il CSV dall'app (Azioni) e mandalo in chat: lo analizziamo con la regola fissata all'inizio.`);
    }
  } catch (err) { log.push(`Controllo delle tappe non riuscito: ${err.message}`); }

  // 2) campionati in stagione su The Odds API (elenco gratuito)
  let activeKeys = null;
  try { activeKeys = oddsApi.getActiveSportKeys ? await oddsApi.getActiveSportKeys() : null; }
  catch (err) { log.push(`Elenco campionati attivi non disponibile (${err.message}): provo comunque tutti.`); }
  const isActive = code => !activeKeys || activeKeys.has(LEAGUES[code].oddsKey);

  const candidates = [], ouCandidates = [];
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
    log.push(checkLine(label, code, a, MIN_EDGE, MAX_EDGE));
    for (const c of a.candidates) candidates.push({ ...c, code, fixtureId, label, source: a.source, home: ev.home_team, away: ev.away_team, kickoff: ev.commence_time, eventId: ev.id });
    // Over/Under: solo se acceso (TOTALS_ENABLED=1); non tocca in nessun modo i segnali 1X2
    if (oddsApi.totalsEnabled && oddsApi.totalsEnabled()) {
      const t = analyzeTotals(ev, { minEdge: MIN_EDGE, maxEdge: MAX_EDGE });
      if (t.ok) for (const c of t.candidates) ouCandidates.push({ ...c, code, fixtureId, label, source: 'pinnacle', home: ev.home_team, away: ev.away_team, kickoff: ev.commence_time, eventId: ev.id });
    }
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
    catch (err) { if (/soglia di sicurezza/.test(err.message)) lowCredits = true; log.push(`${code}: quote non disponibili (${err.message}).`); continue; }
    const stats = { withSharp: 0 }; let matched = 0;
    for (const match of matches) {
      const label = `${match.homeTeam.name} vs ${match.awayTeam.name}`;
      await upsertTeamAndFixture(match, code);
      if (new Date(match.utcDate) <= new Date()) { log.push(`${label}: già iniziata, salto.`); continue; }
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
    catch (err) { if (/soglia di sicurezza/.test(err.message)) lowCredits = true; log.push(`${code}: quote non disponibili (${err.message}).`); continue; }
    await saveSchedule(code, events);
    // controllo "a secco" su TUTTE le partite ricevute (anche quelle dei prossimi giorni, stessa chiamata: nessun credito in più):
    // dice ora se Pinnacle c'è e se i nomi si riconoscono, senza aspettare che riprenda il campionato
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

  // 3) salvataggio (senza doppioni), dal vantaggio più piccolo: nei test i vantaggi grandi erano più spesso errori
  candidates.sort((x, y) => x.edge - y.edge);
  const saved = [];
  for (const c of candidates.slice(0, MAX_DAILY_SIGNALS)) {
    const dup = await pool.query(`SELECT 1 FROM value_bets WHERE fixture_id=$1 AND market='1X2' AND selection=$2 AND strategy='A_sharp'`, [c.fixtureId, c.selection]);
    if (dup.rows.length) continue;
    await insertSignal(c);
    log.push(`SEGNALE ${c.label}: ${c.selection} a ${c.odd.toFixed(2)} (${c.bookmaker}), probabilità Pinnacle ${(c.fair * 100).toFixed(1)}%, vantaggio +${(c.edge * 100).toFixed(1)}%.`);
    signalsSaved++; saved.push(c);
  }
  // Over/Under (solo se acceso): stesso criterio dell'1X2, limite e doppioni separati, nessuna notifica Telegram
  let ouSaved = 0;
  if (ouCandidates.length) {
    ouCandidates.sort((x, y) => x.edge - y.edge);
    for (const c of ouCandidates.slice(0, MAX_DAILY_SIGNALS_OU)) {
      const dup = await pool.query(`SELECT 1 FROM value_bets WHERE fixture_id=$1 AND market=$2 AND selection=$3 AND strategy=$4`, [c.fixtureId, c.market, c.selection, c.strategy]);
      if (dup.rows.length) continue;
      await insertSignal(c);
      log.push(`SEGNALE ${c.market} ${c.label}: ${c.selection === 'over' ? 'Over' : 'Under'} a ${c.odd.toFixed(2)} (${c.bookmaker}), probabilità Pinnacle ${(c.fair * 100).toFixed(1)}%, vantaggio +${(c.edge * 100).toFixed(1)}%.`);
      ouSaved++;
    }
    log.push(`Over/Under: ${ouCandidates.length} candidati, ${ouSaved} salvati.`);
  }
  if (saved.length) {
    // un solo messaggio Telegram per giro, con i segnali NUOVI (quelli già salvati nei giri precedenti non si ripetono)
    saved.sort((x, y) => new Date(x.kickoff) - new Date(y.kickoff));
    await sendTelegramNotification(formatSignalsMessage(saved));
  }
  if (candidates.length > MAX_DAILY_SIGNALS) log.push(`Candidati oltre il limite giornaliero (${MAX_DAILY_SIGNALS}): ${candidates.length - MAX_DAILY_SIGNALS} non salvati.`);

  const bad = Object.entries(unresolved).map(([code, s]) => `${code}: ${[...s].join('; ')}`);
  if (bad.length) log.push(`NOMI SQUADRA NON RICONOSCIUTI (mandami questa riga per aggiungerli): ${bad.join(' | ')}`);
  const cr = oddsApi.getCredits ? oddsApi.getCredits() : {};
  const runReq = oddsApi.getRunRequestCount ? oddsApi.getRunRequestCount() : oddsApi.getRequestCount();
  const spent = oddsApi.getRunSpent ? oddsApi.getRunSpent() : null;
  log.push(`Analisi completata. Segnali salvati: ${signalsSaved}. Richieste football-data.org: ${footballData.getRequestCount()}, The Odds API: ${runReq} in questo giro` +
    (spent !== null ? `, crediti spesi: ${spent}` : '') +
    (cr && cr.remaining !== null && cr.remaining !== undefined ? ` (crediti usati nel mese: ${cr.used}, rimasti: ${cr.remaining}).` : '.'));
  if (lowCredits) {
    log.push('ATTENZIONE: crediti The Odds API sotto la soglia di sicurezza, alcuni campionati non sono stati controllati.');
    try { await sendTelegramNotification(`⚠️ <b>Crediti The Odds API quasi finiti</b>\nRimasti: ${cr && cr.remaining}. Le quote dei campionati non vengono più richieste fino al reset del mese.`); } catch (e) { /* notifica facoltativa */ }
  }
  return { log, totalValueBetsFound: signalsSaved, fixturesAnalyzed, footballDataRequestsUsed: footballData.getRequestCount(), oddsApiRequestsUsed: oddsApi.getRunRequestCount ? oddsApi.getRunRequestCount() : oddsApi.getRequestCount() };
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
    await sendTelegramNotification(`⚠️ <b>Il giro giornaliero è fallito</b>\n${esc(err.message)}\nApri l'app: la Home dice cosa fare.`);
    throw err;
  }
}

module.exports = { runDailyAnalysis, stableInt, checkLine };
