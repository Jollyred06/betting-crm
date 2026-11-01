/**
 * 📊 BOOKMAKER (1° novembre 2026): quale sito conviene, misurato con gli stessi numeri delle strategie.
 * Si usano i segnali I (6 siti) e T (tutti i siti italiani del feed): ogni segnale dice "questo sito pagava piu' del prezzo giusto".
 * Per ogni sito: occasioni (una per partita, esito e lettura), valore contro la chiusura di Pinnacle, vinte contro attese, saldo sulla carta a 2 €.
 * Giudizio solo con almeno MIN_N segnali misurati: 🟢 conviene (fascia al 95% sopra zero), 🔴 da evitare (sotto zero), 🟡 da vedere.
 * Avvisi: sito da aprire, sito in calo, quote che spariscono (possibile limitazione del conto).
 */
const MIN_N = 20;
const STAKE = 2;
const DAY = 86400000;
const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
const SEL_IDX = { home: 0, draw: 1, away: 2 };

function band(values) {
  const n = values.length; if (!n) return { n: 0, mean: null, lo: null, hi: null, pos: null };
  const m = values.reduce((a, b) => a + b, 0) / n;
  if (n < 5) return { n, mean: m, lo: null, hi: null, pos: 100 * values.filter(v => v > 0).length / n };
  const sd = Math.sqrt(values.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1)), h = 1.96 * sd / Math.sqrt(n);
  return { n, mean: m, lo: m - h, hi: m + h, pos: 100 * values.filter(v => v > 0).length / n };
}
const verdictOf = b => b.n < MIN_N || b.lo === null ? 'pochi' : b.lo > 0 ? 'ok' : b.hi < 0 ? 'no' : 'forse';
const parseQ = q => { try { return typeof q === 'string' ? JSON.parse(q) : q; } catch (e) { return null; } };

/** Parte pura (testata). rows = segnali I e T; my = chiavi dei siti dove si ha il conto; names = nomi leggibili. */
function buildBooks(rows, { my = ['888sport_it', 'snai'], names = {}, nowMs = Date.now() } = {}) {
  // un'occasione per sito, partita, esito e lettura (la stessa occasione puo' comparire sia nella I sia nella T)
  const seen = new Set(), occ = [];
  for (const r of [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    const k = `${r.book}|${r.event_id}|${r.selection}|${r.phase || ''}`;
    if (seen.has(k)) continue;
    seen.add(k); occ.push(r);
  }
  const byBook = new Map();
  for (const r of occ) { if (!byBook.has(r.book)) byBook.set(r.book, []); byBook.get(r.book).push(r); }
  const books = [...byBook.entries()].map(([key, list]) => {
    const meas = list.filter(r => num(r.clv_pct) !== null).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const b = band(meas.map(r => num(r.clv_pct)));
    const last30 = band(meas.slice(-30).map(r => num(r.clv_pct)));
    const done = list.filter(r => r.result === 'won' || r.result === 'lost');
    const won = done.filter(r => r.result === 'won').length, expected = done.reduce((a, r) => a + (num(r.fair_prob) || 0), 0);
    const pnl = done.reduce((a, r) => a + (r.result === 'won' ? STAKE * (num(r.odd) - 1) : -STAKE), 0);
    return { key, name: names[key] || key, mine: my.includes(key), signals: list.length, recent14: list.filter(r => nowMs - Date.parse(r.created_at) <= 14 * DAY).length,
      clv: b, last30, verdict: verdictOf(b), settled: done.length, won, expected, pnlEur: pnl, avgEdge: list.reduce((a, r) => a + (num(r.edge_pct) || 0), 0) / list.length };
  }).sort((a, b) => (b.mine - a.mine) || (b.signals - a.signals));

  // presenza delle quote dei miei siti: ultimi 3 giorni contro gli 11 prima (sulle righe che hanno le quote di tutti i siti)
  const withQ = rows.map(r => ({ r, q: parseQ(r.quotes) })).filter(x => x.q && Object.keys(x.q).length >= 5);
  const presence = key => {
    const has = x => { const v = x.q[key]; return Array.isArray(v) && Number(v[SEL_IDX[x.r.selection]]) > 1; };
    const rec = withQ.filter(x => nowMs - Date.parse(x.r.created_at) <= 3 * DAY), old = withQ.filter(x => { const a = nowMs - Date.parse(x.r.created_at); return a > 3 * DAY && a <= 14 * DAY; });
    return { recent: rec.length ? rec.filter(has).length / rec.length : null, before: old.length ? old.filter(has).length / old.length : null, nRecent: rec.length, nBefore: old.length };
  };

  const alerts = [];
  const mine = books.filter(b => b.mine), bestMine = Math.max(-99, ...mine.filter(b => b.clv.n >= MIN_N).map(b => b.clv.mean));
  for (const b of books.filter(x => !x.mine && x.verdict === 'ok' && x.recent14 >= 10 && x.clv.mean > bestMine))
    alerts.push({ level: 'info', kind: 'apri', book: b.name, text: `${b.name}: ${b.recent14} occasioni negli ultimi 14 giorni e valore ${b.clv.mean.toFixed(1)}% contro la chiusura (meglio dei tuoi siti). Valuta di aprire il conto.` });
  for (const b of mine.filter(x => x.last30.n >= MIN_N && x.last30.mean < 0))
    alerts.push({ level: 'bad', kind: 'calo', book: b.name, text: `${b.name}: negli ultimi ${b.last30.n} segnali il valore è sceso a ${b.last30.mean.toFixed(1)}%. Controlliamo prima di continuare a giocarci.` });
  for (const key of my) {   // anche i miei siti senza segnali: e' proprio quando spariscono che servono gli avvisi
    const p = presence(key), b = books.find(x => x.key === key), name = names[key] || key;
    if (p.recent !== null && p.before !== null && p.nRecent >= 10 && p.nBefore >= 20 && p.before >= 0.5 && p.recent < p.before * 0.5)
      alerts.push({ level: 'bad', kind: 'sparisce', book: name, text: `${name}: negli ultimi 3 giorni ha la quota solo sul ${Math.round(100 * p.recent)}% delle partite (prima ${Math.round(100 * p.before)}%). Se non trovi più le quote sul sito, potrebbe averti limitato il conto.` });
    if (b) b.presence = p;
  }
  const missed = books.filter(b => !b.mine).reduce((a, b) => a + b.recent14, 0);
  return { minN: MIN_N, my: my.map(k => names[k] || k), books, alerts, missed14: missed, updatedAt: new Date(nowMs).toISOString() };
}

async function getBooks(pool, env = process.env, nowMs = Date.now()) {
  const I = require('./italia'), c = I.cfg(env);
  const { rows } = await pool.query(`SELECT id, event_id, phase, strategy, created_at, commence_time, selection, book, odd, fair_prob, edge_pct, clv_pct, result, quotes
    FROM italia_signals WHERE strategy IN ('I', 'T') AND created_at > NOW() - INTERVAL '120 days'`);
  return buildBooks(rows, { my: c.myBooks, names: I.BOOK_NAMES, nowMs });
}

module.exports = { buildBooks, getBooks, MIN_N, verdictOf, band };
