/**
 * Dati Transfermarkt (dataset pubblico dcaribou/transfermarkt-datasets, licenza CC0, fermo al 6/7/2026):
 * per ogni partita calcola dal database, PRIMA del fischio d'inizio:
 *  - valore degli undici titolari (somma dell'ultimo valore di mercato noto di ciascuno);
 *  - valore della rosa (giocatori schierati negli ultimi 240 giorni);
 *  - quota di valore dei "titolari abituali" (chi ha giocato da titolare almeno meta' delle ultime 10) che manca in formazione.
 * Legge i file .csv.gz in streaming (sono grandi) e produce UN csv piccolo da scaricare. Serve al test "il valore delle rose
 * aggiunge informazione rispetto alle quote?". Non e' usabile dal vivo: il dataset non si aggiorna piu'.
 */
const zlib = require('zlib');

const BASE = 'https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/';
const COMPETITIONS = ['IT1', 'GB1', 'L1', 'ES1', 'FR1', 'NL1', 'PO1', 'BE1', 'TR1', 'GR1', 'SC1', 'GB2', 'L2', 'IT2', 'ES2', 'FR2'];
const SINCE = '2016-07-01';
const SQUAD_DAYS = 240, RECENT_GAMES = 10, DAY = 86400000;
const COLUMNS = ['game_id', 'date', 'competition_id', 'home_club_name', 'away_club_name', 'home_goals', 'away_goals',
  'h_xi_value', 'a_xi_value', 'h_squad_value', 'a_squad_value', 'h_absent_share', 'a_absent_share', 'h_starters', 'a_starters', 'h_xi_missing', 'a_xi_missing'];

function splitCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}

/** Legge un flusso di testo CSV riga per riga (senza caricarlo tutto in memoria). Restituisce l'intestazione. */
async function eachRow(stream, onRow, prefilter) {
  stream.setEncoding('utf8');
  let buf = '', header = null;
  const handle = line => {
    if (!line) return;
    if (!header) { header = splitCsvLine(line).map(h => h.trim().replace(/^\uFEFF/, '')); return; }
    if (prefilter && !prefilter(line)) return;
    const f = splitCsvLine(line), row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = f[i];
    onRow(row);
  };
  for await (const chunk of stream) {
    buf += chunk; let i;
    while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
  }
  handle(buf.replace(/\r$/, ''));
  return header;
}

function makeOpen() {
  const axios = require('axios');
  return async function open(name) {
    const res = await axios.get(BASE + name, { responseType: 'stream', timeout: 120000, headers: { 'User-Agent': 'betting-crm/1.0 (uso personale)' } });
    return res.data.pipe(zlib.createGunzip());
  };
}

const ms = s => Date.parse(String(s).slice(0, 10) + 'T00:00:00Z');

