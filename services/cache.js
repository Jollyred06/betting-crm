/**
 * Velocita': le pagine del CRM chiedono gli stessi numeri piu' volte (Home, Segnali, Strategie...).
 * Le risposte di sola lettura (/api/tracker/...) si tengono pronte per 5 minuti e si mandano compresse (gzip).
 * La copia si butta appena cambia qualcosa: un salvataggio dall'app (POST/DELETE) o un giro di segnali e chiusure,
 * e subito dopo il server la RIPREPARA da solo (warm): cosi' chi apre il CRM trova le pagine gia' pronte (0,3 s invece di 2-3 s).
 * Il backup non passa mai dalla copia.
 */
const zlib = require('zlib');
const store = new Map(), pending = new Map();
let hits = 0, misses = 0;

// 22/11/2026: "generazione" dei dati. Ogni salvataggio la fa salire: un calcolo partito PRIMA del salvataggio (es. la ricopia in
// sottofondo) non si salva come copia pronta e chi arriva dopo non lo aspetta. Prima poteva rimettere i dati vecchi dopo un tocco
// (es. "Risultati da ricontrollare": il risultato si salvava ma la riga ricompariva).
let gen = 0;
// 25/11/2026 (Christian: "Analisi ci mette un po' a caricare"): dopo ogni scansione si buttava tutto, e le pagine di Analisi
// (statistiche su centinaia di partite, che una scansione cambia appena) si ricalcolavano da zero alla prima apertura.
// Ora restano come copia VECCHIA: si vedono subito e il server le rifa' in sottofondo (l'app riceve X-Stale e si aggiorna da sola).
const KEEP_STALE = /^\/api\/tracker\/(brain|team|training|books|learning|strategies|calibration|guess|opinion|advice|auto-played|credits|bivio|concordi|backtest|forma-test)\b|^\/api\/tracker\/italia\?s=B\b/;
const clear = () => { gen++; for (const [k, v] of [...store.entries()]) { if (KEEP_STALE.test(k)) v.at = Math.min(v.at, Date.now() - 10 * 60000); else store.delete(k); } };
/** Butta solo le pagine toccate da un salvataggio (es. una giocata cambia segnali e giocate, non le strategie). */
const clearMatching = re => { gen++; for (const k of [...store.keys()]) if (re.test(k)) store.delete(k); };
const stats = () => ({ voci: store.size, hits, misses, ripreparate: warmed, vecchieMandate: staleServed });
const wantsGzip = req => /\bgzip\b/.test(req.headers['accept-encoding'] || '');

function send(req, res, entry, stale = false) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (stale) res.setHeader('X-Stale', '1');
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('Cache-Control', 'no-cache');
  if (wantsGzip(req) && entry.gz) { res.setHeader('Content-Encoding', 'gzip'); return res.end(entry.gz); }
  return res.end(entry.body);
}

/** 22/11/2026: dopo i 5 minuti la copia non si butta subito: per un'ora si manda SUBITO la copia vecchia e intanto il server la
 *  rifa' in sottofondo (prima il primo che apriva dopo 5 minuti aspettava 3-6 secondi: /italia, /advice, /learning). Con l'intestazione
 *  X-Stale l'app sa che e' vecchia e la richiede da sola dopo qualche secondo. I salvataggi
 *  e le scansioni continuano a cancellare le copie (dati sempre freschi dopo un cambiamento). */
