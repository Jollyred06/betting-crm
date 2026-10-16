/** Copia di sicurezza di tutto cio' che non si puo' riscaricare: segnali, bankroll, tappe, log e partite collegate. Lo storico (historical_matches) si riscarica da solo. */
const SOURCES = [
  ['value_bets', 'SELECT * FROM value_bets ORDER BY id'],
  ['bankroll_log', 'SELECT * FROM bankroll_log ORDER BY id'],
  ['milestone_snapshots', 'SELECT * FROM milestone_snapshots ORDER BY target'],
  ['league_schedule', 'SELECT * FROM league_schedule ORDER BY league_code'],
  ['run_logs', 'SELECT * FROM run_logs ORDER BY run_at DESC LIMIT 120'],
  ['fixtures', 'SELECT * FROM fixtures WHERE id IN (SELECT fixture_id FROM value_bets) ORDER BY id'],
  ['teams', 'SELECT * FROM teams WHERE id IN (SELECT home_team_id FROM fixtures WHERE id IN (SELECT fixture_id FROM value_bets) UNION SELECT away_team_id FROM fixtures WHERE id IN (SELECT fixture_id FROM value_bets)) ORDER BY id']
];

async function buildBackup(pool, now = new Date()) {
  const out = { app: 'betting-crm', versione: 1, creato: now.toISOString(), righe: {}, errori: [], tabelle: {} };
  for (const [name, sql] of SOURCES) {
    try { const { rows } = await pool.query(sql); out.tabelle[name] = rows; out.righe[name] = rows.length; }
    catch (e) { out.tabelle[name] = null; out.righe[name] = null; out.errori.push(`${name}: ${e.message}`); }
  }
  return out;
}

module.exports = { buildBackup, SOURCES };
