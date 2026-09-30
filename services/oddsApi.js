const axios = require('axios');
require('dotenv').config();

/**
 * Client per The Odds API (piano gratuito: 500 richieste/mese).
 * Fornisce le quote che football-data.org non ha. Il piano free copre
 * i mercati principali: h2h (1X2 per il calcio) e totals (over/under).
 * Non collega le partite per ID con football-data.org: l'abbinamento
 * va fatto per nome squadra (vedi matchOddsToFixture in orchestrator.js).
 */
const client = axios.create({
  baseURL: 'https://api.the-odds-api.com/v4'
});

let requestCount = 0;
let credits = { used: null, remaining: null };

// Mappa codice competizione football-data.org -> sport key di The Odds API
const { LEAGUES } = require('./leagues');
const SPORT_KEY_MAP = { BSA: 'soccer_brazil_campeonato' };
for (const [code, l] of Object.entries(LEAGUES)) SPORT_KEY_MAP[code] = l.oddsKey;

async function getOddsForCompetition(competitionCode) {
  const sportKey = SPORT_KEY_MAP[competitionCode];
  if (!sportKey) return [];

  requestCount++;
  const resp = await client.get(`/sports/${sportKey}/odds`, {
    params: {
      apiKey: process.env.ODDS_API_KEY,
      regions: 'eu',
      markets: 'h2h',   // solo 1X2: 1 credito per campionato e per chiamata
      oddsFormat: 'decimal'
    }
  });
  credits = { used: resp.headers['x-requests-used'] ?? null, remaining: resp.headers['x-requests-remaining'] ?? null };
  return resp.data; // array di eventi, ognuno con bookmakers -> markets -> outcomes
}

/**
 * Campionati attualmente in stagione su The Odds API (elenco gratuito, non consuma crediti).
 * Serve a non sprecare crediti su chiavi sbagliate o campionati fermi.
 */
async function getActiveSportKeys() {
  const { data } = await client.get('/sports', { params: { apiKey: process.env.ODDS_API_KEY } });
  return new Set(data.filter(s => s.active).map(s => s.key));
}

function getCredits() {
  return credits;
}

function getRequestCount() {
  return requestCount;
}

module.exports = { getOddsForCompetition, getActiveSportKeys, getCredits, getRequestCount, SPORT_KEY_MAP };
