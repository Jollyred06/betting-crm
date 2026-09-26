/**
 * Motore di value betting — mercati coperti:
 * 1X2, Doppia Chance (1X/X2/12), Over/Under 1.5, Over/Under 2.5, BTTS.
 *
 * IMPORTANTE: la "probabilità stimata" usa un modello semplice basato su
 * statistiche storiche (forma squadra, gol fatti/subiti) tradotte in gol attesi
 * (Poisson). Non è una previsione infallibile: è una stima che, se sistematicamente
 * più accurata del mercato, genera un vantaggio (edge) nel lungo periodo.
 * Va validata con backtesting prima di puntare soldi veri.
 */

// Converte quota decimale in probabilità implicita dal bookmaker
function impliedProbability(odd) {
  return 1 / odd;
}

// Rimuove il margine del bookmaker (overround) da un set di quote 1X2
function removeOverround(odds) {
  const impliedSum = 1 / odds.home + 1 / odds.draw + 1 / odds.away;
  return {
    home: (1 / odds.home) / impliedSum,
    draw: (1 / odds.draw) / impliedSum,
    away: (1 / odds.away) / impliedSum
  };
}

// Fattoriale (serve per Poisson)
function factorial(n) {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

// Probabilità Poisson di segnare esattamente k gol con media lambda
function poissonProb(lambda, k) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/**
 * Calcola gol attesi (expected goals) per le due squadre a partire dalle statistiche.
 * teamStats: { avgGoalsFor, avgGoalsAgainst, formPoints (ultime 5, max 15) }
 */
function expectedGoals(homeStats, awayStats) {
  const homeXG = homeStats.avgGoalsFor * (awayStats.avgGoalsAgainst / (homeStats.leagueAvgGoals || 1.3)) * (homeStats.formPoints / 10);
  const awayXG = awayStats.avgGoalsFor * (homeStats.avgGoalsAgainst / (homeStats.leagueAvgGoals || 1.3)) * (awayStats.formPoints / 10);
  return { homeXG: Math.max(homeXG, 0.1), awayXG: Math.max(awayXG, 0.1) };
}

/**
 * Genera la matrice di probabilità dei risultati esatti (0-0, 1-0, ... fino a 6-6)
 * usando distribuzione Poisson indipendente per le due squadre.
 */
function scoreMatrix(homeXG, awayXG, maxGoals = 6) {
  const matrix = [];
  for (let h = 0; h <= maxGoals; h++) {
    const row = [];
    for (let a = 0; a <= maxGoals; a++) {
      row.push(poissonProb(homeXG, h) * poissonProb(awayXG, a));
    }
    matrix.push(row);
  }
  return matrix;
}

/**
 * Da una matrice di risultati esatti, deriva le probabilità per TUTTI i mercati:
 * 1X2, Doppia Chance, Over/Under 1.5, Over/Under 2.5, BTTS.
 */
function estimateAllMarkets(homeStats, awayStats) {
  const { homeXG, awayXG } = expectedGoals(homeStats, awayStats);
  const matrix = scoreMatrix(homeXG, awayXG);

  let pHome = 0, pDraw = 0, pAway = 0;
  let pOver15 = 0, pOver25 = 0, pBttsYes = 0;

  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix[h].length; a++) {
      const p = matrix[h][a];
      if (h > a) pHome += p;
      else if (h === a) pDraw += p;
      else pAway += p;

      if (h + a > 1.5) pOver15 += p;
      if (h + a > 2.5) pOver25 += p;
      if (h > 0 && a > 0) pBttsYes += p;
    }
  }

  return {
    '1X2': { home: pHome, draw: pDraw, away: pAway },
    'DOPPIA_CHANCE': {
      '1X': pHome + pDraw,
      'X2': pDraw + pAway,
      '12': pHome + pAway
    },
    'OU_1.5': { over: pOver15, under: 1 - pOver15 },
    'OU_2.5': { over: pOver25, under: 1 - pOver25 },
    'BTTS': { yes: pBttsYes, no: 1 - pBttsYes },
    expectedGoals: { homeXG, awayXG }
  };
}

// Manteniamo la funzione precedente per compatibilità (usa lo stesso modello aggiornato)
function estimateMatchProbabilities(homeStats, awayStats) {
  return estimateAllMarkets(homeStats, awayStats)['1X2'];
}

/**
 * Identifica una value bet su un singolo esito/quota.
 * edge = (estimatedProb * odd) - 1  →  positivo = value bet
 */
function findValueBet(bookmakerOdd, estimatedProbability, minEdgePct = 3) {
  const edge = (estimatedProbability * bookmakerOdd - 1) * 100;
  return {
    isValueBet: edge >= minEdgePct,
    edgePct: Number(edge.toFixed(3)),
    impliedProbability: Number(impliedProbability(bookmakerOdd).toFixed(4))
  };
}

/**
 * Scansiona TUTTI i mercati coperti per una partita e restituisce solo quelli con value.
 * bookmakerOdds: { '1X2': {home,draw,away}, 'DOPPIA_CHANCE': {'1X','X2','12'},
 *                   'OU_1.5': {over,under}, 'OU_2.5': {over,under}, 'BTTS': {yes,no} }
 */
function scanAllMarkets(homeStats, awayStats, bookmakerOdds, minEdgePct = 3) {
  const estimated = estimateAllMarkets(homeStats, awayStats);
  const found = [];

  for (const market of Object.keys(bookmakerOdds)) {
    const selections = bookmakerOdds[market];
    for (const selection of Object.keys(selections)) {
      const odd = selections[selection];
      const estProb = estimated[market]?.[selection];
      if (!odd || !estProb) continue;

      const result = findValueBet(odd, estProb, minEdgePct);
      if (result.isValueBet) {
        found.push({
          market,
          selection,
          bookmakerOdd: odd,
          estimatedProbability: Number(estProb.toFixed(4)),
          ...result
        });
      }
    }
  }

  return found.sort((a, b) => b.edgePct - a.edgePct);
}

module.exports = {
  impliedProbability,
  removeOverround,
  expectedGoals,
  estimateAllMarkets,
  estimateMatchProbabilities,
  findValueBet,
  scanAllMarkets
};
