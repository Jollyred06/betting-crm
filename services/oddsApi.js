const axios = require('axios');
require('dotenv').config();

/**
 * Client per The Odds API (piano gratuito: 500 richieste/mese).
 * Fornisce le quote che football-data.org non ha. Il piano free copre
 * i mercati principali: h2h (1X2 per il calcio) e totals (over/under).
 * Non collega le partite per ID con football-data.org: l'abbinamento
 * va fatto per nome squadra (vedi matchOddsToFixture in orchestrator.js).
 */
let client = axios.create({
  baseURL: 'https://api.the-odds-api.com/v4'
});

let requestCount = 0;
let credits = { used: null, remaining: null };

// Protezione crediti: sotto questa soglia (modificabile con MIN_CREDITS su Render) le chiamate alle quote si fermano,
// cosi' i rilanci a mano non possono esaurire i 500 crediti del mese.
const MIN_CREDITS = parseInt(process.env.MIN_CREDITS || '60', 10);
let runCount = 0, runStartUsed = null;   // contatori del singolo giro (requestCount e' cumulativo dal riavvio del server)

function readCredits(resp) {
  const used = resp.headers['x-requests-used'], remaining = resp.headers['x-requests-remaining'];
  if (used !== undefined || remaining !== undefined) credits = { used: used ?? null, remaining: remaining ?? null };
}
function resetRun() { runCount = 0; runStartUsed = null; }

// Mappa codice competizione football-data.org -> sport key di The Odds API
const { LEAGUES } = require('./leagues');
const SPORT_KEY_MAP = { BSA: 'soccer_brazil_campeonato' };
for (const [code, l] of Object.entries(LEAGUES)) SPORT_KEY_MAP[code] = l.oddsKey;

async function getOddsForCompetition(competitionCode) {
  const sportKey = SPORT_KEY_MAP[competitionCode];
  if (!sportKey) return [];

  if (credits.remaining !== null && Number(credits.remaining) <= MIN_CREDITS)
    throw new Error(`crediti rimasti ${credits.remaining}, sotto la soglia di sicurezza (${MIN_CREDITS}): chiamata saltata`);

  requestCount++; runCount++;
  const resp = await client.get(`/sports/${sportKey}/odds`, {
    params: {
      apiKey: process.env.ODDS_API_KEY,
      regions: 'eu',
      markets: 'h2h',   // solo 1X2: 1 credito per campionato e per chiamata
      oddsFormat: 'decimal'
    }
  });
  readCredits(resp);
  if (runStartUsed === null && credits.used !== null) runStartUsed = Number(credits.used) - 1;   // prima di questa chiamata
  return resp.data; // array di eventi, ognuno con bookmakers -> markets -> outcomes
}

/**
 * Campionati attualmente in stagione su The Odds API (elenco gratuito, non consuma crediti).
 * Serve a non sprecare crediti su chiavi sbagliate o campionati fermi.
 */
async function getActiveSportKeys() {
  const resp = await client.get('/sports', { params: { apiKey: process.env.ODDS_API_KEY } });
  readCredits(resp);   // l'elenco e' gratuito ma le intestazioni dicono gia' quanti crediti restano: la protezione parte dalla prima lega
  return new Set(resp.data.filter(s => s.active).map(s => s.key));
}

function getCredits() {
  return credits;
}

function getRequestCount() {
  return requestCount;
}

/** Richieste e crediti spesi SOLO in questo giro. */
function getRunRequestCount() { return runCount; }
function getRunSpent() { return runStartUsed === null || credits.used === null ? 0 : Math.max(0, Number(credits.used) - runStartUsed); }
function __setClient(c) { client = c; }   // solo per i test

module.exports = { getOddsForCompetition, getActiveSportKeys, getCredits, getRequestCount, getRunRequestCount, getRunSpent, resetRun, MIN_CREDITS, SPORT_KEY_MAP, __setClient };
