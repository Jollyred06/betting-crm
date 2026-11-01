/**
 * Velocita': le pagine del CRM chiedono gli stessi numeri piu' volte (Home, Segnali, Strategie...).
 * Le risposte di sola lettura (/api/tracker/...) si tengono pronte per 5 minuti e si mandano compresse (gzip).
 * La copia si butta appena cambia qualcosa: un salvataggio dall'app (POST/DELETE) o un giro di segnali e chiusure,
 * e subito dopo il server la RIPREPARA da solo (warm): cosi' chi apre il CRM trova le pagine gia' pronte (0,3 s invece di 2-3 s).
 * Il backup non passa mai dalla copia.
 */
const zlib = require('zlib');
const store = new Map();
let hits = 0, misses = 0;

const clear = () => store.clear();
/** Butta solo le pagine toccate da un salvataggio (es. una giocata cambia segnali e giocate, non le strategie). */
const clearMatching = re => { for (const k of [...store.keys()]) if (re.test(k)) store.delete(k); };
const stats = () => ({ voci: store.size, hits, misses, ripreparate: warmed });
const wantsGzip = req => /\bgzip\b/.test(req.headers['accept-encoding'] || '');

function send(req, res, entry) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('Cache-Control', 'no-cache');
  if (wantsGzip(req) && entry.gz) { res.setHeader('Content-Encoding', 'gzip'); return res.end(entry.gz); }
  return res.end(entry.body);
}

function middleware(ttlMs = 5 * 60000) {
  return (req, res, next) => {
    if (req.method !== 'GET' || /backup/.test(req.path)) return next();
    const key = req.originalUrl, hit = store.get(key);
    if (hit && Date.now() - hit.at < ttlMs) { hits++; return send(req, res, hit); }
    misses++;
    const json = res.json.bind(res);
    res.json = data => {
      if (res.statusCode !== 200) return json(data);
      const body = Buffer.from(JSON.stringify(data));
      const entry = { at: Date.now(), body, gz: body.length > 1024 ? zlib.gzipSync(body) : null };
      store.set(key, entry);
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
const WARM_PATHS = ['/api/tracker/italia', '/api/tracker/overview', '/api/tracker/health', '/api/tracker/advice', '/api/tracker/milestones', '/api/tracker/bankroll',
  '/api/tracker/played', '/api/tracker/learning', '/api/tracker/italia?s=B', '/api/tracker/training', '/api/tracker/archive?days=7', '/api/tracker/strategies', '/api/tracker/books', '/api/tracker/credits'];
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
