/**
 * COPIA DI SICUREZZA (versione 2, 1° novembre 2026): lo specchio di tutti i movimenti.
 *  - TUTTE le tabelle del database, trovate da sole (anche quelle aggiunte in futuro), senza limiti di righe.
 *    Restano fuori solo gli archivi che si riscaricano da soli (storico partite, xG, statistiche).
 *  - "movimenti": le giocate vere in ordine di tempo con il saldo dopo ognuna.
 *  - "riepilogo": i numeri gia' calcolati (selezioni, budget, bookmaker, allenamento, calibrazione), per leggerla in un attimo.
 * Si scarica compressa (.json.gz, circa un decimo del peso): la si apre con qualsiasi programma zip, o la si manda in chat cosi' com'e'.
 */
const SKIP = new Set(['historical_matches', 'xg_matches', 'xg_seasons', 'match_stats', 'referee_stats', 'backups']);

async function listTables(pool) {
  const { rows } = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
  return rows.map(r => r.table_name).filter(t => !SKIP.has(t) && /^[a-z0-9_]+$/.test(t));
}

/** Parte pura (testata): giocate vere in ordine di tempo, con il saldo dopo ogni risultato. */
function movements(items, start = 100) {
  let saldo = start;
  return [...(items || [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).map(x => {
    if (x.pnlEur !== null && x.pnlEur !== undefined) saldo += x.pnlEur;
    return { at: x.at, partita: `${x.home} – ${x.away}`, esito: x.selection, sito: x.book, quota: x.odd, puntata: x.stake, quotaSegnale: x.signalOdd, quotaMinima: x.minOdd,
      valoreVsChiusura: x.clvPct, risultato: x.result, punteggio: x.score, guadagno: x.pnlEur, saldoDopo: Math.round(saldo * 100) / 100, signalId: x.signalId };
  });
}

async function summary(pool) {
  const out = {}, safe = async (k, f) => { try { out[k] = await f(); } catch (e) { out[k] = { errore: e.message }; } };
  await safe('selezioni', async () => {
    const d = await require('./italia').getItalia(pool);
    const pick = ['total', 'results', 'final', 'final2', 'final3', 'final4', 'final5', 'final6', 'final7', 'budget', 'bestRule', 'myBooks', 'quotaRemaining', 'requestsThisMonth'];
    return Object.fromEntries(pick.filter(k => d[k] !== undefined).map(k => [k, d[k]]));
  });
  await safe('bookmaker', async () => { const b = await require('./books').getBooks(pool); return { ...b, books: b.books.map(({ presence, ...x }) => x) }; });
  await safe('allenamento', async () => {
    const t = await require('./training').getTraining(pool);
    return { start: t.start, selezioni: t.selections.map(s => ({ key: s.key, segnali: s.signals, misurati: s.measured, chiusi: s.settled,
      metodi: s.methods.map(m => ({ key: m.key, atteso: Math.round(m.expected.balance * 100) / 100, reale: Math.round(m.real.balance * 100) / 100, fermata: m.expected.stopped || m.real.stopped })) })) };
  });
  await safe('calibrazione', async () => (await require('./learner').getLearning(pool)).calibration || null);
  return out;
}

async function buildBackup(pool, now = new Date(), { withSummary = true } = {}) {
  const out = { app: 'betting-crm', versione: 2, creato: now.toISOString(), righe: {}, errori: [], tabelle: {}, movimenti: [], riepilogo: null };
  let tables = [];
  try { tables = await listTables(pool); } catch (e) { out.errori.push(`elenco tabelle: ${e.message}`); }
  for (const t of tables) {
    try { const { rows } = await pool.query(`SELECT * FROM "${t}" ORDER BY 1`); out.tabelle[t] = rows; out.righe[t] = rows.length; }
    catch (e) { out.tabelle[t] = null; out.righe[t] = null; out.errori.push(`${t}: ${e.message}`); }
  }
  try {
    const p = await require('./played').getPlayed(pool), c = require('./italia').budgetCfg();
    out.movimenti = movements(p.items, c.start);
  } catch (e) { out.errori.push(`movimenti: ${e.message}`); }
  if (withSummary) { try { out.riepilogo = await summary(pool); } catch (e) { out.errori.push(`riepilogo: ${e.message}`); } }
  return out;
}

// ------------------------------------------------------------------------------------------- copia automatica ogni giorno
/**
 * Ogni giorno, al primo giro dopo le 3 di notte (ora italiana), il CRM salva da solo una copia compressa nel database.
 * Si tengono le ultime KEEP: proteggono da errori e cancellazioni sbagliate; la copia scaricata sul telefono resta quella "fuori casa".
 */
const KEEP = 14;
const ROME_PARTS = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
async function ensureBackups(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS backups (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), day TEXT, bytes INT, righe JSONB, data BYTEA)`);
}
async function saveDaily(pool, { nowMs = Date.now(), force = false } = {}) {
  await ensureBackups(pool);
  const parts = Object.fromEntries(ROME_PARTS.formatToParts(new Date(nowMs)).map(p => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`, hour = Number(parts.hour) % 24;
  if (!force && hour < 3) return { copia: 'non ancora' };
  if (!force && (await pool.query(`SELECT 1 FROM backups WHERE day = $1`, [day])).rows.length) return { copia: 'gia\' fatta oggi' };
  const b = await buildBackup(pool, new Date(nowMs));
  const gz = require('zlib').gzipSync(Buffer.from(JSON.stringify(b)), { level: 9 });
  await pool.query(`INSERT INTO backups (day, bytes, righe, data) VALUES ($1, $2, $3, $4)`, [day, gz.length, JSON.stringify(b.righe), gz]);
  await pool.query(`DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY id DESC LIMIT ${KEEP})`);
  return { copia: 'salvata', giorno: day, kb: Math.round(gz.length / 1024) };
}
async function listBackups(pool) {
  await ensureBackups(pool);
  return (await pool.query(`SELECT id, created_at, day, bytes, righe FROM backups ORDER BY id DESC`)).rows;
}
async function getBackupFile(pool, id = null) {
  await ensureBackups(pool);
  const r = (await pool.query(id ? `SELECT day, data FROM backups WHERE id = $1` : `SELECT day, data FROM backups ORDER BY id DESC LIMIT 1`, id ? [id] : [])).rows[0];
  return r || null;
}

module.exports = { buildBackup, listTables, movements, SKIP, saveDaily, listBackups, getBackupFile, KEEP };
