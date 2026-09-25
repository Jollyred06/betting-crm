const pool = require('../db/pool');
const apiFootball = require('./apiFootball');
const valueEngine = require('./valueEngine');
const bankrollEngine = require('./bankrollEngine');
const { generateBetCommentary } = require('./aiCommentary');
require('dotenv').config();

const LEAGUE_IDS = (process.env.LEAGUE_IDS || '135').split(',').map(Number);
const MAX_FIXTURES_PER_DAY = 3;
const CURRENT_SEASON = new Date().getFullYear();

/**
 * Calcola statistiche squadra (media gol fatti/subiti, forma) dalle ultime 5 partite.
 */
async function computeTeamStats(teamId) {
  const recent = await apiFootball.getTeamRecentFixtures(teamId, 5);
  if (!recent || recent.length === 0) {
    // Fallback prudente se non ci sono dati sufficienti
    return { avgGoalsFor: 1.2, avgGoalsAgainst: 1.2, formPoints: 5, leagueAvgGoals: 1.3, sampleMatches: 0 };
  }

  let goalsFor = 0, goalsAgainst = 0, formPoints = 0;
  for (const f of recent) {
    const isHome = f.teams.home.id === teamId;
    const gf = isHome ? f.goals.home : f.goals.away;
    const ga = isHome ? f.goals.away : f.goals.home;
    goalsFor += gf || 0;
    goalsAgainst += ga || 0;

    const won = isHome ? f.teams.home.winner : f.teams.away.winner;
    if (won === true) formPoints += 3;
    else if (won === null && f.goals.home === f.goals.away) formPoints += 1;
  }

  return {
    avgGoalsFor: goalsFor / recent.length,
    avgGoalsAgainst: goalsAgainst / recent.length,
    formPoints,
    leagueAvgGoals: 1.3,
    sampleMatches: recent.length
  };
}

/**
 * Converte le quote grezze di API-Football nel formato atteso da valueEngine.
 */
function parseOddsResponse(oddsResponse) {
  const result = {};
  if (!oddsResponse || oddsResponse.length === 0) return { odds: result, bookmaker: null };

  // Usa il primo bookmaker disponibile
  const bookmakerData = oddsResponse[0]?.bookmakers?.[0];
  if (!bookmakerData) return { odds: result, bookmaker: null };

  for (const bet of bookmakerData.bets) {
    if (bet.name === 'Match Winner') {
      result['1X2'] = {};
      for (const v of bet.values) {
        if (v.value === 'Home') result['1X2'].home = parseFloat(v.odd);
        if (v.value === 'Draw') result['1X2'].draw = parseFloat(v.odd);
        if (v.value === 'Away') result['1X2'].away = parseFloat(v.odd);
      }
    }
    if (bet.name === 'Double Chance') {
      result['DOPPIA_CHANCE'] = {};
      for (const v of bet.values) {
        if (v.value === 'Home/Draw') result['DOPPIA_CHANCE']['1X'] = parseFloat(v.odd);
        if (v.value === 'Draw/Away') result['DOPPIA_CHANCE']['X2'] = parseFloat(v.odd);
        if (v.value === 'Home/Away') result['DOPPIA_CHANCE']['12'] = parseFloat(v.odd);
      }
    }
    if (bet.name === 'Goals Over/Under') {
      for (const v of bet.values) {
        if (v.value === 'Over 1.5') { result['OU_1.5'] = result['OU_1.5'] || {}; result['OU_1.5'].over = parseFloat(v.odd); }
        if (v.value === 'Under 1.5') { result['OU_1.5'] = result['OU_1.5'] || {}; result['OU_1.5'].under = parseFloat(v.odd); }
        if (v.value === 'Over 2.5') { result['OU_2.5'] = result['OU_2.5'] || {}; result['OU_2.5'].over = parseFloat(v.odd); }
        if (v.value === 'Under 2.5') { result['OU_2.5'] = result['OU_2.5'] || {}; result['OU_2.5'].under = parseFloat(v.odd); }
      }
    }
    if (bet.name === 'Both Teams Score') {
      result['BTTS'] = {};
      for (const v of bet.values) {
        if (v.value === 'Yes') result['BTTS'].yes = parseFloat(v.odd);
        if (v.value === 'No') result['BTTS'].no = parseFloat(v.odd);
      }
    }
  }

  return { odds: result, bookmaker: bookmakerData.name };
}

