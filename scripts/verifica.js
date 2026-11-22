#!/usr/bin/env node
/**
 * ✅ VERIFICA DOPO IL DEPLOY (20 novembre 2026). Chiama il CRM pubblicato e controlla che le pagine principali rispondano,
 * in fretta e con i dati giusti. Solo letture: non spende crediti e non scrive niente.
 * Uso: node scripts/verifica.js [indirizzo]   (predefinito https://betting-crm.onrender.com)
 */
const https = require('https'), http = require('http');
const BASE = (process.argv[2] || process.env.CRM_URL || 'https://betting-crm.onrender.com').replace(/\/$/, '');
const MAX_S = 8;   // oltre, la pagina e' lenta (a server sveglio)

function get(path) {
  return new Promise(resolve => {
    const t0 = Date.now(), lib = BASE.startsWith('https') ? https : http;
    const req = lib.get(BASE + path, { timeout: 120000 }, res => {
      let s = ''; res.on('data', d => { s += d; }); res.on('end', () => { let json = null; try { json = JSON.parse(s); } catch (e) { /* non json */ } resolve({ code: res.statusCode, s: (Date.now() - t0) / 1000, json, text: s }); });
    });
    req.on('error', e => resolve({ code: 0, s: (Date.now() - t0) / 1000, err: e.message }));
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

// ogni controllo: indirizzo e cosa deve esserci dentro (true = ok, stringa = cosa non va)
const CHECKS = [
  ['/health', r => r.code === 200 || 'il server non risponde'],
  ['/app.html', r => (r.code === 200 && /pane-home/.test(r.text)) || 'l\'app non si carica'],
  ['/api/tracker/italia', r => (r.json && Array.isArray(r.json.recent)) || 'segnali mancanti'],
  ['/api/tracker/played', r => (r.json && Number.isFinite(r.json.count)) || 'giocate mancanti'],
  ['/api/tracker/credits', r => (r.json && Array.isArray(r.json.items)) || 'crediti mancanti'],
  ['/api/tracker/guess', r => { const a = r.json && r.json.ai; if (!a) return 'IA mancante';
    if (!a.withCal) return 'IA senza storico'; if (!a.withElo) return 'IA senza forza delle squadre (Elo)';
    const w = Object.values(a.weights || {}), s = w.reduce((x, y) => x + y, 0); if (Math.abs(s - 1) > 1e-6) return 'pesi IA non sommano a 1';
    if (Math.min(...w) < 0.01) return 'un esperto IA e\' spento'; return true; }],
  ['/api/tracker/sicure', r => (r.json && Array.isArray(r.json.tiers) && r.json.tiers.length === 5) || 'le piu\' sicure mancanti'],
  ['/api/tracker/sicure-paper', r => (r.json && Number.isFinite(r.json.count)) || 'prova sulla carta mancante'],
  ['/api/tracker/dc-paper', r => (r.json && Array.isArray(r.json.reads)) || 'doppia chance mancante'],
  ['/api/tracker/calibration', r => (r.json && !r.json.error) || 'storico mancante'],
  ['/api/tracker/backtest', r => (r.json && !r.json.error) || 'prova sullo storico mancante'],
  ['/api/tracker/forma-test', r => (r.json && !!r.json.verdict) || 'prova della forma mancante'],
  ['/api/tracker/casse-siti', r => (r.json && Array.isArray(r.json.books)) || 'casse per sito mancanti'],
  ['/api/tracker/bivio', r => (r.json && !!r.json.all) || 'bivio mancante'],
  // 22/11: l'ultima scansione non deve avere errori nei passi facoltativi (gol, sicure, migliori, bivio, scalata...)
  ['/api/tracker/scans?limit=20', r => { if (!Array.isArray(r.json)) return 'registro scansioni mancante'; const s = r.json.find(x => x.kind === 'scan'); return !s || !s.errori || 'errori nell\'ultima scansione: ' + Object.entries(s.errori).map(([k, v]) => k + ': ' + v).join(' · '); }]
];

(async () => {
  let bad = 0;
  await get('/health');   // sveglia il server, se dormiva: il tempo della prima chiamata non conta
  for (const [path, test] of CHECKS) {
    let r = await get(path), v = r.code === 200 ? test(r) : `errore ${r.code || r.err}`;
    // subito dopo un riavvio l'IA carica storico ed Elo per circa un minuto: un controllo fallito si riprova una volta dopo 45 s
    if (v !== true) { await new Promise(res => setTimeout(res, 45000)); r = await get(path); v = r.code === 200 ? test(r) : `errore ${r.code || r.err}`; }
    if (v === true && r.s > MAX_S) v = `lenta (${r.s.toFixed(1)} s)`;
    if (v !== true) bad++;
    console.log(`${v === true ? '✅' : '❌'} ${path.padEnd(28)} ${r.s.toFixed(1)} s${v === true ? '' : '  ' + v}`);
  }
  console.log(bad ? `\n${bad} controlli non passati` : '\nTutto ok');
  process.exit(bad ? 1 : 0);
})();
