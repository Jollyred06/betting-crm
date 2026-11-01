/**
 * PROVA DI HIGHLIGHTLY (1° novembre 2026): prima di collegarlo ai risultati, si misura se copre le NOSTRE partite.
 * Con la chiave HIGHLIGHTLY_KEY (messa solo su Render) legge le partite di un giorno e le abbina ai segnali italiani di quel giorno:
 * quante trovate, quante con il risultato finale, quali campionati mancano. Una lettura ogni 10 minuti al massimo
 * (piano gratuito: 100 richieste al giorno). Non scrive niente nel database.
 */
const axios = require('axios');
const BASES = ['https://soccer.highlightly.net', 'https://sports.highlightly.net/football'];
let last = null;

const arr = d => (Array.isArray(d) ? d : d && Array.isArray(d.data) ? d.data : []);
const nameOf = t => (t && (t.name || t.displayName || t.shortName)) || '';
/** Punteggio finale di una partita di Highlightly in forma "2-1", oppure null se non e' finita o manca. */
function finalScore(m) {
  const st = m && m.state, desc = String((st && (st.description || st.status)) || m.status || '').toLowerCase();
  const done = /finished|full time|ft|ended|after penalties|after extra/.test(desc);
  const s = (st && st.score && (st.score.current || st.score.fulltime)) || (m.score && (m.score.current || m.score.fulltime)) || null;
  if (!done || !s) return null;
  const txt = typeof s === 'string' ? s : (s.home !== undefined ? `${s.home}-${s.away}` : '');
  const g = txt.match(/(\d+)\s*[-:]\s*(\d+)/);
  return g ? `${g[1]}-${g[2]}` : null;
}

/** Parte pura (testata): abbina le partite di Highlightly ai segnali di quel giorno. */
function coverage(matches, signals, sameTeam) {
  const events = new Map();
  for (const s of signals) if (!events.has(s.event_id)) events.set(s.event_id, s);
  const rows = [...events.values()].map(s => {
    const m = matches.find(x => sameTeam(s.home, nameOf(x.homeTeam)) && sameTeam(s.away, nameOf(x.awayTeam)));
    return { league: s.league, match: `${s.home} – ${s.away}`, found: !!m, score: m ? finalScore(m) : null };
  });
  const missingLeagues = {};
  for (const r of rows.filter(x => !x.found)) missingLeagues[r.league] = (missingLeagues[r.league] || 0) + 1;
  return { partiteHighlightly: matches.length, nostrePartite: rows.length, trovate: rows.filter(r => r.found).length, conRisultato: rows.filter(r => r.score).length,
    campionatiMancanti: Object.entries(missingLeagues).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([l, n]) => `${l} (${n})`), esempi: rows.slice(0, 8) };
}

async function check(pool, { env = process.env, http = axios, nowMs = Date.now(), day = null } = {}) {
  const key = env.HIGHLIGHTLY_KEY;
  if (!key) return { ok: false, motivo: 'HIGHLIGHTLY_KEY non impostata su Render' };
  if (last && nowMs - last.at < 10 * 60000) return { ...last.out, dallaCopia: true };
  const d = day || new Date(nowMs - 86400000).toISOString().slice(0, 10);   // ieri: partite finite
  let matches = null, base = null, errors = [];
  for (const b of BASES) {
    try {
      const all = [];
      for (let offset = 0; offset < 2000; offset += 100) {
        const r = await http.get(`${b}/matches`, { params: { date: d, timezone: 'Etc/UTC', limit: 100, offset }, headers: { 'x-rapidapi-key': key }, timeout: 30000 });
        const page = arr(r.data); all.push(...page);
        if (page.length < 100) break;
      }
      matches = all; base = b; break;
    } catch (e) { errors.push(`${b}: ${(e.response && e.response.status) || e.message}`); }
  }
  if (!matches) { const out = { ok: false, giorno: d, motivo: 'Highlightly non risponde con questa chiave', errori: errors }; last = { at: nowMs, out }; return out; }
  const I = require('./italia');
  const { rows } = await pool.query(`SELECT event_id, league, home, away FROM italia_signals WHERE commence_time >= $1::date AND commence_time < $1::date + INTERVAL '1 day'`, [d]);
  const out = { ok: true, giorno: d, fonte: base, ...coverage(matches, rows, I.sameTeam) };
  last = { at: nowMs, out };
  return out;
}

module.exports = { check, coverage, finalScore };
