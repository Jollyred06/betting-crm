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

/** Interruttore Over/Under: spento di default. Con TOTALS_ENABLED=1 il giro giornaliero chiede anche i totals (2 crediti per campionato invece di 1). */
const totalsEnabled = () => process.env.TOTALS_ENABLED === '1';

async function getOddsForCompetition(competitionCode, { markets } = {}) {
  const sportKey = SPORT_KEY_MAP[competitionCode];
  if (!sportKey) return [];

  if (credits.remaining !== null && Number(credits.remaining) <= MIN_CREDITS)
    throw new Error(`crediti rimasti ${credits.remaining}, sotto la soglia di sicurezza (${MIN_CREDITS}): chiamata saltata`);

  const mk = markets || (totalsEnabled() ? 'h2h,totals' : 'h2h'), cost = mk.split(',').length;   // 1 credito per mercato e per chiamata
  requestCount++; runCount++;
  const resp = await client.get(`/sports/${sportKey}/odds`, {
    params: {
      apiKey: process.env.ODDS_API_KEY,
      regions: 'eu',
      markets: mk,
      oddsFormat: 'decimal'
    }
  });
  readCredits(resp);
  if (runStartUsed === null && credits.used !== null) runStartUsed = Number(credits.used) - cost;   // prima di questa chiamata
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

/**
 * Budget del singolo giro (24 ottobre 2026). I 500 crediti del mese finivano in 10-12 giorni (20 campionati x 2 giri al giorno
 * + catture di chiusura), poi la strategia A restava ferma fino al rinnovo. Ora ogni giro spende al massimo:
 *   (crediti rimasti - MIN_CREDITS - riserva chiusure x giorni al rinnovo) / giorni al rinnovo / giri al giorno
 * Si ricalcola a ogni giro dai crediti veri: i giorni senza partite lasciano crediti ai successivi, un giro in piu' li toglie.
 * Variabili su Render: ODDS_RESET_DAY (giorno del mese del rinnovo, predefinito 1), ODDS_RUNS_PER_DAY (2),
 * ODDS_CLOSE_RESERVE_PER_DAY (4 crediti al giorno tenuti per le chiusure), ODDS_PACING=0 per spegnerlo.
 * Ritorna null se i crediti non sono noti o il controllo e' spento (in quel caso vale solo MIN_CREDITS).
 */
function daysToReset(now = new Date(), resetDay = 1) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  let next = Date.UTC(y, m, resetDay);
  if (next <= now.getTime()) next = Date.UTC(y, m + 1, resetDay);
  return Math.max(1, Math.ceil((next - now.getTime()) / 86400000));
}
function runBudget({ now = new Date(), env = process.env, remaining = credits.remaining } = {}) {
  if (env.ODDS_PACING === '0' || remaining === null || remaining === undefined || remaining === '') return null;
  const n = (k, d) => (env[k] !== undefined && env[k] !== '' && !isNaN(Number(env[k])) ? Number(env[k]) : d);
  const minCredits = n('MIN_CREDITS', MIN_CREDITS);
  const days = daysToReset(now, n('ODDS_RESET_DAY', 1));
  const runs = Math.max(1, n('ODDS_RUNS_PER_DAY', 2)), reserve = Math.max(0, n('ODDS_CLOSE_RESERVE_PER_DAY', 4));
  const available = Number(remaining) - minCredits - reserve * days;
  return { budget: Math.max(0, Math.floor(available / days / runs)), days, remaining: Number(remaining) };
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

module.exports = { runBudget, daysToReset, totalsEnabled, getOddsForCompetition, getActiveSportKeys, getCredits, getRequestCount, getRunRequestCount, getRunSpent, resetRun, MIN_CREDITS, SPORT_KEY_MAP, __setClient };
