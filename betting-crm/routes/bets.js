const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const bankrollEngine = require('../services/bankrollEngine');

// Lista value bets attive, ordinate per edge decrescente
router.get('/value-bets', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT vb.*, f.date, f.home_team_id, f.away_team_id, vb.ai_commentary
       FROM value_bets vb
       JOIN fixtures f ON f.id = vb.fixture_id
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

// Registra l'esito di una scommessa (won/lost/void) e aggiorna il bankroll
router.post('/value-bets/:id/settle', async (req, res) => {
  const { id } = req.params;
  const { outcome } = req.body; // 'won' | 'lost' | 'void'

  try {
    const betRes = await pool.query('SELECT * FROM value_bets WHERE id = $1', [id]);
    const bet = betRes.rows[0];
    if (!bet) return res.status(404).json({ error: 'Value bet non trovata' });

    const bankrollRes = await pool.query(
      'SELECT balance_after FROM bankroll_log ORDER BY created_at DESC LIMIT 1'
    );
    const currentBalance = bankrollRes.rows[0]?.balance_after ?? parseFloat(process.env.INITIAL_BANKROLL || '100');

    let amount = 0;
    if (outcome === 'won') {
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

module.exports = router;