function valueAt(vals, pid, t) {
  const a = vals.get(pid); if (!a) return null;
  let lo = 0, hi = a.d.length - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (a.d[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return r >= 0 ? a.v[r] : null;
}

async function build({ open, progress = () => {} }) {
  const info = { columns: {}, competitions: {}, valuations: 0, games: 0, lineupRows: 0 };
  // 1) valori di mercato
  const vals = new Map();
  progress('valori di mercato dei giocatori');
  info.columns.player_valuations = await eachRow(await open('player_valuations.csv.gz'), r => {
    const v = Number(r.market_value_in_eur); const t = ms(r.date);
    if (!r.player_id || !(v >= 0) || !Number.isFinite(t)) return;
    let a = vals.get(r.player_id); if (!a) vals.set(r.player_id, a = { d: [], v: [] });
    a.d.push(t); a.v.push(v); info.valuations++;
  });
  for (const a of vals.values()) {              // ordine cronologico
    const idx = a.d.map((_, i) => i).sort((x, y) => a.d[x] - a.d[y]);
    a.d = idx.map(i => a.d[i]); a.v = idx.map(i => a.v[i]);
  }
  // 2) partite dei campionati scelti
  progress('partite');
  const games = new Map(), comps = new Set(COMPETITIONS), since = ms(SINCE);
  info.columns.games = await eachRow(await open('games.csv.gz'), r => {
    if (!comps.has(r.competition_id)) return;
    const t = ms(r.date); if (!(t >= since)) return;
    if (r.home_club_goals === '' || r.away_club_goals === '' || r.home_club_goals === undefined) return;
    games.set(r.game_id, { id: r.game_id, t, date: String(r.date).slice(0, 10), comp: r.competition_id, hc: r.home_club_id, ac: r.away_club_id,
      hn: r.home_club_name, an: r.away_club_name, hg: Number(r.home_club_goals), ag: Number(r.away_club_goals), hs: [], as: [] });
    info.competitions[r.competition_id] = (info.competitions[r.competition_id] || 0) + 1; info.games++;
  });
  // 3) formazioni titolari
  progress('formazioni titolari (file grande: qualche minuto)');
  info.columns.game_lineups = await eachRow(await open('game_lineups.csv.gz'), r => {
    const g = games.get(r.game_id); if (!g) return;
    info.lineupRows++;
    if (r.club_id === g.hc) g.hs.push(r.player_id); else if (r.club_id === g.ac) g.as.push(r.player_id);
  }, line => line.includes('starting_lineup'));
  // 4) caratteristiche, in ordine cronologico
  progress('calcolo del valore delle rose');
  const clubs = new Map();     // club -> { recent: [Set,...], seen: Map(player -> ultima data) }
  const feat = (club, starters, t) => {
    let c = clubs.get(club); if (!c) clubs.set(club, c = { recent: [], seen: new Map() });
    let xi = 0, missing = 0;
    for (const p of starters) { const v = valueAt(vals, p, t); if (v === null) missing++; else xi += v; }
    let squad = 0;
    for (const [p, last] of c.seen) if (t - last <= SQUAD_DAYS * DAY) { const v = valueAt(vals, p, t); if (v !== null) squad += v; }
    let absent = null;
    if (c.recent.length >= 3) {
      const counts = new Map();
      for (const s of c.recent) for (const p of s) counts.set(p, (counts.get(p) || 0) + 1);
      const need = Math.ceil(c.recent.length / 2), inXi = new Set(starters);
      let tot = 0, pres = 0;
      for (const [p, n] of counts) if (n >= need) { const v = valueAt(vals, p, t) || 0; tot += v; if (inXi.has(p)) pres += v; }
      if (tot > 0) absent = 1 - pres / tot;
    }
    return { xi, squad, absent, missing, c };
  };
  const rows = [], order = [...games.values()].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  for (const g of order) {
    const ok = g.hs.length >= 9 && g.as.length >= 9;
    let h = null, a = null;
    if (ok) { h = feat(g.hc, g.hs, g.t); a = feat(g.ac, g.as, g.t); }
    rows.push({ game_id: g.id, date: g.date, competition_id: g.comp, home_club_name: g.hn, away_club_name: g.an, home_goals: g.hg, away_goals: g.ag,
      h_xi_value: ok ? h.xi / 1e6 : '', a_xi_value: ok ? a.xi / 1e6 : '', h_squad_value: ok ? h.squad / 1e6 : '', a_squad_value: ok ? a.squad / 1e6 : '',
      h_absent_share: ok && h.absent !== null ? h.absent : '', a_absent_share: ok && a.absent !== null ? a.absent : '',
      h_starters: g.hs.length, a_starters: g.as.length, h_xi_missing: ok ? h.missing : '', a_xi_missing: ok ? a.missing : '' });
    if (ok) for (const [club, starters, f] of [[g.hc, g.hs, h], [g.ac, g.as, a]]) {   // aggiorna la storia DOPO aver calcolato la partita
      f.c.recent.push(new Set(starters)); if (f.c.recent.length > RECENT_GAMES) f.c.recent.shift();
      for (const p of starters) f.c.seen.set(p, g.t);
    }
  }
  info.withFeatures = rows.filter(r => r.h_xi_value !== '').length;
  return { rows, info };
}

function toCsv(rows) {
  const esc = v => { const s = typeof v === 'number' ? String(Math.round(v * 10000) / 10000) : String(v === undefined || v === null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [COLUMNS.join(','), ...rows.map(r => COLUMNS.map(c => esc(r[c])).join(','))].join('\n');
}

function createJob({ open, ...rest } = {}) {
  const st = { running: false, finished: false, stage: null, error: null, info: null, csv: null, startedAt: null };
  async function run() {
    if (st.running) return;
    Object.assign(st, { running: true, finished: false, stage: 'avvio', error: null, info: null, csv: null, startedAt: new Date().toISOString() });
    try {
      const { rows, info } = await build({ open: open || makeOpen(), progress: s => { st.stage = s; }, ...rest });
      st.info = info; st.csv = toCsv(rows); st.finished = true; st.stage = 'finito';
    } catch (err) { st.error = err.message; st.stage = 'errore'; }
    finally { st.running = false; }
  }
  return { run, csv: () => st.csv, status: () => ({ running: st.running, finished: st.finished, fase: st.stage, errore: st.error, avviato: st.startedAt, info: st.info }) };
}

module.exports = { createJob, build, toCsv, valueAt, COLUMNS, COMPETITIONS };
