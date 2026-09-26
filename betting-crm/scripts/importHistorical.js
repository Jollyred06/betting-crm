/**
 * Script one-off per importare 2-3 stagioni storiche.
 * Rispetta il limite di 100 richieste/giorno: eseguilo una volta al giorno
 * finché non hai importato tutte le stagioni/leghe volute.
 *
 * Uso: node scripts/importHistorical.js
 */
require('dotenv').config();
const pool = require('../db/pool');
const { getHistoricalFixtures } = require('../services/apiFootball');

const LEAGUE_IDS = (process.env.LEAGUE_IDS || '135').split(',').map(Number);
const SEASONS_TO_IMPORT = [2023, 2024, 2025]; // adatta alle stagioni che ti servono

async function upsertTeam(team, leagueId) {
  await pool.query(
    `INSERT INTO teams (id, name, league_id) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [team.id, team.name, leagueId]
  );
}

async function upsertFixture(fixture, leagueId, season) {
  const { teams, goals, fixture: fixtureInfo } = fixture;
  await upsertTeam(teams.home, leagueId);
  await upsertTeam(teams.away, leagueId);

  await pool.query(
    `INSERT INTO fixtures (id, league_id, season, date, home_team_id, away_team_id, home_goals, away_goals, status, is_historical)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
     ON CONFLICT (id) DO UPDATE SET home_goals = $7, away_goals = $8, status = $9`,
    [
      fixtureInfo.id, leagueId, season, fixtureInfo.date,
      teams.home.id, teams.away.id,
      goals.home, goals.away, fixtureInfo.status.short
    ]
  );
}

async function run() {
  console.log('Avvio import storico. Attenzione al limite di 100 richieste/giorno.');

  for (const leagueId of LEAGUE_IDS) {
    for (const season of SEASONS_TO_IMPORT) {
      console.log(`Importo lega ${leagueId}, stagione ${season}...`);
      try {
        const fixtures = await getHistoricalFixtures(leagueId, season);
        for (const f of fixtures) {
          await upsertFixture(f, leagueId, season);
        }
        console.log(`  -> ${fixtures.length} partite importate.`);
      } catch (err) {
        console.error(`  ERRORE (probabile limite API raggiunto): ${err.message}`);
        console.log('Interrompo qui. Rilancia lo script domani per continuare.');
        process.exit(0);
      }
    }
  }

  console.log('Import completato.');
  process.exit(0);
}

run();
