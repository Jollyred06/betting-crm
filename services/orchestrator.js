const pool = require('../db/pool');
const footballData = require('./footballData');
const oddsApi = require('./oddsApi');
const valueEngine = require('./valueEngine');
const bankrollEngine = require('./bankrollEngine');
const { generateBetCommentary } = require('./aiCommentary');
const { sendTelegramNotification } = require('./notifier');
require('dotenv').config();

// Codici football-data.org: PL = Premier League, SA = Serie A
const COMPETITIONS = (process.env.COMPETITIONS || 'SA,PL').split(',').map(s => s.trim());
const MAX_FIXTURES_PER_DAY = 3;

/**
 * Calcola statistiche squadra (media gol fatti/subiti, forma) dalle ultime 5 partite,
 * usando football-data.org. Se venue è 'HOME' o 'AWAY', considera solo le partite
 * giocate in quel contesto (più preciso della forma mista: molte squadre rendono
 * diversamente in casa e in trasferta).
 */
async function computeTeamStats(teamId, venue = null, leagueAvgGoals = 1.3) {
  const recent = await footballData.getTeamRecentMatches(teamId, 5, venue);
  if (!recent || recent.length === 0) {
    // Fallback prudente se non ci sono dati sufficienti
    return { avgGoalsFor: 1.2, avgGoalsAgainst: 1.2, formPoints: 5, leagueAvgGoals, sampleMatches: 0 };
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
    leagueAvgGoals,
    sampleMatches: recent.length
  };
}

/**
 * Calcola la media gol per squadra a partita nella lega, dalla classifica
 * attuale (somma dei gol fatti / somma delle partite giocate su tutte le
 * squadre). Sostituisce il valore fisso 1.3, che era solo una stima
 * generica valida per un campionato europeo medio.
 */
function computeLeagueAvgGoals(standingsTable) {
  if (!standingsTable || standingsTable.length === 0) return 1.3;
  let totalGoals = 0, totalPlayed = 0;
  for (const row of standingsTable) {
    totalGoals += row.goalsFor || 0;
    totalPlayed += row.playedGames || 0;
  }
  if (totalPlayed === 0) return 1.3;
  return totalGoals / totalPlayed;
}

/**
 * Applica un piccolo correttivo alla forma in base al distacco in classifica
 * tra le due squadre (segnale aggiuntivo, non sostituisce la forma recente).
 * standingsMap: Map teamId -> posizione. Il correttivo è volutamente limitato
 * (max ±3 punti forma) per non dominare la stima rispetto ai dati reali di gioco.
 */
