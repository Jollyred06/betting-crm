const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false
});

/**
 * 📶 CONTATORE DEL TRAFFICO (22/11/2026). Supabase gratuito: 5 GB al mese di dati letti; a novembre 13 GB. Ogni lettura si conta
 * (stima dei byte dalle prime righe) per tipo di query, cosi' si vede chi consuma: /api/tracker/db-traffic.
 */
const meter = { since: Date.now(), total: 0, queries: 0, by: new Map() };
const keyOf = sql => String(sql || '').replace(/\s+/g, ' ').trim().slice(0, 110);
function sizeOf(rows) {
  if (!Array.isArray(rows) || !rows.length) return 60;
  const k = Math.min(rows.length, 40); let s = 0;
  try { s = JSON.stringify(rows.slice(0, k)).length; } catch (e) { s = 200 * k; }
  return Math.round(s / k * rows.length) + 60;
}
const raw = pool.query.bind(pool);
pool.query = function (text, params, cb) {
  const sql = typeof text === 'string' ? text : (text && text.text);
  const p = raw(text, params, cb);
  if (p && typeof p.then === 'function') p.then(r => { try {
    const b = sizeOf(r && r.rows), k = keyOf(sql); meter.total += b; meter.queries++;
    const e = meter.by.get(k) || { n: 0, bytes: 0 }; e.n++; e.bytes += b; meter.by.set(k, e);
  } catch (e) { /* facoltativo */ } }, () => {});
  return p;
};
pool.traffic = () => {
  const h = (Date.now() - meter.since) / 3600000;
  return { since: new Date(meter.since).toISOString(), hours: Math.round(h * 10) / 10, mb: Math.round(meter.total / 1e4) / 100, mbPerDay: h > 0.05 ? Math.round(meter.total / 1e6 / h * 24) : null, queries: meter.queries,
    top: [...meter.by].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 25).map(([sql, v]) => ({ sql, n: v.n, mb: Math.round(v.bytes / 1e4) / 100 })) };
};

module.exports = pool;
