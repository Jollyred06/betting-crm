const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const view = require('../services/trackerView');

// Sola lettura (come la dashboard): nessuna chiave, nessuna azione che consumi crediti.
router.get('/overview', async (req, res) => {
  try { res.json(await view.getOverview(pool)); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/signals', async (req, res) => {
  try { res.json(await view.getSignals(pool, { status: req.query.status, limit: req.query.limit })); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/health', async (req, res) => {
  try { res.json(await view.getHealth(pool)); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/runs', async (req, res) => {
  try { res.json(await view.getRuns(pool, req.query.limit)); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/config', (req, res) => res.json(view.getConfig()));
router.get('/milestones', async (req, res) => {
  try { res.json(await require('../services/milestones').getMilestones(pool)); } catch (err) { res.status(500).json({ error: err.message }); }
});

// Verifica della chiave per sbloccare i pulsanti della pagina (la chiave resta nel browser, mai nella pagina).
const { authorized } = require('../services/auth');
router.post('/auth-check', (req, res) => authorized(req) ? res.json({ ok: true }) : res.status(401).json({ ok: false, error: 'Chiave non valida' }));

// Esportazione completa dei segnali: protetta dalla chiave (e' un file pesante e serve solo a te).
router.get('/export.csv', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida' });
  try {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="segnali_tracker.csv"');
    res.send(await view.signalsCsv(pool));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
