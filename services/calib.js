/**
 * 📚 STORICO E TARATURA (14 novembre 2026). Scarica da football-data.co.uk gli ultimi anni di partite con le quote di chiusura di
 * Pinnacle (gratis, senza crediti) e misura quanto Pinnacle ha ragione per campionato e fascia di probabilita'.
 * SOLA MISURA: non cambia segnali ne' regole. Serve a dare ai segnali un "secondo parere" (fase successiva) e a controllare le regole su anni di dati.
 * Tabella separata (hist_pin), esclusa dal backup: si riscarica in due minuti.
 */
const { LEAGUES } = require('./leagues');
const H = require('./history');

const SEASONS_BACK = 15;                   // 16/11/2026: dalla stagione 2012/13 (prima: 6 stagioni)
const SINCE_NEW = '2012-07-01';            // file "new" (un file per campionato con tutte le stagioni): dal 2012
const DATA_VERSION = '3';                  // 3 (17/11/2026): anche quota massima e media tra i bookmaker, per la prova del metodo                  // cambia quando serve riscaricare tutto
const BANDS = [0, 0.15, 0.25, 0.35, 0.5, 0.65, 1.0001];
const BAND_LABELS = ['sotto 15%', '15–25%', '25–35%', '35–50%', '50–65%', '65% e oltre'];
const K_LEAGUE = 300;                      // quanto pesa una lega: con 300 partite in quella fascia conta la meta' lega, la meta' il generale
let ready = false, running = false;

async function ensureCalib(pool) {
  if (ready) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS hist_pin (league TEXT NOT NULL, match_date DATE NOT NULL, home TEXT NOT NULL, away TEXT NOT NULL,
    hg INT NOT NULL, ag INT NOT NULL, ph NUMERIC(8,3), pd NUMERIC(8,3), pa NUMERIC(8,3), PRIMARY KEY (league, match_date, home, away))`);
  // 16/11/2026: le partite senza quote Pinnacle si tengono lo stesso (servono i risultati per la forza delle squadre)
  for (const col of ['ph', 'pd', 'pa']) await pool.query(`ALTER TABLE hist_pin ALTER COLUMN ${col} DROP NOT NULL`);
  // 17/11/2026: quota piu' alta e quota media tra tutti i bookmaker (chiusura, altrimenti prima della chiusura)
  for (const col of ['mh', 'md', 'ma', 'ah', 'ad', 'aa']) await pool.query(`ALTER TABLE hist_pin ADD COLUMN IF NOT EXISTS ${col} NUMERIC(8,3)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS calib_state (key TEXT PRIMARY KEY, val TEXT)`);
  ready = true;
}

const num = v => (v === '' || v === undefined || v === null || isNaN(Number(v)) ? null : Number(v));
const pick3 = (r, keys) => { for (const k of keys) { const a = num(r[k[0]]), b = num(r[k[1]]), c = num(r[k[2]]); if (a > 1 && b > 1 && c > 1) return [a, b, c]; } return null; };

/** Righe CSV -> partite con le quote Pinnacle (chiusura, altrimenti quelle prima della chiusura). Parte pura. */
function rowsToPin(leagueCode, rows, newFmt = false, sinceStr = null) {
  const out = [];
  for (const r of rows) {
    const date = H.parseDate(r.Date), home = newFmt ? r.Home : r.HomeTeam, away = newFmt ? r.Away : r.AwayTeam;
    const hg = num(newFmt ? r.HG : r.FTHG), ag = num(newFmt ? r.AG : r.FTAG);
    if (!date || !home || !away || hg === null || ag === null) continue;
    if (sinceStr && date < sinceStr) continue;
    // chiusura di Pinnacle, altrimenti Pinnacle prima della chiusura; senza Pinnacle la partita resta (solo risultato)
    const q = pick3(r, [['PSCH', 'PSCD', 'PSCA'], ['PSH', 'PSD', 'PSA'], ['PH', 'PD', 'PA']]);
    const mx = pick3(r, [['MaxCH', 'MaxCD', 'MaxCA'], ['MaxH', 'MaxD', 'MaxA'], ['BbMxH', 'BbMxD', 'BbMxA']]);
    const av = pick3(r, [['AvgCH', 'AvgCD', 'AvgCA'], ['AvgH', 'AvgD', 'AvgA'], ['BbAvH', 'BbAvD', 'BbAvA']]);
    out.push({ league: leagueCode, date, home, away, hg, ag, ph: q ? q[0] : null, pd: q ? q[1] : null, pa: q ? q[2] : null,
      mh: mx ? mx[0] : null, md: mx ? mx[1] : null, ma: mx ? mx[2] : null, ah: av ? av[0] : null, ad: av ? av[1] : null, aa: av ? av[2] : null });
  }
  return out;
}
function urlsFor(code, nowMs, back = SEASONS_BACK) {
  const l = LEAGUES[code]; if (!l || !l.csv) return [];
  if (l.newFmt) return [{ url: `https://football-data.co.uk/new/${l.csv}.csv`, newFmt: true }];
  const urls = [], d = new Date(nowMs);
  for (let i = 0; i < back; i++) { const x = new Date(Date.UTC(d.getUTCFullYear() - i, d.getUTCMonth(), 15)); urls.push({ url: `https://www.football-data.co.uk/mmz4281/${H.seasonCode(x.toISOString().slice(0, 10))}/${l.csv}.csv`, newFmt: false }); }
  return [...new Map(urls.map(u => [u.url, u])).values()];
}

