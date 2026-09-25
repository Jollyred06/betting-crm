const express = require('express');
const router = express.Router();
const { runDailyAnalysis } = require('../services/orchestrator');

/**
 * Avvia l'analisi giornaliera (fixtures -> quote -> value bet -> salvataggio).
 * Protetta da una chiave segreta passata come query param ?key=... per evitare
 * che chiunque trovi l'URL possa consumare le tue richieste API.
 * Pensata per essere chiamata manualmente o da un cron esterno (es. cron-job.org).
 */
router.post('/run-daily', async (req, res) => {
  const providedKey = req.query.key;
  if (!process.env.RUN_SECRET_KEY || providedKey !== process.env.RUN_SECRET_KEY) {
    return res.status(401).json({ error: 'Chiave non valida o mancante' });
  }

  try {
    const result = await runDailyAnalysis();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Errore analisi giornaliera:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
