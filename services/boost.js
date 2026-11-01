/**
 * ⚡ QUOTE MAGGIORATE (1° novembre 2026): conviene la quota "boost" di 888sport, Snai...?
 * A ogni scansione il CRM salva i prezzi di Pinnacle di TUTTE le partite che ha visto (prossime 6 ore), senza richieste in piu'.
 * Quando scrivi una quota maggiorata, la si confronta con il prezzo giusto di Pinnacle (senza margine, metodo power):
 *   valore = quota maggiorata x probabilita' giusta - 1.   Solo 1X2 (esito finale), il mercato che il CRM conosce.
 */
const { noVigPower } = require('./sharpSignals');

let ready = false;
async function ensureBoard(pool) {
  if (ready) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS pin_board (event_id TEXT PRIMARY KEY, league TEXT, home TEXT, away TEXT, commence_time TIMESTAMPTZ,
    pin_h NUMERIC(8,3), pin_d NUMERIC(8,3), pin_a NUMERIC(8,3), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  ready = true;
}

/** Salva i prezzi di Pinnacle visti in una scansione (righe gia' unite per partita). Le partite vecchie si tolgono. */
async function saveBoard(pool, merged, trio) {
  await ensureBoard(pool);
  let n = 0;
  for (const r of merged) {
    const b = (r.bookmakers || []).find(x => x.key === 'pinnacle'), q = b && trio(b.outcomes);
    if (!q) continue;
    await pool.query(`INSERT INTO pin_board (event_id, league, home, away, commence_time, pin_h, pin_d, pin_a, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      ON CONFLICT (event_id) DO UPDATE SET league = $2, home = $3, away = $4, commence_time = $5, pin_h = $6, pin_d = $7, pin_a = $8, updated_at = NOW()`,
      [r.event_id, r.league, r.home_team, r.away_team, r.commence_time, q.home, q.draw, q.away]);
    n++;
  }
  await pool.query(`DELETE FROM pin_board WHERE commence_time < NOW() - INTERVAL '3 hours'`);
  return n;
}

/** Parte pura (testata): giudizio di una quota maggiorata. */
function judge(odd, fairProb) {
  const o = Number(odd), p = Number(fairProb);
  if (!(o > 1) || !(p > 0 && p < 1)) return null;
  const value = (o * p - 1) * 100;
  return { value, fairOdd: 1 / p, level: value >= 3 ? 'ok' : value >= 0 ? 'warn' : 'bad',
    text: value >= 3 ? 'Conviene: la quota è sopra il prezzo giusto' : value >= 0 ? 'Al limite: poco sopra il prezzo giusto' : 'Non conviene: è sotto il prezzo giusto, anche se maggiorata' };
}

/** Cerca le partite per nome di squadra tra quelle viste da Pinnacle e restituisce il prezzo giusto dei tre esiti. */
async function search(pool, q, sameTeam) {
  await ensureBoard(pool);
  const t = String(q || '').trim();
  if (t.length < 3) return { partite: [], nota: 'Scrivi almeno 3 lettere di una squadra.' };
  const { rows } = await pool.query(`SELECT * FROM pin_board WHERE commence_time > NOW() - INTERVAL '2 hours' ORDER BY commence_time LIMIT 2000`);
  const low = t.toLowerCase();
  const hit = rows.filter(r => [r.home, r.away].some(n => String(n || '').toLowerCase().includes(low) || sameTeam(t, n))).slice(0, 10);
  return {
    partite: hit.map(r => {
      const fair = noVigPower({ home: Number(r.pin_h), draw: Number(r.pin_d), away: Number(r.pin_a) });
      return { event_id: r.event_id, league: r.league, home: r.home, away: r.away, commence_time: r.commence_time, updated_at: r.updated_at,
        fair: { home: fair.home, draw: fair.draw, away: fair.away }, pinnacle: { home: Number(r.pin_h), draw: Number(r.pin_d), away: Number(r.pin_a) } };
    }),
    nota: hit.length ? null : 'Partita non trovata: il CRM conosce solo le partite delle prossime 6 ore che ha letto nell\'ultimo giro. Riprova più vicino al calcio d\'inizio.'
  };
}

module.exports = { ensureBoard, saveBoard, judge, search };
