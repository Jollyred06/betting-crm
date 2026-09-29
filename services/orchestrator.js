const pool = require('../db/pool');
const footballData = require('./footballData');
const oddsApi = require('./oddsApi');
const bankrollEngine = require('./bankrollEngine');
const history = require('./history');
const modelV1 = require('./modelV1');
const { resolveHistoryTeam, sameTeam } = require('./teamNames');
const { parseBestOdds, findCandidates, selectDailySignals } = require('./signals');
const { generateBetCommentary } = require('./aiCommentary');
const { sendTelegramNotification, sendEmailNotification, sendWhatsAppNotification } = require('./notifier');
require('dotenv').config();

// Leghe seguite (codici football-data.org) e leghe per cui il modello V1 è VALIDATO col backtest.
// Solo la Serie A è stata testata: le altre vengono saltate finché non hanno il loro test.
const COMPETITIONS = (process.env.COMPETITIONS || 'SA').split(',').map(s => s.trim()).filter(Boolean);
const V1_LEAGUES = (process.env.V1_LEAGUES || 'SA').split(',').map(s => s.trim()).filter(Boolean);

const MIN_EDGE = 0.03;   // come nel backtest
const MAX_EDGE = 0.15;   // sopra: scartato (probabile errore)
const MAX_DAILY_SIGNALS = parseInt(process.env.MAX_DAILY_SIGNALS || '3', 10);
const MAX_DAILY_EXPOSURE_PCT = parseFloat(process.env.MAX_DAILY_EXPOSURE_PCT || '0.10');
const MIN_RECENT_MATCHES = 10;   // partite negli ultimi ~13 mesi per squadra (come nel backtest)
const MIN_HISTORY_TOTAL = 300;   // sotto questa soglia lo storico della lega non è affidabile

async function upsertTeamAndFixture(match, competitionCode) {
  const { homeTeam, awayTeam, score, id, utcDate, status } = match;
  await pool.query(
    `INSERT INTO teams (id, name, league_id) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
    [homeTeam.id, homeTeam.name, competitionCode.charCodeAt(0)]
  );
  await pool.query(
    `INSERT INTO teams (id, name, league_id) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
    [awayTeam.id, awayTeam.name, competitionCode.charCodeAt(0)]
  );
  await pool.query(
    `INSERT INTO fixtures (id, league_id, season, date, home_team_id, away_team_id, home_goals, away_goals, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO UPDATE SET status = $9`,
    [id, competitionCode.charCodeAt(0), new Date().getFullYear(), utcDate, homeTeam.id, awayTeam.id,
      score?.fullTime?.home ?? null, score?.fullTime?.away ?? null, status]
  );
}

const pct = x => Math.round(x * 100);

/**
 * Analisi giornaliera con il modello V1 (validato col backtest):
 * 1. aggiorna lo storico partite della lega (football-data.co.uk);
 * 2. per ogni partita di oggi calcola le probabilità (1X2, Over/Under 2.5) con V1;
 * 3. le confronta con la quota migliore tra i bookmaker (The Odds API);
 * 4. applica le protezioni (vantaggio 3-15%, max segnali/giorno, tetto di esposizione);
 * 5. salva tutto come segnali "da tracciare" e notifica.
 * IMPORTANTE: nei test il modello NON ha mostrato un vantaggio sul mercato: i segnali servono
 * a misurare, non come prova che convenga puntare soldi veri.
 */
