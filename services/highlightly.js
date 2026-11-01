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
  // solo i 90 minuti: con supplementari o rigori il punteggio non e' quello della scommessa, si lascia a mano
  if (/extra|penalt|aet|pen\b/.test(desc)) return null;
  const done = /finished|full time|\bft\b|ended/.test(desc);
  const s = (st && st.score && (st.score.current || st.score.fulltime)) || (m.score && (m.score.current || m.score.fulltime)) || null;
  if (!done || !s) return null;
  const txt = typeof s === 'string' ? s : (s.home !== undefined ? `${s.home}-${s.away}` : '');
  const g = txt.match(/(\d+)\s*[-:]\s*(\d+)/);
  return g ? `${g[1]}-${g[2]}` : null;
}

/**
 * Trova la partita di Highlightly per un nostro segnale: prima con tutte e due le squadre; se non basta,
 * stesso orario (entro 20 minuti) e almeno una squadra uguale (i nomi delle serie minori sono scritti in modi diversi).
 */
function findMatch(s, matches, sameTeam) {
  const both = matches.filter(x => sameTeam(s.home, nameOf(x.homeTeam)) && sameTeam(s.away, nameOf(x.awayTeam)));
  if (both.length === 1) return both[0];
  const t = Date.parse(s.commence_time);
  if (!Number.isFinite(t)) return both[0] || null;
  const near = x => { const d = Date.parse(x.date || x.startDate || ''); return Number.isFinite(d) && Math.abs(d - t) <= 20 * 60000; };
  const timed = (both.length ? both : matches.filter(x => sameTeam(s.home, nameOf(x.homeTeam)) || sameTeam(s.away, nameOf(x.awayTeam)))).filter(near);
  return timed.length === 1 ? timed[0] : null;   // piu' di un candidato: meglio non indovinare
}

