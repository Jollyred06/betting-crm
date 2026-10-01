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
    // Risposta minuscola di default: cron-job.org scarta le risposte grandi e segna il giro come "fallito" anche se e' riuscito.
    // Il log completo e' gia' salvato (scheda Log dell'app). L'app usa ?detail=1 per mostrarlo subito.
    res.json(req.query.detail === '1' ? { success: true, ...result }
      : { success: true, segnali: result.totalValueBetsFound, partite: result.fixturesAnalyzed, richiesteQuote: result.oddsApiRequestsUsed });
  } catch (err) {
    console.error('Errore analisi giornaliera:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const pool = require('../db/pool');
const { buildStats } = require('../services/weeklyReport');
const { settlePending } = require('../services/settler');
const { checkMilestones } = require('../services/milestones');
const { sendTelegramNotification, sendTelegramDetailed, findTelegramChats, sendEmailNotification, sendWhatsAppNotification } = require('../services/notifier');

// Riepilogo settimanale: da mettere su cron-job.org una volta a settimana (POST). Invia anche la notifica.
router.post('/weekly-report', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try {
    const stats = await buildStats(pool);
    await sendTelegramNotification(stats.text); await sendEmailNotification('Betting CRM: riepilogo settimanale', stats.text); await sendWhatsAppNotification(stats.text);
    res.json(req.query.detail === '1' ? { success: true, ...stats } : { success: true });     // risposta minuscola per cron-job.org
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Chiude subito i segnali di cui c'e' il risultato (lo fa gia' l'analisi giornaliera).
router.post('/settle-pending', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try { const s = await settlePending(pool); let m = []; try { m = await checkMilestones(pool); } catch (e) { /* tabella non ancora creata */ } res.json({ success: true, ...s, tappe: m }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// Messaggio di prova su Telegram (per controllare che il collegamento funzioni, senza aspettare un segnale).
router.post('/notify-test', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try { res.json({ success: true, ...(await sendTelegramDetailed('✅ <b>Prova riuscita</b>\nDa ora riceverai qui i nuovi segnali del tracker (senza soldi veri).')) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Trova il chat id di chi ha scritto al bot (evita di aprire indirizzi a mano).
router.post('/notify-chat-id', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try { res.json({ success: true, ...(await findTelegramChats()) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
