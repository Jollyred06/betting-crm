const axios = require('axios');
require('dotenv').config();

// NOTA: se la chiave viene dal sito ufficiale api-football.com (dashboard.api-football.com),
// l'API si chiama direttamente su v3.football.api-sports.io con l'header x-apisports-key.
// Se invece la chiave viene da RapidAPI, servono gli header x-rapidapi-host/x-rapidapi-key
// e lo stesso host funziona comunque tramite il proxy RapidAPI.
// Qui usiamo il formato diretto (api-sports.io), quello del sito ufficiale.
const client = axios.create({
  baseURL: `https://${process.env.API_FOOTBALL_HOST}`,
  headers: {
    'x-apisports-key': process.env.API_FOOTBALL_KEY
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
  return res;
}

// Info arbitro della partita
async function getFixtureReferee(fixtureId) {
  const res = await safeGet('/fixtures', { id: fixtureId });
  return res?.[0]?.fixture?.referee || null;
}

// Ultime N partite di una squadra (per calcolare forma/media gol)
async function getTeamRecentFixtures(teamId, last = 5) {
  const res = await safeGet('/fixtures', { team: teamId, last });
  return res;
}

module.exports = {
  getTodayFixtures,
  getOddsForFixture,
  getStandings,
  getH2H,
  getHistoricalFixtures,
  getFixtureStatistics,
  getFixtureReferee,
  getTeamRecentFixtures,
  getRequestCount
};
