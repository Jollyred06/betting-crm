/**
 * Controllo della chiave segreta. Accetta l'intestazione x-run-key (consigliata: non resta nelle cronologie)
 * oppure ?key=... negli indirizzi (come i job gia' esistenti su cron-job.org).
 * Con ALLOW_KEY_IN_URL=0 su Render la chiave negli indirizzi viene rifiutata.
 */
const crypto = require('crypto');
const usage = { lastQueryAt: null, lastHeaderAt: null };

function sameSecret(given, secret) {
  const a = Buffer.from(String(given || '')), b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authorized(req) {
  const secret = process.env.RUN_SECRET_KEY;
  if (!secret) return false;
  const header = req.get ? req.get('x-run-key') : (req.headers && req.headers['x-run-key']);
  const allowQuery = process.env.ALLOW_KEY_IN_URL !== '0';
  const okQuery = allowQuery && !!(req.query && req.query.key) && sameSecret(req.query.key, secret);
  const okHeader = !!header && sameSecret(header, secret);
  if (okQuery) usage.lastQueryAt = Date.now(); else if (okHeader) usage.lastHeaderAt = Date.now();
  return okQuery || okHeader;
}

/** Quando e' stata usata l'ultima volta la chiave nell'indirizzo e nell'intestazione (dall'ultimo riavvio del server). */
const getKeyUsage = () => ({ ...usage, queryAllowed: process.env.ALLOW_KEY_IN_URL !== '0' });

module.exports = { authorized, getKeyUsage };
