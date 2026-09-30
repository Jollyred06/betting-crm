/** Controllo della chiave segreta: accetta ?key=... (cron-job.org, indirizzi) oppure l'intestazione x-run-key (pulsanti della pagina). */
const crypto = require('crypto');

function authorized(req) {
  const secret = process.env.RUN_SECRET_KEY;
  if (!secret) return false;
  const header = req.get ? req.get('x-run-key') : (req.headers && req.headers['x-run-key']);
  const given = String((req.query && req.query.key) || header || '');
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { authorized };