async function upsertPin(pool, list) {
  const COLS = ['league', 'match_date', 'home', 'away', 'hg', 'ag', 'ph', 'pd', 'pa', 'mh', 'md', 'ma', 'ah', 'ad', 'aa'], K = COLS.length;
  let n = 0;
  for (let i = 0; i < list.length; i += 200) {
    const batch = list.slice(i, i + 200), p = [];
    const vals = batch.map((m, k) => { p.push(m.league, m.date, m.home, m.away, m.hg, m.ag, m.ph, m.pd, m.pa, m.mh ?? null, m.md ?? null, m.ma ?? null, m.ah ?? null, m.ad ?? null, m.aa ?? null);
      const b = k * K; return '(' + COLS.map((_, j) => '$' + (b + j + 1)).join(',') + ')'; });
    const keep = c => `${c} = COALESCE(EXCLUDED.${c}, hist_pin.${c})`;
    await pool.query(`INSERT INTO hist_pin (${COLS.join(', ')}) VALUES ${vals.join(',')}
      ON CONFLICT (league, match_date, home, away) DO UPDATE SET hg = EXCLUDED.hg, ag = EXCLUDED.ag, ${['ph', 'pd', 'pa', 'mh', 'md', 'ma', 'ah', 'ad', 'aa'].map(keep).join(', ')}`, p);
    n += batch.length;
  }
  return n;
}

/** Scarica e salva. current = solo la stagione in corso (aggiornamento giornaliero), altrimenti tutte. Non lancia errori: li conta. */
async function refreshHistory(pool, { nowMs = Date.now(), current = false, http } = {}) {
  await ensureCalib(pool);
  const axios = http || require('axios');
  const out = { files: 0, partite: 0, errori: 0, leghe: {} }, log = [];
  for (const code of Object.keys(LEAGUES)) {
    for (const u of urlsFor(code, nowMs, current ? 1 : SEASONS_BACK)) {
      try {
        const { data } = await axios.get(u.url, { responseType: 'text', timeout: 30000, headers: { 'User-Agent': 'betting-crm/1.0' } });
        const since = u.newFmt ? SINCE_NEW : null;
        const list = rowsToPin(code, H.parseCsv(String(data)), u.newFmt, since);
        out.partite += await upsertPin(pool, list); out.files++; out.leghe[code] = (out.leghe[code] || 0) + list.length;
        const withPin = list.filter(m => m.ph !== null), lastOf = l => l.reduce((a, m) => (m.date > a ? m.date : a), '') || null;
        log.push({ url: u.url.replace(/^https?:\/\/[^/]+/, ''), n: list.length, pin: withPin.length, last: lastOf(list), lastPin: lastOf(withPin) });
      } catch (e) { out.errori++; log.push({ url: u.url.replace(/^https?:\/\/[^/]+/, ''), error: (e.response && e.response.status) || e.code || e.message }); }   // una stagione mancante non ferma le altre
    }
  }
  await pool.query(`INSERT INTO calib_state (key, val) VALUES ('last', $1) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val`, [new Date(nowMs).toISOString()]);
  if (!current) await pool.query(`INSERT INTO calib_state (key, val) VALUES ('version', $1) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val`, [DATA_VERSION]);
  await pool.query(`INSERT INTO calib_state (key, val) VALUES ('files', $1) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val`, [JSON.stringify(log.slice(0, 200))]);
  return out;
}