async function runDailyAnalysisInner() {
  const log = [];
  const todayStr = new Date().toISOString().slice(0, 10);

  const active = COMPETITIONS.filter(c => V1_LEAGUES.includes(c));
  const skippedLeagues = COMPETITIONS.filter(c => !V1_LEAGUES.includes(c));
  if (skippedLeagues.length) log.push(`Leghe saltate (modello non ancora validato): ${skippedLeagues.join(', ')}.`);
  if (!active.length) { log.push('Nessuna lega attiva.'); return { log, totalValueBetsFound: 0, fixturesAnalyzed: 0, footballDataRequestsUsed: 0, oddsApiRequestsUsed: 0 }; }

  // 1) Storico
  const matchesByLeague = {}, csvNamesByLeague = {}, usable = [];
  for (const league of active) {
    const r = await history.refreshCurrentSeason(pool, league, todayStr);
    log.push(r.ok ? `Storico ${league} aggiornato (${r.partite} partite lette).`
      : `Storico ${league}: aggiornamento non riuscito (${r.error}); uso quello già nel database.`);
    const matches = await history.loadMatches(pool, league);
    if (matches.length < MIN_HISTORY_TOTAL) {
      log.push(`ATTENZIONE ${league}: storico nel database insufficiente (${matches.length} partite): lega saltata. Serve l'import iniziale.`);
      continue;
    }
    matchesByLeague[league] = matches;
    csvNamesByLeague[league] = [...new Set(matches.flatMap(m => [m.home, m.away]))];
    usable.push(league);
  }
  if (!usable.length) return { log, totalValueBetsFound: 0, fixturesAnalyzed: 0, footballDataRequestsUsed: footballData.getRequestCount(), oddsApiRequestsUsed: 0 };

  // 2) Partite e quote di oggi
  const fixtures = await footballData.getTodayFixtures(usable);
  log.push(`Partite di oggi trovate: ${fixtures.length}.`);
  const oddsByLeague = {};
  if (fixtures.length > 0) {
    for (const league of usable) {
      try { oddsByLeague[league] = await oddsApi.getOddsForCompetition(league); }
      catch (err) { log.push(`Quote non disponibili per ${league}: ${err.message}`); oddsByLeague[league] = []; }
    }
  }

  const candidates = [];
  let analyzed = 0;
  for (const match of fixtures) {
    const league = match.competition?.code || usable[0];
    const names = csvNamesByLeague[league];
    if (!names) continue;
    const homeName = match.homeTeam.name, awayName = match.awayTeam.name;
    const label = `${homeName} vs ${awayName}`;
    const dateStr = String(match.utcDate).slice(0, 10);

    await upsertTeamAndFixture(match, league);

    const homeCsv = resolveHistoryTeam(homeName, names), awayCsv = resolveHistoryTeam(awayName, names);
    if (!homeCsv || !awayCsv) {
      log.push(`${label}: storico non trovato per ${!homeCsv ? homeName : awayName} (nome non riconosciuto), salto.`);
      continue;
    }
    const ctx = modelV1.buildContext(matchesByLeague[league], homeCsv, awayCsv, dateStr);
    if (ctx.recentHome < MIN_RECENT_MATCHES || ctx.recentAway < MIN_RECENT_MATCHES) {
      log.push(`${label}: storico recente insufficiente (${ctx.recentHome}/${ctx.recentAway} partite), salto.`);
      continue;
    }
    const pred = modelV1.predict(ctx);
    analyzed++;

    const event = (oddsByLeague[league] || []).find(ev => sameTeam(ev.home_team, homeName, names) && sameTeam(ev.away_team, awayName, names));
    if (!event) { log.push(`${label}: nessuna quota corrispondente trovata, salto.`); continue; }
    const { odds, bookmakerBySelection } = parseBestOdds(event);
    if (!Object.keys(odds).length) { log.push(`${label}: quote vuote, salto.`); continue; }

    for (const market of Object.keys(odds)) {
      for (const selection of Object.keys(odds[market])) {
        await pool.query(
          `INSERT INTO odds (fixture_id, bookmaker, market, selection, odd_value) VALUES ($1,$2,$3,$4,$5)`,
          [match.id, bookmakerBySelection[market]?.[selection] || null, market, selection, odds[market][selection]]
        );
      }
    }

    const found = findCandidates(pred, odds, MIN_EDGE, MAX_EDGE);
    log.push(`${label}: modello 1/X/2 = ${pct(pred.home)}/${pct(pred.draw)}/${pct(pred.away)}%, Over2.5 ${pct(pred.over25)}% -> ${found.length} candidati.`);
    for (const c of found) {
      candidates.push({ ...c, fixtureId: match.id, label, homeName, awayName,
        bookmaker: bookmakerBySelection[c.market]?.[c.selection] || null,
        sample: Math.min(ctx.hh.length, ctx.aa.length) });
    }
  }

  // 3) Protezioni giornaliere e salvataggio
  const bankrollRes = await pool.query('SELECT balance_after FROM bankroll_log ORDER BY created_at DESC LIMIT 1');
  const bankroll = Number(bankrollRes.rows[0]?.balance_after ?? process.env.INITIAL_BANKROLL ?? 100);
  const { chosen, skipped, exposure, cap } = selectDailySignals(
    candidates, bankroll, bankrollEngine.kellyStake,
    { maxSignals: MAX_DAILY_SIGNALS, maxExposurePct: MAX_DAILY_EXPOSURE_PCT });
  if (skipped.length) log.push(`Candidati non selezionati: ${skipped.length} (${[...new Set(skipped.map(s => s.reason))].join('; ')}).`);

  const summary = [];
  for (const s of chosen) {
    const commentary = await generateBetCommentary(
      { market: s.market, selection: s.selection, bookmakerOdd: s.odd, estimatedProbability: s.p, edgePct: s.edge * 100 },
      { homeTeam: s.homeName, awayTeam: s.awayName, sampleMatches: s.sample, injuries: [] });
    await pool.query(
      `INSERT INTO value_bets (fixture_id, market, selection, bookmaker_odd, bookmaker_name, estimated_probability, implied_probability, edge_pct, recommended_stake, ai_commentary, model_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'v1')`,
      [s.fixtureId, s.market, s.selection, s.odd, s.bookmaker, s.p, 1 / s.odd, s.edge * 100, s.stake, commentary]);
    summary.push({ teams: s.label, market: s.market, selection: s.selection, odd: s.odd, edge: s.edge * 100, stake: s.stake, bookmaker: s.bookmaker || 'n/d' });
  }

  if (summary.length > 0) {
    const plain = summary.map(b =>
      `${b.teams}\n${b.market} - ${b.selection} @ ${b.odd.toFixed(2)} (${b.bookmaker})\nVantaggio stimato +${b.edge.toFixed(1)}% - Stake tracciato €${b.stake.toFixed(2)}`);
    const note = 'Segnali da TRACCIARE: nei test il modello non ha battuto il mercato.';
    await sendTelegramNotification(`🎯 <b>${summary.length} segnale/i</b>\n\n${plain.join('\n\n')}\n\n${note}`);
    await sendEmailNotification(`Betting CRM: ${summary.length} segnale/i del giorno`, `${plain.join('\n\n')}\n\n${note}`);
    await sendWhatsAppNotification(`🎯 ${summary.length} segnale/i:\n\n${plain.join('\n\n')}\n\n${note}`);
  }

  log.push(`Analisi completata. Partite analizzate: ${analyzed}. Segnali salvati: ${summary.length} (esposizione €${exposure.toFixed(2)} su tetto €${cap.toFixed(2)}). Richieste football-data.org: ${footballData.getRequestCount()}, Odds API: ${oddsApi.getRequestCount()}.`);
  return { log, totalValueBetsFound: summary.length, fixturesAnalyzed: analyzed,
    footballDataRequestsUsed: footballData.getRequestCount(), oddsApiRequestsUsed: oddsApi.getRequestCount() };
}

/** Wrapper: ogni esecuzione lascia una riga in run_logs, riuscita o fallita. */
async function runDailyAnalysis() {
  try {
    const result = await runDailyAnalysisInner();
    await pool.query(
      `INSERT INTO run_logs (success, fixtures_found, value_bets_found, football_data_requests, odds_api_requests, log_text)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [true, result.fixturesAnalyzed, result.totalValueBetsFound, result.footballDataRequestsUsed, result.oddsApiRequestsUsed, result.log.join('\n')]);
    return result;
  } catch (err) {
    await pool.query(`INSERT INTO run_logs (success, error_message) VALUES ($1, $2)`, [false, err.message]);
    throw err;
  }
}

module.exports = { runDailyAnalysis };
