/**
 * 📦 COPIA IN MEMORIA DEI SEGNALI (22/11/2026). Supabase gratuito conta i dati letti (5 GB al mese) e a novembre erano 13 GB:
 * una decina di pagine rileggevano TUTTA la tabella italia_signals (~2,7 MB) a ogni ricalcolo. Ora la tabella si legge intera
 * una volta sola all'avvio; poi solo le righe nuove o cambiate (colonna updated_at, aggiornata da un trigger su ogni modifica).
 * Le pagine ricevono copie delle righe (possono modificarle senza toccare la copia comune).
 */
let ready = false, snap = null, maxAt = null, lastAt = 0, inflight = null;
let incremental = true;   // se il trigger non si puo' creare, si torna a leggere tutto (come prima): niente pagine rotte
async function ensure(pool) {
  if (ready) return;
  try { await ensureTrigger(pool); } catch (e) { incremental = false; }
  ready = true;
}
async function ensureTrigger(pool) {
  await pool.query(`ALTER TABLE italia_signals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
  await pool.query(`CREATE OR REPLACE FUNCTION crm_touch_updated_at() RETURNS trigger AS $$ BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END $$ LANGUAGE plpgsql`);
  await pool.query(`CREATE OR REPLACE TRIGGER italia_signals_touch BEFORE INSERT OR UPDATE ON italia_signals FOR EACH ROW EXECUTE FUNCTION crm_touch_updated_at()`);
  await pool.query(`CREATE INDEX IF NOT EXISTS italia_signals_updated_at ON italia_signals (updated_at)`);
}
const T = x => (x ? new Date(x).getTime() : 0);
async function refresh(pool) {
  await ensure(pool);
  if (!snap || !incremental) {
    const rows = (await pool.query(`SELECT * FROM italia_signals`)).rows;
    snap = new Map(rows.map(r => [Number(r.id), r]));
  } else {
    // 2 minuti di sovrapposizione: una modifica salvata un attimo dopo non si perde (si rilegge qualche riga in piu', poche)
    const rows = (await pool.query(`SELECT * FROM italia_signals WHERE updated_at > $1`, [new Date(maxAt - 120000).toISOString()])).rows;
    for (const r of rows) snap.set(Number(r.id), r);
  }
  for (const r of snap.values()) if (T(r.updated_at) > maxAt) maxAt = T(r.updated_at);
  lastAt = Date.now();
}
/** Tutte le righe (copie). Se la copia e' di meno di 1,5 secondi fa si riusa (piu' pagine che si preparano insieme). */
async function all(pool) {
  if (!snap || Date.now() - lastAt > 1500) {
    if (!inflight) inflight = refresh(pool).finally(() => { inflight = null; });
    await inflight;
  }
  return [...snap.values()].map(r => ({ ...r }));
}
const byCreated = (a, b) => T(a.created_at) - T(b.created_at) || Number(a.id) - Number(b.id);
const byStartDesc = (a, b) => T(b.commence_time) - T(a.commence_time) || Number(b.id) - Number(a.id);
/** Come "SELECT * FROM italia_signals WHERE strategy = X ORDER BY ...". order: 'created' | 'startDesc'. */
async function rows(pool, { strategy = null, order = 'created', limit = null, since = null } = {}) {
  let r = await all(pool);
  if (strategy) r = r.filter(x => x.strategy === strategy);
  if (since) r = r.filter(x => T(x.created_at) >= T(since));
  r.sort(order === 'startDesc' ? byStartDesc : byCreated);
  return limit ? r.slice(0, limit) : r;
}
const reset = () => { snap = null; maxAt = null; lastAt = 0; watch.reset(); firstPins.clear(); };
const stats = () => ({ aggiornamentoParziale: incremental, segnali: snap ? snap.size : 0, partite: watch.size(), primeQuote: firstPins.size, ultimaLettura: lastAt ? new Date(lastAt).toISOString() : null });

/** ⚽ Stessa cosa per goal_watch (tutte le partite viste: ~6.000 righe, letta da IA, Sicure, copertura dei risultati). Chiave event_id. */
function makeStore(table, key) {
  let rdy = false, m = null, mx = 0, last = 0, fly = null, inc = true;
  async function ens(pool) {
    if (rdy) return;
    try { await trig(pool); } catch (e) { inc = false; }
    rdy = true;
  }
  async function trig(pool) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
    await pool.query(`CREATE OR REPLACE FUNCTION crm_touch_updated_at() RETURNS trigger AS $$ BEGIN NEW.updated_at = clock_timestamp(); RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE OR REPLACE TRIGGER ${table}_touch BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION crm_touch_updated_at()`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${table}_updated_at ON ${table} (updated_at)`);
  }
  async function ref(pool) {
    await ens(pool);
    if (!inc) m = null;
    const rows = m ? (await pool.query(`SELECT * FROM ${table} WHERE updated_at > $1`, [new Date(mx - 120000).toISOString()])).rows : (await pool.query(`SELECT * FROM ${table}`)).rows;
    if (!m) m = new Map();
    for (const r of rows) { m.set(String(r[key]), r); if (T(r.updated_at) > mx) mx = T(r.updated_at); }
    last = Date.now();
  }
  return {
    async all(pool) { if (!m || Date.now() - last > 1500) { if (!fly) fly = ref(pool).finally(() => { fly = null; }); await fly; } return [...m.values()].map(r => ({ ...r })); },
    reset() { m = null; mx = 0; last = 0; }, size: () => (m ? m.size : 0)
  };
}
const watch = makeStore('goal_watch', 'event_id');
/** La PRIMA quota Pinnacle letta di ogni partita non cambia mai: si legge una volta e si tiene. */
const firstPins = new Map();
async function firstPinOf(pool, ids) {
  const miss = [...new Set(ids)].filter(id => !firstPins.has(id));
  for (let i = 0; i < miss.length; i += 2000) {
    const part = miss.slice(i, i + 2000);
    const rows = (await pool.query(`SELECT DISTINCT ON (event_id) event_id, pin_h, pin_d, pin_a FROM pin_history WHERE event_id = ANY($1) ORDER BY event_id, at`, [part])).rows;
    const got = new Map(rows.map(r => [r.event_id, r]));
    for (const id of part) firstPins.set(id, got.get(id) || null);   // anche "nessuna": non si richiede ogni volta
  }
  return firstPins;
}
module.exports = { all, rows, reset, stats, watch, firstPinOf };
