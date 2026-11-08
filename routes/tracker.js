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
router.get('/bankroll', async (req, res) => {
  try { res.json(await view.getBankroll(pool)); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/strategies', async (req, res) => {
  try { res.json(await view.getStrategies(pool)); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/italia', async (req, res) => {
  try { res.json(await require('../services/italia').getItalia(pool, process.env, req.query.s === 'B' ? 'B' : 'I')); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/advice', async (req, res) => {
  try { res.json(await require('../services/advisor').getAdvice(pool)); } catch (err) { res.status(500).json({ error: err.message }); }
});
// Le mie giocate vere: lettura libera, scrittura e cancellazione con la chiave
router.get('/played', async (req, res) => {
  try { res.json(await require('../services/played').getPlayed(pool)); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/played/:signalId', async (req, res) => {
  if (!require('../services/auth').authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try { res.json({ success: true, ...(await require('../services/played').addPlayed(pool, Number(req.params.signalId), req.body || {})) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.delete('/played/:id', async (req, res) => {
  if (!require('../services/auth').authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try { res.json({ success: true, ...(await require('../services/played').deletePlayed(pool, Number(req.params.id))) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
// Non giocate (con il motivo): scrittura e cancellazione con la chiave
router.post('/skipped/:signalId', async (req, res) => {
  if (!require('../services/auth').authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try { res.json({ success: true, ...(await require('../services/played').addSkipped(pool, Number(req.params.signalId), req.body || {})) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
router.delete('/skipped/:id', async (req, res) => {
  if (!require('../services/auth').authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try { res.json({ success: true, ...(await require('../services/played').deleteSkipped(pool, Number(req.params.id))) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
// Segnali I e B per l'analisi settimanale automatica: sola lettura, niente chiavi e niente dati personali (le giocate vere restano fuori)
router.get('/italia-export', async (req, res) => {
  try {
    const I = require('../services/italia');
    const { rows } = await pool.query(`SELECT id, event_id, phase, created_at, league, home, away, commence_time, selection, book, odd, fair_prob, edge_pct, netwin_odd,
      closing_fair_prob, clv_pct, netwin_clv_pct, close_lag_min, strategy, result, result_score FROM italia_signals ORDER BY id`);
    const prim = new Set(I.primaryRows(rows).map(r => r.id));
    const iAll = rows.filter(r => (r.strategy || 'I') === 'I'), iRows = iAll.filter(r => prim.has(r.id));
    const m1 = I.markFinal(iRows), m2 = I.markFinal2(iAll), m3 = I.markFinal3(iRows), m4 = I.markFinal4(iAll);
    const last = (await pool.query(`SELECT at, kind, quota_remaining FROM italia_requests ORDER BY id DESC LIMIT 1`).catch(() => ({ rows: [] }))).rows[0] || null;
    const reqs = (await pool.query(`SELECT to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, COUNT(*)::int AS n FROM italia_requests WHERE at > NOW() - INTERVAL '8 days' GROUP BY 1 ORDER BY 1`).catch(() => ({ rows: [] }))).rows;
    const results = (await pool.query(`SELECT at, ok, src, note FROM results_requests ORDER BY id DESC LIMIT 2`).catch(() => ({ rows: [] }))).rows;
    res.json({
      at: new Date().toISOString(), quotaRemaining: last ? last.quota_remaining : null, requestsByDay: reqs, lastResults: results,
      // dup = rilettura vicino al calcio d'inizio di un segnale gia' uscito: esclusa da I, B, F e F3, conta solo per la F2
      signals: rows.map(r => ({ ...r, dup: !prim.has(r.id), f: !!(m1.get(r.id) || {}).final, f2: !!(m2.get(r.id) || {}).final, f3: !!(m3.get(r.id) || {}).final, f4: !!(m4.get(r.id) || {}).final }))
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// ⚽ gol: formula, 💥 Valanga e quote Over/Under sulla carta (solo numeri delle partite, niente giocate)
router.get('/goals', async (req, res) => {
  try { res.json(await require('../services/goals').getGoals(pool)); } catch (err) { res.status(500).json({ error: err.message }); }
});
// prova del formato Over/Under di odss: costa UNA richiesta, solo a mano e con la chiave
router.post('/ou-check', async (req, res) => {
  if (!require('../services/auth').authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try { res.json(await require('../services/goals').ouCheck(pool)); } catch (err) { res.status(500).json({ error: err.message }); }
});
// 🦸 pagella della squadra: chi e' in forma, chi mettere in campo (solo numeri) e approvazione di Christian (con la chiave)
router.get('/team', async (req, res) => {
  try { res.json(await require('../services/team').getTeam(pool)); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/team/:key', async (req, res) => {
  if (!require('../services/auth').authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try { res.json({ success: true, ...(await require('../services/team').setMember(pool, req.params.key, !!(req.body && req.body.on), { note: req.body && req.body.note })) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});
// 💳 crediti di tutte le piattaforme (solo numeri)
router.get('/credits', async (req, res) => {
  try { res.json(await require('../services/credits').getCredits(pool)); } catch (err) { res.status(500).json({ error: err.message }); }
});
// copie automatiche giornaliere: elenco libero (solo date e pesi), file con la chiave
router.get('/backups', async (req, res) => {
  try { res.json({ copie: (await require('../services/backup').listBackups(pool)).map(b => ({ id: b.id, at: b.created_at, giorno: b.day, kb: Math.round(b.bytes / 1024) })) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/backups/latest', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida' });
  try {
    const f = await require('../services/backup').getBackupFile(pool, /^\d+$/.test(req.query.id || '') ? Number(req.query.id) : null);
    if (!f) return res.status(404).json({ error: 'Nessuna copia automatica ancora: si salva da sola ogni giorno dopo le 3.' });
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="backup_betting_crm_${f.day}_auto.json.gz"`);
    res.send(f.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// Prova di Highlightly (solo numeri di copertura, nessun dato personale; al massimo una lettura ogni 10 minuti)
router.get('/highlightly-check', async (req, res) => {
  try { res.json(await require('../services/highlightly').check(pool, { day: /^\d{4}-\d{2}-\d{2}$/.test(req.query.day || '') ? req.query.day : null })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/books', async (req, res) => {
  try { res.json(await require('../services/books').getBooks(pool)); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/archive', async (req, res) => {
  try { res.json(await require('../services/italia').getArchive(pool, { before: /^\d{4}-\d{2}-\d{2}$/.test(req.query.before || '') ? req.query.before : null, days: Number(req.query.days) || 7 })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/learning', async (req, res) => {
  try { res.json(await require('../services/learner').getLearning(pool)); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/training', async (req, res) => {
  try { res.json(await require('../services/training').getTraining(pool)); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/milestones', async (req, res) => {
  try { res.json(await require('../services/milestones').getMilestones(pool)); } catch (err) { res.status(500).json({ error: err.message }); }
});

// Verifica della chiave per sbloccare i pulsanti della pagina (la chiave resta nel browser, mai nella pagina).
const { authorized } = require('../services/auth');
router.post('/auth-check', (req, res) => authorized(req) ? res.json({ ok: true }) : res.status(401).json({ ok: false, error: 'Chiave non valida' }));

// Risultato a mano di un segnale ancora in attesa (protetto dalla chiave): chiude il segnale e muove il bankroll come l'esito automatico.
router.post('/signals/:id/result', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try {
    const out = await require('../services/settler').settleManual(pool, Number(req.params.id), req.body && req.body.homeGoals, req.body && req.body.awayGoals);
    let tappe = []; try { tappe = await require('../services/milestones').checkMilestones(pool); } catch (e) { /* tabella non ancora creata */ }
    res.json({ success: true, ...out, tappe });
  }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Risultato a mano di un segnale italiano (strategia I o B), protetto dalla chiave: gol dei 90 minuti, si puo' correggere.
router.post('/italia/:id/result', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try { res.json({ success: true, ...(await require('../services/results').settleItaliaManual(pool, Number(req.params.id), req.body && req.body.homeGoals, req.body && req.body.awayGoals, { voided: !!(req.body && req.body.void) })) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// 🔍 il risultato scritto a mano era giusto (diverso da quello ufficiale): si tiene e non si ricontrolla
router.post('/italia/:id/keep', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida o mancante' });
  try { res.json({ success: true, ...(await require('../services/results').keepManual(pool, Number(req.params.id))) }); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Copia di sicurezza di tutti i dati che non si possono riscaricare (protetta dalla chiave).
router.get('/backup.json', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Chiave non valida' });
  try {
    const b = await require('../services/backup').buildBackup(pool);
    // 8 novembre 2026: nel nome anche l'ora di Roma (piu' copie nello stesso giorno non si confondono) e mai dalla cache del telefono
    const hm = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(b.creato)).replace(':', '-');
    const name = `backup_betting_crm_${b.creato.slice(0, 10)}_${hm}.json`, body = Buffer.from(JSON.stringify(b));
    res.setHeader('Cache-Control', 'no-store');
    // compressa di base (circa un decimo del peso); ?plain=1 per il file normale
    if (req.query.plain === '1') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      return res.send(body);
    }
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.gz"`);
    res.send(require('zlib').gzipSync(body, { level: 9 }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