/** In sottofondo a ogni giro: la prima volta scarica tutto, poi la stagione in corso una volta al giorno (dopo le 6 italiane). */
async function maybeRefresh(pool, { nowMs = Date.now() } = {}) {
  if (running) return { storico: 'in corso' };
  await ensureCalib(pool);
  const last = (await pool.query(`SELECT val FROM calib_state WHERE key = 'last'`)).rows[0];
  const ver = (await pool.query(`SELECT val FROM calib_state WHERE key = 'version'`)).rows[0];
  const empty = !last || !ver || ver.val !== DATA_VERSION, hourIt = (new Date(nowMs).getUTCHours() + 1) % 24;
  if (!empty && (nowMs - Date.parse(last.val) < 20 * 3600000 || hourIt < 6)) return { storico: 'aggiornato' };
  startRefresh(pool, { nowMs, current: !empty });
  return { storico: empty ? 'scarico completo avviato' : 'aggiornamento avviato' };
}
/** Avvia lo scarico in sottofondo (uno alla volta). */
function startRefresh(pool, opts = {}) {
  if (running) return false;
  running = true;
  refreshHistory(pool, opts).then(() => rebuildModels(pool)).catch(() => {}).finally(() => { running = false; });
  return true;
}
const isRunning = () => running;

// ------------------------------------------------------------------------------------------- taratura
const bandOf = p => { for (let i = 0; i < BANDS.length - 1; i++) if (p >= BANDS[i] && p < BANDS[i + 1]) return i; return null; };
const OUTS = ['home', 'draw', 'away'];

/** Dalle partite storiche: per ogni esito e fascia, attese (Pinnacle senza margine) contro uscite. Generale e per campionato. Parte pura. */
function calibrate(rows) {
  const cell = () => ({ n: 0, exp: 0, obs: 0 }), mk = () => OUTS.map(() => BAND_LABELS.map(cell));
  const all = mk(), by = {};
  for (const r of rows) {
    if (!(Number(r.ph) > 1 && Number(r.pd) > 1 && Number(r.pa) > 1)) continue;   // partite senza quote Pinnacle: solo per la forza delle squadre
    const h = Number(r.ph), d = Number(r.pd), a = Number(r.pa), s = 1 / h + 1 / d + 1 / a, p = [1 / h / s, 1 / d / s, 1 / a / s];
    const hg = Number(r.hg), ag = Number(r.ag), res = hg > ag ? 0 : hg === ag ? 1 : 2;
    const lg = by[r.league] || (by[r.league] = mk());
    for (let o = 0; o < 3; o++) { const b = bandOf(p[o]); if (b === null) continue; for (const t of [all, lg]) { const c = t[o][b]; c.n++; c.exp += p[o]; c.obs += res === o ? 1 : 0; } }
  }
  return { n: rows.length, all, by };
}

/** Probabilita' corretta con la storia: prima il generale (pesa quasi sempre tutto), poi la lega con peso n/(n+K). Restituisce anche la fiducia. */
function adjust(cal, league, outcome, p) {
  const o = OUTS.indexOf(outcome), b = bandOf(p); if (o < 0 || b === null || !cal) return { p, n: 0, shift: 0 };
  const g = cal.all[o][b], gShift = g.n >= 100 ? (g.obs - g.exp) / g.n : 0;
  const l = cal.by[league] ? cal.by[league][o][b] : null, lShift = l && l.n ? (l.obs - l.exp) / l.n : 0, w = l ? l.n / (l.n + K_LEAGUE) : 0;
  const shift = (1 - w) * gShift + w * lShift;
  return { p: Math.min(0.99, Math.max(0.01, p + shift)), n: l ? l.n : g.n, shift };
}

