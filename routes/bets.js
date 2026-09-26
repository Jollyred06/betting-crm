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

module.exports = router;
