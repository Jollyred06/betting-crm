const express = require('express');
const router = express.Router();
const { runDailyAnalysis } = require('../services/orchestrator');
const { authorized } = require('../services/auth');

/**
 * Avvia l'analisi giornaliera (fixtures -> quote -> value bet -> salvataggio).
 * Protetta da una chiave segreta passata come query param ?key=... per evitare
 * che chiunque trovi l'URL possa consumare le tue richieste API.
 * Pensata per essere chiamata manualmente o da un cron esterno (es. cron-job.org).
 */
router.post('/run-daily', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });

  try {
    const result = await runDailyAnalysis();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Errore analisi giornaliera:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const pool = require('../db/pool');
const { buildStats } = require('../services/weeklyReport');
const { settlePending } = require('../services/settler');
const { sendTelegramNotification, sendEmailNotification, sendWhatsAppNotification } = require('../services/notifier');

// Riepilogo settimanale: da mettere su cron-job.org una volta a settimana (POST). Invia anche la notifica.
router.post('/weekly-report', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try {
    const stats = await buildStats(pool);
    await sendTelegramNotification(stats.text); await sendEmailNotification('Betting CRM: riepilogo settimanale', stats.text); await sendWhatsAppNotification(stats.text);
    res.json({ success: true, ...stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Chiude subito i segnali di cui c'e' il risultato (lo fa gia' l'analisi giornaliera).
router.post('/settle-pending', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try { res.json({ success: true, ...(await settlePending(pool)) }); } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
