/**
 * Chiusura automatica dei segnali: cerca il risultato nello storico (football-data.co.uk),
 * registra vinta/persa e calcola il "valore rispetto alla chiusura" (CLV):
 * quota presa * probabilita' equa alla chiusura - 1. Se e' positivo in media, il segnale batte il mercato.
 * Il CLV vero e' contro la chiusura di PINNACLE, catturata poco prima del calcio d'inizio (services/closingCapture.js).
 * Solo se quella cattura manca si ripiega sulla MEDIA delle quote di chiusura (AvgC), perche' Pinnacle
 * da gennaio 2026 non e' piu' nei file; il ripiego e' marcato clv_source = 'avg'.
 */
const { resolveHistoryTeam } = require('./teamNames');

function outcomeFromScore(selection, hg, ag) {
  const actual = hg > ag ? 'home' : hg < ag ? 'away' : 'draw';
  return actual === selection ? 'won' : 'lost';
}

function closingFair(row, selection) {
  const h = Number(row.close_avg_h), d = Number(row.close_avg_d), a = Number(row.close_avg_a);
  if (!(h > 1 && d > 1 && a > 1)) return null;
  const inv = { home: 1 / h, draw: 1 / d, away: 1 / a }, s = inv.home + inv.draw + inv.away;
  return inv[selection] / s;
}

const clvPct = (odd, fair) => (fair ? (Number(odd) * fair - 1) * 100 : null);

function dayDiff(a, b) { return Math.abs(Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000; }

/** Trova nello storico la partita (stessa lega, data entro 1 giorno, stesse squadre). */
function findResult(rows, homeName, awayName, dateStr, csvNames) {
  const h = resolveHistoryTeam(homeName, csvNames), a = resolveHistoryTeam(awayName, csvNames);
  if (!h || !a) return null;
  return rows.find(r => r.home === h && r.away === a && dayDiff(r.date, dateStr) <= 1) || null;
}

/** True se lo schema ha le colonne della cattura Pinnacle (db/schema.sql rieseguito). Se mancano si lavora come prima. */
async function hasClosingCols(pool) {
  try { await pool.query('SELECT quota_presa, clv_source, closing_fair_prob FROM value_bets LIMIT 0'); return true; }
  catch (e) { return false; }
}

async function settlePending(pool) {
  const cols = await hasClosingCols(pool);
  const { rows: pend } = await pool.query(
    `SELECT vb.id, vb.selection, vb.bookmaker_odd, vb.recommended_stake, vb.league_code, f.date,
            ${cols ? 'vb.quota_presa, vb.clv_source, vb.closing_fair_prob,' : ''}
            th.name AS home_name, ta.name AS away_name
     FROM value_bets vb JOIN fixtures f ON f.id = vb.fixture_id
     LEFT JOIN teams th ON th.id = f.home_team_id LEFT JOIN teams ta ON ta.id = f.away_team_id
     WHERE vb.status = 'pending' AND vb.league_code IS NOT NULL AND f.date < NOW() - INTERVAL '3 hours'`);
  const byLeague = {};
  let settled = 0;
  for (const b of pend) {
    if (!byLeague[b.league_code]) {
      const { rows } = await pool.query(
        `SELECT match_date::text AS date, home_team AS home, away_team AS away, home_goals AS hg, away_goals AS ag,
                close_avg_h, close_avg_d, close_avg_a
         FROM historical_matches WHERE league_code = $1 AND match_date >= CURRENT_DATE - INTERVAL '60 days'`, [b.league_code]);
      byLeague[b.league_code] = { rows, names: [...new Set(rows.flatMap(r => [r.home, r.away]))] };
    }
    const L = byLeague[b.league_code];
    const dateStr = new Date(b.date).toISOString().slice(0, 10);
    const res = findResult(L.rows, b.home_name, b.away_name, dateStr, L.names);
    if (!res) continue;                                   // risultato non ancora nel file: riprova al prossimo giro
    const outcome = outcomeFromScore(b.selection, res.hg, res.ag);
    const stake = Number(b.recommended_stake || 0), odd = Number((cols && b.quota_presa) || b.bookmaker_odd);   // si guadagna/perde sulla quota PRESA
    const amount = outcome === 'won' ? stake * (odd - 1) : -stake;
    const bal = (await pool.query('SELECT balance_after FROM bankroll_log ORDER BY created_at DESC LIMIT 1')).rows[0];
    const newBalance = Number((Number(bal ? bal.balance_after : process.env.INITIAL_BANKROLL || 100) + amount).toFixed(2));
    if (cols && b.clv_source === 'pinnacle' && b.closing_fair_prob !== null && b.closing_fair_prob !== undefined) {
      // il valore vs chiusura Pinnacle e' gia' stato salvato poco prima del calcio d'inizio: non si tocca
      await pool.query(`UPDATE value_bets SET status=$1, result_score=$2, settled_at=NOW() WHERE id=$3`, [outcome, `${res.hg}-${res.ag}`, b.id]);
    } else {
      // ripiego (cattura Pinnacle mancata): media di chiusura dei bookmaker, marcata come tale e NON conteggiata nel CLV Pinnacle
      const fair = closingFair(res, b.selection), clv = clvPct(odd, fair);
      if (cols) await pool.query(`UPDATE value_bets SET status=$1, result_score=$2, closing_fair_prob=$3, clv_pct=$4, clv_source=$5, settled_at=NOW() WHERE id=$6`,
        [outcome, `${res.hg}-${res.ag}`, fair, clv, fair ? 'avg' : null, b.id]);
      else await pool.query(`UPDATE value_bets SET status=$1, result_score=$2, closing_fair_prob=$3, clv_pct=$4, settled_at=NOW() WHERE id=$5`,
        [outcome, `${res.hg}-${res.ag}`, fair, clv, b.id]);
    }
    await pool.query(`INSERT INTO bankroll_log (bet_id, amount, balance_after, note) VALUES ($1,$2,$3,$4)`,
      [b.id, Number(amount.toFixed(2)), newBalance, `Esito automatico: ${outcome} (${res.hg}-${res.ag})`]);
    settled++;
  }
  return { settled, stillPending: pend.length - settled };
}

module.exports = { outcomeFromScore, closingFair, clvPct, findResult, settlePending };
