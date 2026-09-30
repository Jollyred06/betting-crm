const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const bankrollEngine = require('../services/bankrollEngine');

// Lista value bets attive, ordinate per edge decrescente
router.get('/value-bets', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT vb.*, f.date, f.home_team_id, f.away_team_id,
              th.name AS home_team_name, ta.name AS away_team_name
       FROM value_bets vb
       JOIN fixtures f ON f.id = vb.fixture_id
       LEFT JOIN teams th ON th.id = f.home_team_id
       LEFT JOIN teams ta ON ta.id = f.away_team_id
       WHERE vb.status = 'pending'
       ORDER BY vb.edge_pct DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stato bankroll attuale + storico movimenti
router.get('/bankroll', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM bankroll_log ORDER BY created_at DESC LIMIT 50`
    );
    const currentBalance = rows[0]?.balance_after ?? parseFloat(process.env.INITIAL_BANKROLL || '100');
    res.json({ currentBalance, recentMovements: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Registra l'esito di una scommessa (won/lost/void) e aggiorna il bankroll.
// Se il body include "amount", quello vince sempre sul calcolo automatico:
// utile quando l'importo vinto/perso reale differisce da stake*quota
// (es. hai puntato un importo diverso da quello consigliato, o il
// bookmaker arrotonda la vincita).
router.post('/value-bets/:id/settle', async (req, res) => {
  const { id } = req.params;
  const { outcome, amount: manualAmount } = req.body; // outcome: 'won' | 'lost' | 'void'

  try {
    const betRes = await pool.query('SELECT * FROM value_bets WHERE id = $1', [id]);
    const bet = betRes.rows[0];
    if (!bet) return res.status(404).json({ error: 'Value bet non trovata' });

    const bankrollRes = await pool.query(
      'SELECT balance_after FROM bankroll_log ORDER BY created_at DESC LIMIT 1'
    );
    const currentBalance = bankrollRes.rows[0]?.balance_after ?? parseFloat(process.env.INITIAL_BANKROLL || '100');

    let amount = 0;
    if (manualAmount !== undefined && manualAmount !== null && manualAmount !== '') {
      // L'utente ha specificato l'importo reale: won → positivo, lost → negativo.
      // Accettiamo il valore assoluto e applichiamo il segno in base all'esito,
      // così l'utente può digitare sempre un numero positivo.
      const abs = Math.abs(parseFloat(manualAmount));
      if (outcome === 'won') amount = abs;
      else if (outcome === 'lost') amount = -abs;
      // void → resta 0 anche se è stato passato un importo per errore
    } else if (outcome === 'won') {
      amount = bet.recommended_stake * (bet.bookmaker_odd - 1);
    } else if (outcome === 'lost') {
      amount = -bet.recommended_stake;
    } // void → amount = 0

    const newBalance = Number((currentBalance + amount).toFixed(2));

    await pool.query('UPDATE value_bets SET status = $1 WHERE id = $2', [outcome, id]);
    await pool.query(
      `INSERT INTO bankroll_log (bet_id, amount, balance_after, note) VALUES ($1, $2, $3, $4)`,
      [id, amount, newBalance, `Esito: ${outcome}`]
    );

    res.json({ success: true, newBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aggiunge o rimuove fondi dal bankroll manualmente (deposito/prelievo).
// Le puntate future (Kelly) si adeguano automaticamente al nuovo saldo,
// perché il calcolo dello stake legge sempre l'ultimo balance_after.
router.post('/bankroll/adjust', async (req, res) => {
  const { amount, note } = req.body;

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount === 0) {
    return res.status(400).json({ error: 'Importo non valido' });
  }

  try {
    const bankrollRes = await pool.query(
      'SELECT balance_after FROM bankroll_log ORDER BY created_at DESC LIMIT 1'
    );
    const currentBalance = bankrollRes.rows[0]?.balance_after ?? parseFloat(process.env.INITIAL_BANKROLL || '100');
    const newBalance = Number((currentBalance + parsedAmount).toFixed(2));

    await pool.query(
      `INSERT INTO bankroll_log (bet_id, amount, balance_after, note) VALUES (NULL, $1, $2, $3)`,
      [parsedAmount, newBalance, note || (parsedAmount > 0 ? 'Deposito manuale' : 'Prelievo manuale')]
    );

    res.json({ success: true, newBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Statistiche aggregate: win-rate, ROI, riepilogo per mercato.
// Il profitto reale viene da bankroll_log (rispetta eventuali importi
// manuali inseriti col settle); lo stake totale viene da value_bets
// (recommended_stake), quindi il ROI è indicativo se l'utente ha puntato
// importi diversi da quelli consigliati.
router.get('/stats', async (req, res) => {
  try {
    const settledRes = await pool.query(
      `SELECT status, market, recommended_stake FROM value_bets WHERE status IN ('won','lost')`
    );
    const profitRes = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_profit FROM bankroll_log WHERE bet_id IS NOT NULL`
    );

    const settled = settledRes.rows;
    const won = settled.filter(r => r.status === 'won').length;
    const lost = settled.filter(r => r.status === 'lost').length;
    const totalSettled = won + lost;
    const winRate = totalSettled > 0 ? (won / totalSettled) * 100 : null;
    const totalStaked = settled.reduce((sum, r) => sum + Number(r.recommended_stake || 0), 0);
    const totalProfit = Number(profitRes.rows[0].total_profit);
    const roi = totalStaked > 0 ? (totalProfit / totalStaked) * 100 : null;

    const byMarket = {};
    for (const r of settled) {
      byMarket[r.market] = byMarket[r.market] || { won: 0, lost: 0 };
      byMarket[r.market][r.status]++;
    }

    res.json({
      totalSettled,
      won,
      lost,
      winRatePct: winRate,
      totalStaked: Number(totalStaked.toFixed(2)),
      totalProfit: Number(totalProfit.toFixed(2)),
      roiPct: roi,
      byMarket
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Numeri del tracker (strategia A): segnali, ROI a puntata fissa e valore medio rispetto alla chiusura.
router.get('/tracker-stats', async (req, res) => {
  try { res.json(await require('../services/weeklyReport').buildStats(pool)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Storico delle esecuzioni giornaliere (riuscite e fallite). Utile per
// controllare cosa è successo in passato senza dover rifare l'analisi:
// basta aprire questo indirizzo (o mostrarlo a Claude in una chat futura)
// per avere subito il contesto di cosa ha fatto il sistema nei giorni scorsi.
router.get('/logs', async (req, res) => {
  // Default 90 (~3 mesi con un'esecuzione al giorno). Si può chiedere di più
  // con ?limit=200, fino a un tetto di 365 per evitare risposte enormi.
  const requestedLimit = parseInt(req.query.limit, 10);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 365)
    : 90;

  try {
    const { rows } = await pool.query(
      `SELECT * FROM run_logs ORDER BY run_at DESC LIMIT $1`,
      [limit]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
