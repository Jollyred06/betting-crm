/**
 * Chiusura automatica dei segnali: cerca il risultato nello storico (football-data.co.uk),
 * registra vinta/persa e calcola il "valore rispetto alla chiusura" (CLV):
 * quota presa * probabilita' equa alla chiusura - 1. Se e' positivo in media, il segnale batte il mercato.
 * Il CLV vero e' contro la chiusura di PINNACLE, catturata poco prima del calcio d'inizio (services/closingCapture.js).
 * Solo se quella cattura manca si ripiega sulla MEDIA delle quote di chiusura (AvgC), perche' Pinnacle
 * da gennaio 2026 non e' piu' nei file; il ripiego e' marcato clv_source = 'avg'.
 */
const { resolveHistoryTeam } = require('./teamNames');

function outcomeFromScore(selection, hg, ag, market) {
  if (market && /^OU/.test(market)) {                          // Over/Under: market 'OU2.5' -> linea 2.5 (solo linee .5, niente rimborsi)
    const line = parseFloat(market.slice(2));
    return ((hg + ag > line) ? 'over' : 'under') === selection ? 'won' : 'lost';
  }
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

/** Partite recenti di un campionato dal database (una volta per giro). */
async function loadLeague(pool, byLeague, code) {
  if (!byLeague[code]) {
    const { rows } = await pool.query(
      `SELECT match_date::text AS date, home_team AS home, away_team AS away, home_goals AS hg, away_goals AS ag,
              close_avg_h, close_avg_d, close_avg_a
       FROM historical_matches WHERE league_code = $1 AND match_date >= CURRENT_DATE - INTERVAL '60 days'`, [code]);
    byLeague[code] = { rows, names: [...new Set(rows.flatMap(r => [r.home, r.away]))] };
  }
  return byLeague[code];
}

/**
 * Controllo dei risultati scritti a mano (ultimi 14 giorni): appena la partita compare nel file ufficiale di football-data.co.uk
 * (gratis, nessun credito) si confronta il punteggio. Se e' uguale non si fa nulla; se e' diverso vince il file ufficiale:
 * si corregge il segnale e il bankroll con una riga di correzione (la differenza), e il giro lo scrive nel Log.
 */
async function verifyManual(pool, ctx) {
  const out = { checked: 0, same: 0, notYet: 0, corrected: [] }, cols = ctx.cols;
  const { rows } = await pool.query(
    `SELECT vb.id, vb.selection, vb.bookmaker_odd, vb.recommended_stake, vb.status, vb.result_score, vb.league_code, f.date,
            ${cols ? 'vb.quota_presa,' : ''} th.name AS home_name, ta.name AS away_name
     FROM value_bets vb JOIN fixtures f ON f.id = vb.fixture_id
     LEFT JOIN teams th ON th.id = f.home_team_id LEFT JOIN teams ta ON ta.id = f.away_team_id
     WHERE vb.strategy = 'A_sharp' AND vb.status IN ('won','lost') AND vb.settled_at >= NOW() - INTERVAL '14 days'
       AND EXISTS (SELECT 1 FROM bankroll_log bl WHERE bl.bet_id = vb.id AND bl.note LIKE 'Esito a mano%')`);
  for (const b of rows) {
    if (b.status !== 'won' && b.status !== 'lost') continue;
    if (!ctx.refreshed.has(b.league_code)) {
      ctx.refreshed.add(b.league_code);
      try { await require('./history').refreshCurrentSeason(pool, b.league_code, ctx.today); } catch (e) { /* si usa quello che c'e' gia' */ }
    }
    const L = await loadLeague(pool, ctx.byLeague, b.league_code);
    const res = findResult(L.rows, b.home_name, b.away_name, new Date(b.date).toISOString().slice(0, 10), L.names);
    if (!res) { out.notYet++; continue; }                                 // il file non ha ancora la partita: si ricontrolla al prossimo giro
    out.checked++;
    const score = `${res.hg}-${res.ag}`;
    if (score === b.result_score) { out.same++; continue; }
    const outcome = outcomeFromScore(b.selection, res.hg, res.ag);
    const stake = Number(b.recommended_stake || 0), odd = Number((cols && b.quota_presa) || b.bookmaker_odd);
    const pnl = o => (o === 'won' ? stake * (odd - 1) : -stake);
    const delta = Number((pnl(outcome) - pnl(b.status)).toFixed(2));
    await pool.query(`UPDATE value_bets SET status=$1, result_score=$2 WHERE id=$3`, [outcome, score, b.id]);
    if (delta !== 0) {
      const bal = (await pool.query('SELECT balance_after FROM bankroll_log ORDER BY created_at DESC LIMIT 1')).rows[0];
      const newBalance = Number((Number(bal ? bal.balance_after : process.env.INITIAL_BANKROLL || 100) + delta).toFixed(2));
      await pool.query(`INSERT INTO bankroll_log (bet_id, amount, balance_after, note) VALUES ($1,$2,$3,$4)`,
        [b.id, delta, newBalance, `Correzione: a mano ${b.result_score}, nel file ufficiale ${score} (${outcome})`]);
    }
    out.corrected.push({ id: b.id, home: b.home_name, away: b.away_name, was: b.result_score, now: score, outcomeChanged: outcome !== b.status, delta });
  }
  return out;
}

async function settlePending(pool) {
  const cols = await hasClosingCols(pool);
  const { rows: pend } = await pool.query(
    `SELECT vb.id, vb.market, vb.selection, vb.bookmaker_odd, vb.recommended_stake, vb.league_code, f.date,
            ${cols ? 'vb.quota_presa, vb.clv_source, vb.closing_fair_prob,' : ''}
            th.name AS home_name, ta.name AS away_name
     FROM value_bets vb JOIN fixtures f ON f.id = vb.fixture_id
     LEFT JOIN teams th ON th.id = f.home_team_id LEFT JOIN teams ta ON ta.id = f.away_team_id
     WHERE vb.status = 'pending' AND vb.league_code IS NOT NULL AND f.date < NOW() - INTERVAL '3 hours'`);
  // Prima di cercare i risultati si riscarica il file della stagione dei campionati con segnali aperti (gratis, nessun credito):
  // prima il file arrivava solo dopo la chiusura e ogni esito slittava di un giorno; cosi' anche il pulsante "Chiudi i risultati ora" funziona.
  const today = new Date().toISOString().slice(0, 10);
  const refreshed = new Set();
  for (const code of [...new Set(pend.map(b => b.league_code))]) {
    refreshed.add(code);
    try { await require('./history').refreshCurrentSeason(pool, code, today); } catch (e) { /* si usa quello che c'e' gia' */ }
  }
  const byLeague = {};
  let settled = 0;
  for (const b of pend) {
    const L = await loadLeague(pool, byLeague, b.league_code);
    const dateStr = new Date(b.date).toISOString().slice(0, 10);
    const res = findResult(L.rows, b.home_name, b.away_name, dateStr, L.names);
    if (!res) continue;                                   // risultato non ancora nel file: riprova al prossimo giro
    const outcome = outcomeFromScore(b.selection, res.hg, res.ag, b.market);
    const stake = Number(b.recommended_stake || 0), odd = Number((cols && b.quota_presa) || b.bookmaker_odd);   // si guadagna/perde sulla quota PRESA
    const amount = outcome === 'won' ? stake * (odd - 1) : -stake;
    const bal = (await pool.query('SELECT balance_after FROM bankroll_log ORDER BY created_at DESC LIMIT 1')).rows[0];
    const newBalance = Number((Number(bal ? bal.balance_after : process.env.INITIAL_BANKROLL || 100) + amount).toFixed(2));
    let upd;
    if (cols && b.clv_source === 'pinnacle' && b.closing_fair_prob !== null && b.closing_fair_prob !== undefined) {
      // il valore vs chiusura Pinnacle e' gia' stato salvato poco prima del calcio d'inizio: non si tocca
      upd = await pool.query(`UPDATE value_bets SET status=$1, result_score=$2, settled_at=NOW() WHERE id=$3 AND status='pending'`, [outcome, `${res.hg}-${res.ag}`, b.id]);
    } else {
      // ripiego (cattura Pinnacle mancata): media di chiusura dei bookmaker, marcata come tale e NON conteggiata nel CLV Pinnacle
      const fair = /^OU/.test(b.market || '') ? null : closingFair(res, b.selection), clv = clvPct(odd, fair);   // Over/Under: nessun ripiego sulla media (il file non ha i totals di chiusura)
      if (cols) upd = await pool.query(`UPDATE value_bets SET status=$1, result_score=$2, closing_fair_prob=$3, clv_pct=$4, clv_source=$5, settled_at=NOW() WHERE id=$6 AND status='pending'`,
        [outcome, `${res.hg}-${res.ag}`, fair, clv, fair ? 'avg' : null, b.id]);
      else upd = await pool.query(`UPDATE value_bets SET status=$1, result_score=$2, closing_fair_prob=$3, clv_pct=$4, settled_at=NOW() WHERE id=$5 AND status='pending'`,
        [outcome, `${res.hg}-${res.ag}`, fair, clv, b.id]);
    }
    if (upd && upd.rowCount === 0) continue;                      // chiuso nel frattempo da un altro giro: niente doppio movimento di bankroll
    await pool.query(`INSERT INTO bankroll_log (bet_id, amount, balance_after, note) VALUES ($1,$2,$3,$4)`,
      [b.id, Number(amount.toFixed(2)), newBalance, `Esito automatico: ${outcome} (${res.hg}-${res.ag})`]);
    settled++;
  }
  let manual = { checked: 0, same: 0, notYet: 0, corrected: [] };
  try { manual = await verifyManual(pool, { byLeague, refreshed, today, cols }); } catch (e) { /* il controllo non deve mai bloccare la chiusura */ }
  return { settled, stillPending: pend.length - settled, manual };
}


/** Chiusura a mano di un segnale (quando il risultato non e' ancora nei file): stesso calcolo dell'esito automatico, stesso bankroll. */
async function settleManual(pool, id, homeGoals, awayGoals) {
  const hg = Number(homeGoals), ag = Number(awayGoals), fail = (status, msg) => Object.assign(new Error(msg), { status });
  if (![hg, ag].every(n => Number.isInteger(n) && n >= 0 && n <= 30)) throw fail(400, 'Risultato non valido: servono due numeri di gol.');
  const cols = await hasClosingCols(pool);
  const { rows } = await pool.query(
    `SELECT id, selection, bookmaker_odd, recommended_stake, status ${cols ? ', quota_presa' : ''} FROM value_bets WHERE id = $1 AND strategy = 'A_sharp'`, [id]);
  const b = rows[0];
  if (!b) throw fail(404, 'Segnale non trovato.');
  if (b.status !== 'pending') throw fail(409, 'Segnale già chiuso.');
  const outcome = outcomeFromScore(b.selection, hg, ag);
  const stake = Number(b.recommended_stake || 0), odd = Number((cols && b.quota_presa) || b.bookmaker_odd);
  const amount = outcome === 'won' ? stake * (odd - 1) : -stake;
  const bal = (await pool.query('SELECT balance_after FROM bankroll_log ORDER BY created_at DESC LIMIT 1')).rows[0];
  const newBalance = Number((Number(bal ? bal.balance_after : process.env.INITIAL_BANKROLL || 100) + amount).toFixed(2));
  const upd = await pool.query(`UPDATE value_bets SET status=$1, result_score=$2, settled_at=NOW() WHERE id=$3 AND status='pending'`, [outcome, `${hg}-${ag}`, id]);
  if (upd.rowCount === 0) throw fail(409, 'Segnale già chiuso.');                  // chiuso nel frattempo dal giro automatico
  await pool.query(`INSERT INTO bankroll_log (bet_id, amount, balance_after, note) VALUES ($1,$2,$3,$4)`,
    [id, Number(amount.toFixed(2)), newBalance, `Esito a mano: ${outcome} (${hg}-${ag})`]);
  return { outcome, newBalance, score: `${hg}-${ag}` };
}

module.exports = { outcomeFromScore, closingFair, clvPct, findResult, settlePending, settleManual, verifyManual };
