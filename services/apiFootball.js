const axios = require('axios');
require('dotenv').config();

const client = axios.create({
  baseURL: `https://${process.env.API_FOOTBALL_HOST}`,
  headers: {
    'x-rapidapi-host': process.env.API_FOOTBALL_HOST,
    'x-rapidapi-key': process.env.API_FOOTBALL_KEY
  }
});

// Contatore richieste giornaliere in memoria (reset va gestito da cron/riavvio)
let requestCount = 0;
const DAILY_LIMIT = 100;

async function safeGet(path, params = {}) {
  if (requestCount >= DAILY_LIMIT) {
    throw new Error(`Limite giornaliero API raggiunto (${DAILY_LIMIT}). Riprova domani.`);
  }
  requestCount++;
  const { data } = await client.get(path, { params });
  return data.response;
}

function getRequestCount() {
  return requestCount;
}

// Fixtures di oggi per le leghe seguite
async function getTodayFixtures(leagueIds, season) {
  const today = new Date().toISOString().split('T')[0];
  const all = [];
  for (const leagueId of leagueIds) {
    const res = await safeGet('/fixtures', { league: leagueId, season, date: today });
    all.push(...res);
  }
  return all;
}

// Quote per una fixture specifica (mercati principali: 1X2, Over/Under, BTTS)
async function getOddsForFixture(fixtureId) {
  const res = await safeGet('/odds', { fixture: fixtureId });
  return res;
}

// Classifica di una lega
async function getStandings(leagueId, season) {
  const res = await safeGet('/standings', { league: leagueId, season });
  return res;
}

// Statistiche testa a testa
async function getH2H(team1Id, team2Id) {
  const res = await safeGet('/fixtures/headtohead', { h2h: `${team1Id}-${team2Id}` });
  return res;
}

// Storico fixtures per bulk import (usare con parsimonia - consuma richieste)
async function getHistoricalFixtures(leagueId, season) {
  const res = await safeGet('/fixtures', { league: leagueId, season });
  return res;
}

// Statistiche di una fixture (possesso, tiri totali, tiri in porta) per entrambe le squadre
async function getFixtureStatistics(fixtureId) {
  const res = await safeGet('/fixtures/statistics', { fixture: fixtureId });
  return res; // array con un elemento per squadra
}

// Info arbitro della partita (nome); le medie cartellini/rigori vanno derivate
// incrociando le sue partite precedenti (endpoint /fixtures con referee come filtro
// non è supportato nativamente: si calcola lato nostro dallo storico salvato in DB).
async function getFixtureReferee(fixtureId) {
  const res = await safeGet('/fixtures', { id: fixtureId });
  return res?.[0]?.fixture?.referee || null;
}

module.exports = {
  getTodayFixtures,
  getOddsForFixture,
  getStandings,
  getH2H,
  getHistoricalFixtures,
  getFixtureStatistics,
  getFixtureReferee,
  getRequestCount
};
