/**
 * Velocita': le pagine del CRM chiedono gli stessi numeri piu' volte (Home, Segnali, Strategie...).
 * Le risposte di sola lettura (/api/tracker/...) si tengono pronte per 60 secondi e si mandano compresse (gzip).
 * La copia si butta appena cambia qualcosa: un salvataggio dall'app (POST/DELETE) o un giro di segnali e chiusure.
 * Il backup non passa mai dalla copia.
 */
const zlib = require('zlib');
const store = new Map();
let hits = 0, misses = 0;

const clear = () => store.clear();
const stats = () => ({ voci: store.size, hits, misses });
const wantsGzip = req => /\bgzip\b/.test(req.headers['accept-encoding'] || '');

function send(req, res, entry) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('Cache-Control', 'no-cache');
  if (wantsGzip(req) && entry.gz) { res.setHeader('Content-Encoding', 'gzip'); return res.end(entry.gz); }
  return res.end(entry.body);
}

function middleware(ttlMs = 60000) {
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

module.exports = { clear, stats, middleware, staticGzip };