function applyStandingsAdjustment(stats, ownPosition, rivalPosition) {
  if (!ownPosition || !rivalPosition) return stats;
  const gap = rivalPosition - ownPosition; // positivo se il rivale è messo peggio
  const adjustment = Math.max(-3, Math.min(3, gap * 0.3));
  return { ...stats, formPoints: stats.formPoints + adjustment };
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
/**
 * Aggiorna odds/bookmakerBySelection tenendo, per ogni mercato/selezione,
 * la quota più alta trovata tra tutti i bookmaker (la migliore per chi
 * scommette: paga di più a parità di rischio).
 */
function updateBestOdd(odds, bookmakerBySelection, market, selection, price, bookmakerTitle) {
  odds[market] = odds[market] || {};
  bookmakerBySelection[market] = bookmakerBySelection[market] || {};
  if (!odds[market][selection] || price > odds[market][selection]) {
    odds[market][selection] = price;
    bookmakerBySelection[market][selection] = bookmakerTitle;
  }
}

/**
 * Converte l'evento di The Odds API nel formato atteso da valueEngine,
 * confrontando TUTTI i bookmaker disponibili e tenendo, per ogni mercato,
 * la quota più conveniente. Il piano gratuito copre h2h (1X2) e totals
 * (over/under, con vari punti).
 */
function parseOddsEvent(event) {
  const odds = {};
  const bookmakerBySelection = {};
  if (!event || !event.bookmakers?.length) return { odds, bookmakerBySelection };

  for (const bookmaker of event.bookmakers) {
    for (const market of bookmaker.markets) {
      if (market.key === 'h2h') {
        for (const outcome of market.outcomes) {
          let selection = null;
          if (teamsMatch(outcome.name, event.home_team)) selection = 'home';
          else if (teamsMatch(outcome.name, event.away_team)) selection = 'away';
          else if (outcome.name.toLowerCase() === 'draw') selection = 'draw';
          if (selection) updateBestOdd(odds, bookmakerBySelection, '1X2', selection, outcome.price, bookmaker.title);
        }
      }
      if (market.key === 'totals') {
        for (const outcome of market.outcomes) {
          const point = outcome.point;
          const marketKey = point === 1.5 ? 'OU_1.5' : point === 2.5 ? 'OU_2.5' : null;
          if (!marketKey) continue;
          const selection = outcome.name.toLowerCase() === 'over' ? 'over'
            : outcome.name.toLowerCase() === 'under' ? 'under' : null;
          if (!selection) continue;
          updateBestOdd(odds, bookmakerBySelection, marketKey, selection, outcome.price, bookmaker.title);
        }
      }
    }
  }

  return { odds, bookmakerBySelection };
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

  // Classifica per competizione (per il correttivo sul distacco in classifica
  // e per calibrare la media gol attesa sulla lega reale invece di un valore fisso)
  const standingsByCompetition = {};
  for (const code of COMPETITIONS) {
    try {
      const table = await footballData.getStandings(code);
      const positionMap = new Map(table.map(row => [row.team.id, row.position]));
      const leagueAvgGoals = computeLeagueAvgGoals(table);
      standingsByCompetition[code] = { positionMap, leagueAvgGoals };
    } catch (err) {
      log.push(`Classifica non disponibile per ${code}: ${err.message}`);
      standingsByCompetition[code] = { positionMap: new Map(), leagueAvgGoals: 1.3 };
    }
  }

  const bankrollRes = await pool.query(
    'SELECT balance_after FROM bankroll_log ORDER BY created_at DESC LIMIT 1'
  );
  const currentBankroll = bankrollRes.rows[0]?.balance_after ?? parseFloat(process.env.INITIAL_BANKROLL || '100');

  let totalValueBetsFound = 0;
  const foundBetsSummary = [];

  for (const match of selected) {
    const competitionCode = match.competition?.code || COMPETITIONS[0];
    const homeTeam = match.homeTeam;
    const awayTeam = match.awayTeam;

    await upsertTeamAndFixture(match, competitionCode);

    const { positionMap: standingsMap, leagueAvgGoals } = standingsByCompetition[competitionCode] || { positionMap: new Map(), leagueAvgGoals: 1.3 };

    const [homeStatsRaw, awayStatsRaw] = await Promise.all([
      computeTeamStats(homeTeam.id, 'HOME', leagueAvgGoals),
      computeTeamStats(awayTeam.id, 'AWAY', leagueAvgGoals)
    ]);

    const homePosition = standingsMap.get(homeTeam.id);
    const awayPosition = standingsMap.get(awayTeam.id);
    const homeStats = applyStandingsAdjustment(homeStatsRaw, homePosition, awayPosition);
    const awayStats = applyStandingsAdjustment(awayStatsRaw, awayPosition, homePosition);

    const oddsEvents = oddsByCompetition[competitionCode] || [];
    const event = findOddsEvent(oddsEvents, homeTeam.name, awayTeam.name);

    if (!event) {
      log.push(`${homeTeam.name} vs ${awayTeam.name}: nessuna quota corrispondente trovata, salto.`);
      continue;
    }

    const { odds, bookmakerBySelection } = parseOddsEvent(event);
    if (Object.keys(odds).length === 0) {
      log.push(`${homeTeam.name} vs ${awayTeam.name}: quote vuote, salto.`);
      continue;
    }

    for (const market of Object.keys(odds)) {
      for (const selection of Object.keys(odds[market])) {
        const bookmakerName = bookmakerBySelection[market]?.[selection] || null;
        await pool.query(
          `INSERT INTO odds (fixture_id, bookmaker, market, selection, odd_value) VALUES ($1,$2,$3,$4,$5)`,
          [match.id, bookmakerName, market, selection, odds[market][selection]]
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
        `INSERT INTO value_bets (fixture_id, market, selection, bookmaker_odd, bookmaker_name, estimated_probability, implied_probability, edge_pct, recommended_stake, ai_commentary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [match.id, bet.market, bet.selection, bet.bookmakerOdd, bookmakerBySelection[bet.market]?.[bet.selection] || null, bet.estimatedProbability, bet.impliedProbability, bet.edgePct, stake, commentary]
      );
      totalValueBetsFound++;
      foundBetsSummary.push({
        teams: `${homeTeam.name} vs ${awayTeam.name}`,
        market: bet.market,
        selection: bet.selection,
        odd: bet.bookmakerOdd,
        edge: bet.edgePct,
        stake,
        bookmaker: bookmakerBySelection[bet.market]?.[bet.selection] || 'n/d'
      });
    }
  }

  if (foundBetsSummary.length > 0) {
    const lines = foundBetsSummary.map(b =>
      `⚽ <b>${b.teams}</b>\n${b.market} - ${b.selection} @ ${Number(b.odd).toFixed(2)} (${b.bookmaker})\nEdge +${Number(b.edge).toFixed(1)}% · Stake €${Number(b.stake).toFixed(2)}`
    );
    await sendTelegramNotification(
      `🎯 <b>${foundBetsSummary.length} nuova/e value bet trovata/e</b>\n\n${lines.join('\n\n')}`
    );
  }

  log.push(`Analisi completata. Totale value bet salvate: ${totalValueBetsFound}. Richieste football-data.org: ${footballData.getRequestCount()}, richieste Odds API: ${oddsApi.getRequestCount()}.`);
  return { log, totalValueBetsFound, footballDataRequestsUsed: footballData.getRequestCount(), oddsApiRequestsUsed: oddsApi.getRequestCount() };
}

module.exports = { runDailyAnalysis, computeTeamStats, parseOddsEvent };