/** Per l'app: tabella generale e i campionati dove Pinnacle sbaglia in modo evidente (almeno 200 partite nella fascia e z oltre 2,5). Parte pura. */
function report(cal) {
  const row = (o, b, c) => { const p = c.n ? c.exp / c.n : null, q = c.n ? c.obs / c.n : null, sd = c.n ? Math.sqrt(p * (1 - p) / c.n) : null;
    return { outcome: OUTS[o], band: BAND_LABELS[b], n: c.n, expected: p, observed: q, diff: c.n ? q - p : null, z: sd ? (q - p) / sd : null }; };
  const general = []; for (let o = 0; o < 3; o++) for (let b = 0; b < BAND_LABELS.length; b++) if (cal.all[o][b].n) general.push(row(o, b, cal.all[o][b]));
  const odd = [];
  for (const [lg, t] of Object.entries(cal.by)) for (let o = 0; o < 3; o++) for (let b = 0; b < BAND_LABELS.length; b++) { const c = t[o][b]; if (c.n >= 200) { const r = row(o, b, c); if (Math.abs(r.z) >= 2.5) odd.push({ league: lg, ...r }); } }
  odd.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  return { n: cal.n, leagues: Object.keys(cal.by).length, general, odd: odd.slice(0, 12) };
}

const DAY = 24 * 3600000;
// 16/11/2026: Render gratuito si riaddormenta spesso e la memoria si azzera. I modelli gia' calcolati si salvano in calib_state
// (poche centinaia di KB) e si ricalcolano dalle 120.000 partite solo dopo l'aggiornamento dello storico (una volta al giorno).
async function loadState(pool, key) { const r = (await pool.query(`SELECT val FROM calib_state WHERE key = $1`, [key])).rows[0]; return r ? JSON.parse(r.val) : null; }
async function saveState(pool, key, obj) { await pool.query(`INSERT INTO calib_state (key, val) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET val = EXCLUDED.val`, [key, JSON.stringify(obj)]); }
async function buildCal(pool) {
  const rows = (await pool.query(`SELECT league, hg, ag, ph, pd, pa FROM hist_pin WHERE ph IS NOT NULL`)).rows;
  const cal = rows.length ? calibrate(rows) : null;
  if (cal) await saveState(pool, 'model_cal', cal);
  return cal;
}
const rawModel = require('./warm').memo(async pool => {
  await ensureCalib(pool);
  return (await loadState(pool, 'model_cal')) || buildCal(pool);
}, DAY);
let cache = null;
async function getCalibration(pool, { force = false, nowMs = Date.now() } = {}) {
  await ensureCalib(pool);
  if (!force && cache && nowMs - cache.at < 10 * 60000) return cache.val;
  const cal = await rawModel.get(pool);
  const all = (await pool.query(`SELECT COUNT(*)::int AS n, MAX(match_date) AS b FROM hist_pin`)).rows[0];
  const last = (await pool.query(`SELECT val FROM calib_state WHERE key = 'last'`)).rows[0];
  const range = (await pool.query(`SELECT MIN(match_date) AS a, MAX(match_date) AS b FROM hist_pin WHERE ph IS NOT NULL`)).rows[0];
  let files = null; try { const f = (await pool.query(`SELECT val FROM calib_state WHERE key = 'files'`)).rows[0]; files = f ? JSON.parse(f.val) : null; } catch (e) { files = null; }
  const val = { ...(cal ? report(cal) : { n: 0, leagues: 0, general: [], odd: [] }), running, last: last ? last.val : null, from: range.a, to: range.b, files, allMatches: all.n, resultsTo: all.b };
  cache = { at: nowMs, val }; return val;
}

/** Taratura grezza (per pronostico IA e secondo parere). wait=false: non aspetta, null se non ancora pronta. */
async function getCalRaw(pool, { wait = true } = {}) { return wait ? rawModel.get(pool) : rawModel.peek(pool); }
/** Dopo un aggiornamento dello storico: tutti i calcoli pesanti si rifanno. */
async function rebuildModels(pool) {
  rawModel.invalidate(); cache = null;
  try { require('./opinion').invalidate(); } catch (e) { /* facoltativo */ }
  await buildCal(pool);
  try { await require('./elo').rebuild(pool); } catch (e) { /* facoltativo */ }
  try { await require('./backtest').getBacktest(pool, { force: true }); } catch (e) { /* facoltativo */ }
  try { await require('./forma').getFormaTest(pool, { force: true }); } catch (e) { /* facoltativo */ }
}

module.exports = { rebuildModels, loadState, saveState, getCalRaw, BANDS, BAND_LABELS, K_LEAGUE, rowsToPin, urlsFor, refreshHistory, maybeRefresh, startRefresh, isRunning, calibrate, adjust, report, getCalibration, ensureCalib };