/** Parte pura (testata): abbina le partite di Highlightly ai segnali di quel giorno. */
function coverage(matches, signals, sameTeam) {
  const events = new Map();
  for (const s of signals) if (!events.has(s.event_id)) events.set(s.event_id, s);
  const rows = [...events.values()].map(s => {
    const m = findMatch(s, matches, sameTeam);
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
  let matches = null, base = 'Highlightly', errors = [];
  if (await usedToday(pool) >= DAILY_CAP) return { ok: false, giorno: d, motivo: 'tetto giornaliero di richieste raggiunto: riprova domani' };
  try { matches = await fetchDay(key, d, http, 30); await require('./results').logRequestPublic(pool, 'prova ' + d, true, matches.length, `prova pagine=${matches.pages || 1}`, 'hl'); }
  catch (e) { errors.push(String((e.response && e.response.status) || e.message)); }
  if (!matches) { const out = { ok: false, giorno: d, motivo: 'Highlightly non risponde con questa chiave', errori: errors }; last = { at: nowMs, out }; return out; }
  const I = require('./italia');
  const { rows } = await pool.query(`SELECT event_id, league, home, away, commence_time FROM italia_signals WHERE commence_time >= $1::date AND commence_time < $1::date + INTERVAL '1 day'`, [d]);
  const out = { ok: true, giorno: d, fonte: base, ...coverage(matches, rows, I.sameTeam) };
  last = { at: nowMs, out };
  return out;
}

/** Tutte le partite di un giorno (a pagine da 100). Conta le richieste fatte (pagine) per il tetto giornaliero. */
const DAILY_CAP = 80;   // piano gratuito 100 al giorno: 20 restano di margine (prova manuale, imprevisti)
async function fetchDay(key, day, http, budget = 30) {
  let lastErr = null, pages = 0;
  for (const b of BASES) {
    try {
      const all = [];
      for (let offset = 0; offset < 3000 && pages < budget; offset += 100) {
        const r = await http.get(`${b}/matches`, { params: { date: day, timezone: 'Etc/UTC', limit: 100, offset }, headers: { 'x-rapidapi-key': key }, timeout: 30000 });
        pages++;
        const page = arr(r.data); all.push(...page);
        if (page.length < 100) break;
      }
      all.pages = pages;
      return all;
    } catch (e) { pages++; lastErr = e; }
  }
  if (lastErr) lastErr.pages = pages;
  throw lastErr || new Error('nessuna risposta');
}
/** Richieste a Highlightly gia' fatte oggi (UTC), dal registro. */
async function usedToday(pool) {
  const { rows } = await pool.query(`SELECT COALESCE(SUM(COALESCE(NULLIF(substring(note from 'pagine=([0-9]+)'), '')::int, 1)), 0)::int AS n FROM results_requests WHERE src = 'hl' AND at >= date_trunc('day', NOW())`);
  return rows[0].n;
}

/**
 * RISULTATI AUTOMATICI DA HIGHLIGHTLY (1° novembre 2026). Gira a ogni giro dopo football-data, solo sui segnali ancora senza risultato
 * degli ultimi 3 giorni. Ogni giorno si legge al massimo due volte (dalle 6 del giorno dopo, poi di nuovo dopo 10 ore per le partite
 * della sera): circa 20 richieste al giorno sulle 100 del piano gratuito. Il risultato vale per tutte le righe della stessa partita.
 */
async function settleFromHighlightly(pool, { env = process.env, http = axios, nowMs = Date.now() } = {}) {
  const key = env.HIGHLIGHTLY_KEY;
  if (!key) return { highlightly: 'chiave non impostata' };
  const R = require('./results'), I = require('./italia');
  await R.ensureResults(pool);
  const { rows } = await pool.query(`SELECT id, event_id, selection, home, away, league, commence_time FROM italia_signals
    WHERE (result IS NULL OR result = 'notfound') AND commence_time < to_timestamp($1::double precision / 1000) - INTERVAL '150 minutes'
      AND commence_time > to_timestamp($1::double precision / 1000) - INTERVAL '3 days'`, [nowMs]);
  // ⚽ anche le partite viste per i gol (stesse pagine: nessuna richiesta in piu' per i giorni gia' da leggere)
  const G = require('./goals'), watchRows = await G.pendingWatch(pool, nowMs);
  if (!rows.length && !watchRows.length) return { highlightly: 'niente da chiudere' };
  const days = [...new Set([...rows, ...watchRows].map(r => new Date(r.commence_time).toISOString().slice(0, 10)))].sort();
  let lette = 0, chiuse = 0; const fatti = [];
  for (const day of days) {
    const tries = (await pool.query(`SELECT at FROM results_requests WHERE src = 'hl' AND day = $1 ORDER BY id DESC`, [day])).rows;
    const dayEnd = Date.parse(day + 'T00:00:00Z') + 86400000;
    const due = tries.length === 0 ? nowMs >= dayEnd + 5 * 3600000 || nowMs - Date.parse(day) > 30 * 3600000
      : tries.length === 1 ? nowMs - Date.parse(tries[0].at) >= 10 * 3600000 : false;
    if (!due) continue;
    const room = DAILY_CAP - await usedToday(pool);
    if (room < 10) { fatti.push(`${day}: tetto giornaliero`); break; }
    let matches;
    try { matches = await fetchDay(key, day, http, room); }
    catch (e) { await R.logRequestPublic(pool, day, false, 0, `${(e.response && e.response.status) || e.message} pagine=${e.pages || 1}`, 'hl'); continue; }
    lette += matches.length;
    const sigs = rows.filter(r => new Date(r.commence_time).toISOString().slice(0, 10) === day);
    const byEvent = new Map(); for (const s of sigs) if (!byEvent.has(s.event_id)) byEvent.set(s.event_id, s);
    let n = 0;
    for (const s of byEvent.values()) {
      const m = findMatch(s, matches, I.sameTeam), sc = m && finalScore(m);
      if (!sc) continue;
      const [h, a] = sc.split('-').map(Number);
      const all = (await pool.query(`SELECT id, selection FROM italia_signals WHERE event_id = $1`, [s.event_id])).rows;
      for (const r of all) await pool.query(`UPDATE italia_signals SET result = $2, result_score = $3, settled_at = NOW() WHERE id = $1 AND (result IS NULL OR result = 'notfound')`, [r.id, R.outcome(r.selection, h, a), sc]);
      n++;
    }
    let ng = 0;
    for (const w of watchRows.filter(r => new Date(r.commence_time).toISOString().slice(0, 10) === day)) {
      const m = findMatch(w, matches, I.sameTeam), sc = m && finalScore(m);
      if (sc) { try { await G.setWatchScore(pool, w.event_id, sc); ng++; } catch (e) { /* facoltativo */ } }
    }
    chiuse += n; fatti.push(day);
    await R.logRequestPublic(pool, day, true, matches.length, `${n} partite chiuse su ${byEvent.size}, gol ${ng} pagine=${matches.pages || 1}`, 'hl');
  }
  return fatti.length ? { highlightly: 'fatto', giorni: fatti, partiteLette: lette, partiteChiuse: chiuse } : { highlightly: 'non ancora' };
}

module.exports = { check, coverage, finalScore, findMatch, settleFromHighlightly, usedToday, DAILY_CAP };