async function upsertTeamAndFixture(fixture) {
  const { teams, goals, fixture: info, league } = fixture;
  await pool.query(
    `INSERT INTO teams (id, name, league_id) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
    [teams.home.id, teams.home.name, league.id]
  );
  await pool.query(
    `INSERT INTO teams (id, name, league_id) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
    [teams.away.id, teams.away.name, league.id]
  );
  await pool.query(
    `INSERT INTO fixtures (id, league_id, season, date, home_team_id, away_team_id, home_goals, away_goals, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO UPDATE SET status = $9`,
    [info.id, league.id, CURRENT_SEASON, info.date, teams.home.id, teams.away.id, goals.home, goals.away, info.status.short]
  );
}

/**
 * Esegue l'analisi giornaliera completa: prende le fixtures del giorno (max 3),
 * calcola le statistiche squadra, cerca value bet su tutti i mercati, calcola lo
 * stake consigliato (Kelly) e salva tutto nel database. Restituisce un riepilogo.
 */
async function runDailyAnalysis() {
  const log = [];
  const fixtures = await apiFootball.getTodayFixtures(LEAGUE_IDS, CURRENT_SEASON);
  const selected = fixtures.slice(0, MAX_FIXTURES_PER_DAY);
  log.push(`Trovate ${fixtures.length} partite oggi, analizzo le prime ${selected.length}.`);

  // Bankroll attuale
  const bankrollRes = await pool.query(
    'SELECT balance_after FROM bankroll_log ORDER BY created_at DESC LIMIT 1'
  );
  const currentBankroll = bankrollRes.rows[0]?.balance_after ?? parseFloat(process.env.INITIAL_BANKROLL || '100');

  let totalValueBetsFound = 0;

  for (const fixture of selected) {
    const fixtureId = fixture.fixture.id;
    const homeTeam = fixture.teams.home;
    const awayTeam = fixture.teams.away;

    await upsertTeamAndFixture(fixture);

    const [homeStats, awayStats] = await Promise.all([
      computeTeamStats(homeTeam.id),
      computeTeamStats(awayTeam.id)
    ]);

    const oddsResponse = await apiFootball.getOddsForFixture(fixtureId);
    const { odds, bookmaker } = parseOddsResponse(oddsResponse);

    if (Object.keys(odds).length === 0) {
      log.push(`${homeTeam.name} vs ${awayTeam.name}: quote non disponibili, salto.`);
      continue;
    }

    // Salva le quote grezze
    for (const market of Object.keys(odds)) {
      for (const selection of Object.keys(odds[market])) {
        await pool.query(
          `INSERT INTO odds (fixture_id, bookmaker, market, selection, odd_value) VALUES ($1,$2,$3,$4,$5)`,
          [fixtureId, bookmaker, market, selection, odds[market][selection]]
        );
      }
    }

    const found = valueEngine.scanAllMarkets(homeStats, awayStats, odds, 3);
    log.push(`${homeTeam.name} vs ${awayTeam.name}: ${found.length} value bet trovate.`);

    for (const bet of found) {
      const stake = bankrollEngine.kellyStake(bet.bookmakerOdd, bet.estimatedProbability, currentBankroll);
      if (stake <= 0) continue;

      const commentary = await generateBetCommentary(bet, {
        homeTeam: homeTeam.name,
        awayTeam: awayTeam.name,
        sampleMatches: Math.min(homeStats.sampleMatches, awayStats.sampleMatches),
        injuries: []
      });

      await pool.query(
        `INSERT INTO value_bets (fixture_id, market, selection, bookmaker_odd, estimated_probability, implied_probability, edge_pct, recommended_stake, ai_commentary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [fixtureId, bet.market, bet.selection, bet.bookmakerOdd, bet.estimatedProbability, bet.impliedProbability, bet.edgePct, stake, commentary]
      );
      totalValueBetsFound++;
    }
  }

  log.push(`Analisi completata. Totale value bet salvate: ${totalValueBetsFound}. Richieste API usate: ${apiFootball.getRequestCount()}.`);
  return { log, totalValueBetsFound, requestsUsed: apiFootball.getRequestCount() };
}

module.exports = { runDailyAnalysis, computeTeamStats, parseOddsResponse };
