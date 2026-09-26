const pool = require('../db/pool');
const footballData = require('./footballData');
const oddsApi = require('./oddsApi');
const valueEngine = require('./valueEngine');
const bankrollEngine = require('./bankrollEngine');
const { generateBetCommentary } = require('./aiCommentary');
require('dotenv').config();

// Codici football-data.org: PL = Premier League, SA = Serie A
const COMPETITIONS = (process.env.COMPETITIONS || 'SA,PL').split(',').map(s => s.trim());
const MAX_FIXTURES_PER_DAY = 3;

/**
 * Calcola statistiche squadra (media gol fatti/subiti, forma) dalle ultime 5 partite,
 * usando football-data.org.
 */
async function computeTeamStats(teamId) {
  const recent = await footballData.getTeamRecentMatches(teamId, 5);
  if (!recent || recent.length === 0) {
    // Fallback prudente se non ci sono dati sufficienti
    return { avgGoalsFor: 1.2, avgGoalsAgainst: 1.2, formPoints: 5, leagueAvgGoals: 1.3, sampleMatches: 0 };
  }

  let goalsFor = 0, goalsAgainst = 0, formPoints = 0;
  for (const m of recent) {
    const isHome = m.homeTeam.id === teamId;
    const gf = isHome ? m.score.fullTime.home : m.score.fullTime.away;
    const ga = isHome ? m.score.fullTime.away : m.score.fullTime.home;
    goalsFor += gf || 0;
    goalsAgainst += ga || 0;

    const winner = m.score.winner; // HOME_TEAM, AWAY_TEAM, DRAW
    if ((isHome && winner === 'HOME_TEAM') || (!isHome && winner === 'AWAY_TEAM')) formPoints += 3;
    else if (winner === 'DRAW') formPoints += 1;
  }

  return {
    avgGoalsFor: goalsFor / recent.length,
    avgGoalsAgainst: goalsAgainst / recent.length,
    formPoints,
    leagueAvgGoals: 1.3,
    sampleMatches: recent.length
  };
}

// Normalizza un nome squadra per il confronto (minuscolo, senza FC/CF/AC ecc.)
function normalizeTeamName(name) {
  return name
    .toLowerCase()
    .replace(/\b(fc|cf|ac|calcio|club|de|football)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function teamsMatch(nameA, nameB) {
  const a = normalizeTeamName(nameA);
  const b = normalizeTeamName(nameB);
  return a.includes(b) || b.includes(a);
}

/**
 * Trova, tra gli eventi restituiti da The Odds API, quello corrispondente
 * alla fixture data (abbinamento per nome squadra, non per ID).
 */
function findOddsEvent(oddsEvents, homeTeamName, awayTeamName) {
  return oddsEvents.find(ev =>
    teamsMatch(ev.home_team, homeTeamName) && teamsMatch(ev.away_team, awayTeamName)
  );
}

/**
 * Converte l'evento di The Odds API nel formato atteso da valueEngine.
 * Il piano gratuito copre h2h (1X2) e totals (over/under, con vari punti).
 */
function parseOddsEvent(event) {
  if (!event || !event.bookmakers?.length) return { odds: {}, bookmaker: null };

  const bookmaker = event.bookmakers[0];
  const odds = {};

  for (const market of bookmaker.markets) {
    if (market.key === 'h2h') {
      odds['1X2'] = {};
      for (const outcome of market.outcomes) {
        if (teamsMatch(outcome.name, event.home_team)) odds['1X2'].home = outcome.price;
        else if (teamsMatch(outcome.name, event.away_team)) odds['1X2'].away = outcome.price;
        else if (outcome.name.toLowerCase() === 'draw') odds['1X2'].draw = outcome.price;
      }
    }
    if (market.key === 'totals') {
      for (const outcome of market.outcomes) {
        const point = outcome.point;
        const marketKey = point === 1.5 ? 'OU_1.5' : point === 2.5 ? 'OU_2.5' : null;
        if (!marketKey) continue;
        odds[marketKey] = odds[marketKey] || {};
        if (outcome.name.toLowerCase() === 'over') odds[marketKey].over = outcome.price;
        if (outcome.name.toLowerCase() === 'under') odds[marketKey].under = outcome.price;
      }
    }
  }

  return { odds, bookmaker: bookmaker.title };
}

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

/**
 * Esegue l'analisi giornaliera completa: prende le fixtures del giorno (max 3)
 * da football-data.org, calcola le statistiche squadra, prende le quote da
 * The Odds API abbinandole per nome squadra, cerca value bet su tutti i
 * mercati disponibili, calcola lo stake (Kelly) e salva tutto nel database.
 */
async function runDailyAnalysis() {
  const log = [];
  const fixtures = await footballData.getTodayFixtures(COMPETITIONS);
  const selected = fixtures.slice(0, MAX_FIXTURES_PER_DAY);
  log.push(`Trovate ${fixtures.length} partite oggi, analizzo le prime ${selected.length}.`);

  // Prendiamo le quote una volta per competizione (copre tutte le partite di quella lega)
  const oddsByCompetition = {};
  for (const code of COMPETITIONS) {
    try {
      oddsByCompetition[code] = await oddsApi.getOddsForCompetition(code);
    } catch (err) {
      log.push(`Quote non disponibili per ${code}: ${err.message}`);
      oddsByCompetition[code] = [];
    }
  }

  const bankrollRes = await pool.query(
    'SELECT balance_after FROM bankroll_log ORDER BY created_at DESC LIMIT 1'
  );
  const currentBankroll = bankrollRes.rows[0]?.balance_after ?? parseFloat(process.env.INITIAL_BANKROLL || '100');

  let totalValueBetsFound = 0;

  for (const match of selected) {
    const competitionCode = match.competition?.code || COMPETITIONS[0];
    const homeTeam = match.homeTeam;
    const awayTeam = match.awayTeam;

    await upsertTeamAndFixture(match, competitionCode);

    const [homeStats, awayStats] = await Promise.all([
      computeTeamStats(homeTeam.id),
      computeTeamStats(awayTeam.id)
    ]);

    const oddsEvents = oddsByCompetition[competitionCode] || [];
    const event = findOddsEvent(oddsEvents, homeTeam.name, awayTeam.name);

    if (!event) {
      log.push(`${homeTeam.name} vs ${awayTeam.name}: nessuna quota corrispondente trovata, salto.`);
      continue;
    }

    const { odds, bookmaker } = parseOddsEvent(event);
    if (Object.keys(odds).length === 0) {
      log.push(`${homeTeam.name} vs ${awayTeam.name}: quote vuote, salto.`);
      continue;
    }

    for (const market of Object.keys(odds)) {
      for (const selection of Object.keys(odds[market])) {
        await pool.query(
          `INSERT INTO odds (fixture_id, bookmaker, market, selection, odd_value) VALUES ($1,$2,$3,$4,$5)`,
          [match.id, bookmaker, market, selection, odds[market][selection]]
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
        [match.id, bet.market, bet.selection, bet.bookmakerOdd, bet.estimatedProbability, bet.impliedProbability, bet.edgePct, stake, commentary]
      );
      totalValueBetsFound++;
    }
  }

  log.push(`Analisi completata. Totale value bet salvate: ${totalValueBetsFound}. Richieste football-data.org: ${footballData.getRequestCount()}, richieste Odds API: ${oddsApi.getRequestCount()}.`);
  return { log, totalValueBetsFound, footballDataRequestsUsed: footballData.getRequestCount(), oddsApiRequestsUsed: oddsApi.getRequestCount() };
}

module.exports = { runDailyAnalysis, computeTeamStats, parseOddsEvent };