const STALE_MS = 6 * 3600000;   // la notte non ci sono scansioni: al mattino si vede subito la copia della sera, poi la nuova (l'app la richiede da sola)
let staleServed = 0;
function refreshInBackground(key) {
  if (pending.has(key)) return;
  const http = require('http');
  const r = http.get({ host: '127.0.0.1', port: process.env.PORT || 3000, path: key, headers: { 'accept-encoding': 'gzip', 'x-refresh': '1' }, timeout: 60000 }, res => { res.resume(); });
  r.on('error', () => {}); r.on('timeout', () => r.destroy());
}
function middleware(ttlMs = 5 * 60000) {
  return (req, res, next) => {
    if (req.method !== 'GET' || /backup|db-traffic/.test(req.path)) return next();
    const key = req.originalUrl, hit = store.get(key), refresh = req.headers['x-refresh'] === '1';
    if (!refresh && hit && Date.now() - hit.at < ttlMs) { hits++; return send(req, res, hit); }
    if (!refresh && hit && Date.now() - hit.at < STALE_MS) { hits++; staleServed++; refreshInBackground(key); return send(req, res, hit, true); }
    // 3 novembre 2026: se la stessa pagina e' gia' in preparazione (es. la ripreparazione dopo un tocco), si aspetta quella
    // invece di ricalcolarla una seconda volta: sul server gratuito due calcoli insieme raddoppiano l'attesa
    const busy = pending.get(key);
    if (busy && busy.gen === gen) return busy.p.then(() => { const h = store.get(key); if (h && Date.now() - h.at < ttlMs) { hits++; send(req, res, h); } else next(); });
    misses++;
    const g = gen; let done; const mine = { gen: g, p: new Promise(r => { done = r; }) }; pending.set(key, mine);
    const finish = () => { if (pending.get(key) === mine) pending.delete(key); done(); };
    res.on('finish', finish); res.on('close', finish);
    const json = res.json.bind(res);
    res.json = data => {
      if (res.statusCode !== 200) return json(data);
      const body = Buffer.from(JSON.stringify(data));
      const entry = { at: Date.now(), body, gz: body.length > 1024 ? zlib.gzipSync(body) : null };
      if (g === gen) store.set(key, entry);   // calcolato prima di un salvataggio: si manda ma non si tiene
      return send(req, res, entry);
    };
    next();
  };
}

/** La pagina dell'app, compressa una volta sola all'avvio (circa un quarto del peso). */
function staticGzip(file) {
  const fs = require('fs'), crypto = require('crypto');
  let cached = null;
  const load = () => { const body = fs.readFileSync(file); cached = { body, gz: zlib.gzipSync(body), etag: '"' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 16) + '"' }; };
  return (req, res) => {
    if (!cached) load();
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('ETag', cached.etag); res.setHeader('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === cached.etag) return res.status(304).end();
    if (wantsGzip(req)) { res.setHeader('Content-Encoding', 'gzip'); return res.end(cached.gz); }
    return res.end(cached.body);
  };
}

/**
 * Ripreparazione in background delle pagine principali (31 ottobre 2026). Si chiama dopo ogni clear:
 * aspetta qualche secondo (piu' salvataggi di fila = una sola ripreparazione) e chiede le pagine al server stesso, una alla volta.
 */
// 22/11/2026: prima le pagine che si aprono davvero (Oggi, poi Analisi e Giocate); tolte quelle della strategia A, nascoste dal 21/11
// 22/11/2026 (Supabase gratuito: 5 GB al mese di dati letti, a novembre 13): dopo una scansione si ripreparano solo le pagine di Oggi;
// le altre si calcolano quando si aprono (e grazie alla copia vecchia si vedono subito lo stesso)
const WARM_PATHS = ['/api/tracker/italia', '/api/tracker/played', '/api/tracker/scalata', '/api/tracker/health'];
let warmTimer = null, warming = false, warmed = 0;
function warm({ port = process.env.PORT || 3000, delayMs = 3000, paths = WARM_PATHS, get = null } = {}) {
  if (warmTimer) clearTimeout(warmTimer);
  warmTimer = setTimeout(async () => {
    warmTimer = null;
    if (warming) return warm({ port, delayMs, paths, get });
    warming = true;
    const http = require('http');
    const one = p => get ? get(p) : new Promise(resolve => {
      const r = http.get({ host: '127.0.0.1', port, path: p, headers: { 'accept-encoding': 'gzip', 'x-warm': '1' }, timeout: 60000 }, res => { res.resume(); res.on('end', resolve); });
      r.on('error', resolve); r.on('timeout', () => { r.destroy(); resolve(); });
    });
    try { for (const p of paths) { if (!store.has(p)) await one(p); warmed++; } } catch (e) { /* facoltativo */ }
    warming = false;
  }, delayMs);
  if (warmTimer.unref) warmTimer.unref();
}
const clearAndWarm = opts => { clear(); warm(opts); };

module.exports = { clear, clearMatching, clearAndWarm, warm, stats, middleware, staticGzip, WARM_PATHS };
