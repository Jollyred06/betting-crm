const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const history = require('../services/history');
const xg = require('../services/xgDownloader');
const multi = require('../services/multiLeague');
const tm = require('../services/tmFeatures');
let tmJob = null;

let multiJob = null;

let downloader = null;
function getDownloader() {
  if (!downloader) downloader = xg.createDownloader({ store: xg.pgStore(pool), http: xg.makeHttp(process.env.THESTATSAPI_KEY) });
  return downloader;
}

function authorized(req) {
  return process.env.RUN_SECRET_KEY && req.query.key === process.env.RUN_SECRET_KEY;
}

// Import iniziale (una tantum): carica i CSV della cartella data/history nel database.
router.post('/import-history', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try {
    res.json({ success: true, files: await history.importLocalFiles(pool) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aggiornamento manuale dello storico dalla stagione in corso (di solito lo fa già l'analisi giornaliera).
router.post('/refresh-history', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  const today = new Date().toISOString().slice(0, 10);
  const leagues = (process.env.V1_LEAGUES || 'SA').split(',').map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const l of leagues) out.push({ lega: l, ...(await history.refreshCurrentSeason(pool, l, today)) });
  res.json({ success: true, risultati: out });
});

// Stato dello storico: quante partite e fino a quale data, per lega.
router.get('/history-status', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try {
    const { rows } = await pool.query(
      `SELECT league_code AS lega, COUNT(*)::int AS partite, MIN(match_date)::text AS dal, MAX(match_date)::text AS al
       FROM historical_matches GROUP BY league_code ORDER BY league_code`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Download xG + quote da TheStatsAPI (backtest con xG) ---
// Avvia (o riprende) il download in background. Puoi richiamarlo quando vuoi: non rifa il lavoro gia' fatto.
router.post('/xg/start', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  if (!process.env.THESTATSAPI_KEY) return res.status(400).json({ error: 'Manca THESTATSAPI_KEY nelle variabili di Render' });
  try { const d = getDownloader(); const started = await d.ensureRunning(); res.json({ success: true, started, status: await d.status() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
// Stato del download. Se il processo si e' fermato (es. il server si e' riavviato) lo fa ripartire da solo:
// per questo conviene metterlo su cron-job.org ogni 10 minuti (GET).
router.get('/xg/status', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  if (!process.env.THESTATSAPI_KEY) return res.status(400).json({ error: 'Manca THESTATSAPI_KEY nelle variabili di Render' });
  try { const d = getDownloader(); const resumed = req.query.resume !== '0' ? await d.ensureRunning() : false; res.json({ resumed, ...(await d.status()) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
// Scarica tutto in CSV (da caricare in chat per il backtest).
router.get('/xg/export.csv', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="serieA_xg_quote.csv"');
    res.send(xg.toCsv(await xg.pgStore(pool).exportRows()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Test su molti campionati: scarica ~190 file da football-data.co.uk in un unico CSV ---
router.post('/multi/start', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  if (!multiJob) multiJob = multi.createJob({ http: multi.makeHttp() });
  const st = multiJob.status();
  if (!st.running) multiJob.run().catch(e => console.error('multi:', e.message));
  res.json({ success: true, avviato: !st.running, stato: multiJob.status() });
});
router.get('/multi/status', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  res.json(multiJob ? multiJob.status() : { running: false, finished: false, nota: 'Non ancora avviato: usa POST /multi/start' });
});
router.get('/multi/export.csv', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  const csv = multiJob && multiJob.csv();
  if (!csv) return res.status(409).json({ error: 'Il file non e pronto: controlla /multi/status (finished deve essere true)' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="campionati_quote.csv"');
  res.send(csv);
});

// --- Valore delle rose (Transfermarkt) per il test "il valore dei giocatori aggiunge informazione?" ---
router.post('/tm/start', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  if (!tmJob) tmJob = tm.createJob();
  const st = tmJob.status();
  if (!st.running) tmJob.run().catch(e => console.error('tm:', e.message));
  res.json({ success: true, avviato: !st.running, stato: tmJob.status() });
});
router.get('/tm/status', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  res.json(tmJob ? tmJob.status() : { running: false, finished: false, nota: 'Non ancora avviato: usa POST /tm/start' });
});
router.get('/tm/export.csv', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  const csv = tmJob && tmJob.csv();
  if (!csv) return res.status(409).json({ error: 'Il file non e pronto: controlla /tm/status (finished deve essere true)' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="tm_valori_rose.csv"');
  res.send(csv);
});

module.exports = router;
