/**
 * Fotografie delle quote di TUTTE le partite viste in un giro (non solo quelle segnalate).
 * Servono a studiare il MOVIMENTO di Pinnacle prima della partita e il ritardo dei bookmaker italiani:
 * ogni giro (11:00, 17:00) e ogni cattura di chiusura aggiunge una lettura per partita, senza spendere crediti
 * (le quote sono già state scaricate per l'analisi). Non tocca in nessun modo segnali, regole o bankroll:
 * qualsiasi errore qui viene inghiottito e il resto del giro prosegue.
 */
const { h2h } = require('./sharpSignals');

const GAP = { giro: 8, chiusura: 25 };   // minuti minimi tra due letture della stessa partita (la chiusura gira ogni 10 minuti: ne teniamo una ogni ~25)
let tableReady = false;

async function ensureTable(pool) {
  if (tableReady) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS pin_snapshots (
    id SERIAL PRIMARY KEY,
    odds_event_id TEXT NOT NULL,
    league_code TEXT,
    home TEXT,
    away TEXT,
    commence_time TIMESTAMPTZ,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source TEXT,
    pin_h NUMERIC(8,3), pin_d NUMERIC(8,3), pin_a NUMERIC(8,3),
    quotes JSONB
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pin_snapshots_event ON pin_snapshots(odds_event_id, captured_at)`);
  tableReady = true;
}

/** Quote 1X2 di ogni bookmaker per l'evento: {chiave_book: [casa, pareggio, trasferta]} (solo numeri, compatto). */
function compactQuotes(ev) {
  const q = {};
  for (const b of ev.bookmakers || []) {
    const p = h2h(b, ev);
    if (p) q[b.key] = [p.home, p.draw, p.away];
  }
  return q;
}

/**
 * Salva una lettura dell'evento. source: 'giro' (analisi giornaliera) o 'chiusura' (cattura vicino al calcio d'inizio).
 * Ritorna true se ha scritto, false se saltata (nessuna quota o lettura troppo recente). Non lancia mai.
 */
async function saveSnapshot(pool, ev, code, source) {
  try {
    if (!ev || !ev.id) return false;
    const q = compactQuotes(ev);
    if (!Object.keys(q).length) return false;
    await ensureTable(pool);
    const pin = q.pinnacle || [null, null, null];
    const r = await pool.query(
      `INSERT INTO pin_snapshots (odds_event_id, league_code, home, away, commence_time, source, pin_h, pin_d, pin_a, quotes)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
       WHERE NOT EXISTS (SELECT 1 FROM pin_snapshots WHERE odds_event_id = $1 AND captured_at > NOW() - make_interval(mins => $11::int))`,
      [ev.id, code, ev.home_team, ev.away_team, ev.commence_time, source, pin[0], pin[1], pin[2], JSON.stringify(q), GAP[source] || 8]);
    return (r.rowCount || 0) > 0;
  } catch (err) {
    return false;   // la raccolta è facoltativa: mai fermare il giro per questa
  }
}

module.exports = { saveSnapshot, compactQuotes, ensureTable };
