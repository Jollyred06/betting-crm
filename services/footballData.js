const axios = require('axios');
require('dotenv').config();

/**
 * Client per football-data.org (piano gratuito).
 * Copre 12 competizioni tra cui Premier League e Serie A, stagione corrente,
 * con un limite di 10 richieste/minuto. Non fornisce quote: quelle arrivano
 * da The Odds API (services/oddsApi.js).
 */
const client = axios.create({
  baseURL: 'https://api.football-data.org/v4',
  headers: {
    'X-Auth-Token': process.env.FOOTBALL_DATA_KEY
  }
});

let requestCount = 0;
// Limite prudente: il piano free è 10/minuto, non giornaliero, ma teniamo
// comunque un contatore per i log e per evitare loop accidentali.
const SAFETY_LIMIT = 90;

async function safeGet(path, params = {}) {
  if (requestCount >= SAFETY_LIMIT) {
    throw new Error(`Limite di sicurezza richieste football-data.org raggiunto (${SAFETY_LIMIT}).`);
  }
  requestCount++;
  const { data } = await client.get(path, { params });
  return data;
}

function getRequestCount() {
  return requestCount;
}

/**
 * Partite di oggi per le competizioni indicate (codici football-data.org,
 * es. 'PL' Premier League, 'SA' Serie A).
 */
async function getTodayFixtures(competitionCodes) {
  const today = new Date().toISOString().split('T')[0];
  const all = [];
  for (const code of competitionCodes) {
    const data = await safeGet(`/competitions/${code}/matches`, {
      dateFrom: today,
      dateTo: today
    });
    all.push(...(data.matches || []));
  }
  return all;
}

/**
 * Ultime N partite concluse di una squadra, per calcolare forma e media gol.
 */
async function getTeamRecentMatches(teamId, limit = 5) {
  const data = await safeGet(`/teams/${teamId}/matches`, {
    status: 'FINISHED',
    limit
  });
  return data.matches || [];
}

module.exports = {
  getTodayFixtures,
  getTeamRecentMatches,
  getRequestCount
};
