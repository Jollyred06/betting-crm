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

// Mappa codice competizione football-data.org -> sport key di The Odds API
const SPORT_KEY_MAP = {
  PL: 'soccer_epl',
  SA: 'soccer_italy_serie_a'
};

async function getOddsForCompetition(competitionCode) {
  const sportKey = SPORT_KEY_MAP[competitionCode];
  if (!sportKey) return [];

  requestCount++;
  const { data } = await client.get(`/sports/${sportKey}/odds`, {
    params: {
      apiKey: process.env.ODDS_API_KEY,
      regions: 'eu',
      markets: 'h2h,totals',
      oddsFormat: 'decimal'
    }
  });
  return data; // array di eventi, ognuno con bookmakers -> markets -> outcomes
}

function getRequestCount() {
  return requestCount;
}

module.exports = { getOddsForCompetition, getRequestCount, SPORT_KEY_MAP };
