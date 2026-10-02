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
let dailyRunning = false;     // un solo giro alla volta: due chiamate ravvicinate non partono in parallelo

router.post('/run-daily', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  if (dailyRunning) return res.json({ success: true, giaInCorso: true });

  // Chiamata da cron-job.org (senza ?detail=1): risponde SUBITO con poche parole e fa il lavoro in background.
  // Cosi' non scade mai il timeout di 30 secondi e la risposta e' sempre minuscola (cron-job.org scarta quelle grandi).
  // Il log completo e un eventuale errore restano salvati (scheda Log dell'app, avviso Telegram).
  if (req.query.detail !== '1') {
    dailyRunning = true;
    res.json({ success: true, avviato: true });
    runDailyAnalysis().catch(err => console.error('Errore analisi giornaliera:', err.message)).finally(() => { dailyRunning = false; });
    return;
  }

  // Chiamata dall'app (?detail=1): aspetta la fine e mostra il log completo.
  dailyRunning = true;
  try {
    const result = await runDailyAnalysis();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Errore analisi giornaliera:', err.message);
    res.status(500).json({ error: err.message });
  } finally { dailyRunning = false; }
});

const pool = require('../db/pool');
const { buildStats } = require('../services/weeklyReport');
const { settlePending } = require('../services/settler');
const { checkMilestones } = require('../services/milestones');
const { ranToday } = require('../services/runState');
const { runSystemCheck } = require('../services/systemCheck');
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

// Giro di RISERVA: da mettere su cron-job.org alle 11:30. Se il giro delle 11:00 e' gia' riuscito non fa niente (0 crediti);
// altrimenti lo esegue lui e te lo dice su Telegram.
router.post('/run-daily-if-missing', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  if (dailyRunning) return res.json({ success: true, giaInCorso: true });
  try { if (await ranToday(pool)) return res.json({ success: true, saltato: true }); } catch (e) { /* se non si riesce a controllare, meglio eseguire */ }
  dailyRunning = true;
  res.json({ success: true, avviato: true, riserva: true });
  runDailyAnalysis()
    .then(() => sendTelegramNotification('🔁 <b>Giro di riserva</b>\nIl giro delle 11:00 non risultava: l\'ho eseguito adesso. Controlla il job delle 11:00 su cron-job.org.'))
    .catch(err => console.error('Errore giro di riserva:', err.message))
    .finally(() => { dailyRunning = false; });
});

// Controllo di sistema: database, tabelle, chiavi, servizi esterni, Telegram e giro giornaliero in un solo colpo.
router.post('/system-check', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try { res.json({ success: true, ...(await runSystemCheck(pool)) }); } catch (err) { res.status(500).json({ error: err.message }); }
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
