/**
 * 🧪 PROVA DI ALTRI MERCATI (17 novembre 2026): handicap asiatico, doppia chance, gol/no gol. Solo a mano e sulla carta,
 * UNA richiesta odss per mercato. Per ogni partita e linea: probabilita' giusta dalle quote di Pinnacle senza margine
 * (qualunque siano i nomi degli esiti), e per ogni sito italiano di quanto paga piu' o meno del giusto.
 * Non salva segnali e non cambia regole: dice solo se in quel mercato c'e' valore, come la prova dell'Over/Under.
 */
const MARKETS = { ah: 'handicap asiatico', dc: 'doppia chance', btts: 'gol / no gol' };

/** Parte pura: riassume i record di un mercato. */
function summarizeMarket(records, { minEdge = 2 } = {}) {
  const edges = [], events = new Set(), withPin = new Set(), books = {}, keys = {}, found = [];
  for (const r of records || []) {
    if ((r.scope || 'match') !== 'match' || (r.period || 'full_time') !== 'full_time' || (r.state || 'prematch') !== 'prematch') continue;
    events.add(r.event_id);
    const pin = (r.bookmakers || []).find(b => b.key === 'pinnacle');
    const po = pin && pin.outcomes ? Object.fromEntries(Object.entries(pin.outcomes).map(([k, v]) => [String(k).toUpperCase(), Number(v)]).filter(([, v]) => v > 1)) : null;
    if (!po || Object.keys(po).length < 2) continue;
    // doppia chance: gli esiti si sovrappongono (1X + X2 + 12 = 200%), il margine si toglie dividendo per la somma e moltiplicando per 2
    const inv = Object.fromEntries(Object.entries(po).map(([k, v]) => [k, 1 / v])), sum = Object.values(inv).reduce((a, b) => a + b, 0);
    const scale = Object.keys(po).length === 3 && sum > 1.6 ? 2 / sum : 1 / sum;
    const fair = Object.fromEntries(Object.entries(inv).map(([k, v]) => [k, v * scale]));
    withPin.add(r.event_id);
    for (const k of Object.keys(po)) keys[k] = (keys[k] || 0) + 1;
    for (const b of r.bookmakers || []) {
      if (b.key === 'pinnacle' || !b.outcomes) continue;
      books[b.key] = (books[b.key] || 0) + 1;
      for (const [k, v] of Object.entries(b.outcomes)) {
        const K = String(k).toUpperCase(), odd = Number(v); if (!(odd > 1) || !(fair[K] > 0)) continue;
        const e = (odd * fair[K] - 1) * 100; if (e > 25) continue;   // quasi sempre un errore di lettura
        edges.push(e);
        if (e >= minEdge) found.push({ event: r.event_id, partita: `${r.home_team || '?'} – ${r.away_team || '?'}`, lega: r.league || null, linea: r.line ?? r.handicap ?? null, esito: K, sito: b.key, quota: odd, edgePct: Math.round(e * 10) / 10 });
      }
    }
  }
  edges.sort((a, b) => a - b);
  const q = f => (edges.length ? Math.round(edges[Math.min(edges.length - 1, Math.floor(f * edges.length))] * 10) / 10 : null);
  found.sort((a, b) => b.edgePct - a.edgePct);
  return { righe: (records || []).length, partite: events.size, partiteConPinnacle: withPin.size, quote: edges.length, esiti: keys, siti: books,
    vantaggioMediano: q(0.5), vantaggio90: q(0.9), conVantaggio: found.length, partiteConVantaggio: new Set(found.map(f => f.event)).size,
    quotaConVantaggioPct: edges.length ? Math.round(1000 * found.length / edges.length) / 10 : null, esempi: found.slice(0, 5) };
}

async function marketCheck(pool, market, env = process.env, { http, nowMs = Date.now() } = {}) {
  if (!MARKETS[market]) return { ok: false, motivo: `mercato non previsto (${Object.keys(MARKETS).join(', ')})` };
  const I = require('./italia'), c = I.cfg(env);
  if (!c.key) return { ok: false, motivo: 'ODSS_API_KEY non impostata' };
  const books = market === 'dc' ? [...new Set([...c.books, ...c.myBooks])] : [...new Set(['pinnacle', ...c.books, ...c.myBooks])];
  const records = await I.fetchOdds(pool, c, { market, content: 'match', limit: 3000, bookmakers: books.join(','),
    commence_from: new Date(nowMs + 15 * 60000).toISOString(), commence_to: new Date(nowMs + 24 * 3600000).toISOString() }, 'market_check', http);
  if (market === 'dc') {
    const ids = [...new Set((records || []).map(r => r.event_id))];
    const pins = new Map(ids.length ? (await pool.query(`SELECT event_id, pin_h, pin_d, pin_a FROM goal_watch WHERE event_id = ANY($1) AND pin_h IS NOT NULL`, [ids])).rows.map(r => [r.event_id, r]) : []);
    return { ok: true, market, nome: MARKETS[market], ...summarizeDC(records, pins) };
  }
  return { ok: true, market, nome: MARKETS[market], ...summarizeMarket(records) };
}

/** Doppia chance (18/11/2026): Pinnacle non la quota, quindi il prezzo giusto si ricava dal suo 1X2 salvato dalle scansioni
 *  (goal_watch): 1X = 1 + X, X2 = X + 2, 12 = 1 + 2, con le probabilita' senza margine. I nomi degli esiti cambiano da sito a sito. */
function dcKey(k) {
  const K = String(k).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (['1X', 'X1', 'HOMEDRAW', 'HOMEORDRAW', 'DRAWHOME'].includes(K)) return '1X';
  if (['X2', '2X', 'DRAWAWAY', 'DRAWORAWAY', 'AWAYDRAW'].includes(K)) return 'X2';
  if (['12', '21', 'HOMEAWAY', 'HOMEORAWAY', 'AWAYHOME', 'NODRAW'].includes(K)) return '12';
  return null;
}
function summarizeDC(records, pins, { minEdge = 2 } = {}) {
  const { noVigPower } = require('./sharpSignals');
  const edges = [], events = new Set(), withPin = new Set(), books = {}, keys = {}, unknown = {}, found = [];
  for (const r of records || []) {
    if ((r.scope || 'match') !== 'match' || (r.period || 'full_time') !== 'full_time' || (r.state || 'prematch') !== 'prematch') continue;
    events.add(r.event_id);
    const pin = pins.get(r.event_id); if (!pin) continue;
    const p = noVigPower({ home: Number(pin.pin_h), draw: Number(pin.pin_d), away: Number(pin.pin_a) });
    const fair = { '1X': p.home + p.draw, X2: p.draw + p.away, '12': p.home + p.away };
    withPin.add(r.event_id);
    for (const b of r.bookmakers || []) {
      if (!b.outcomes) continue;
      books[b.key] = (books[b.key] || 0) + 1;
      for (const [k, v] of Object.entries(b.outcomes)) {
        const K = dcKey(k), odd = Number(v);
        if (!K) { unknown[k] = (unknown[k] || 0) + 1; continue; }
        keys[K] = (keys[K] || 0) + 1;
        if (!(odd > 1)) continue;
        const e = (odd * fair[K] - 1) * 100; if (e > 25) continue;
        edges.push(e);
        if (e >= minEdge) found.push({ event: r.event_id, partita: `${r.home_team || '?'} – ${r.away_team || '?'}`, lega: r.league || null, linea: null, esito: K, sito: b.key, quota: odd, edgePct: Math.round(e * 10) / 10 });
      }
    }
  }
  edges.sort((a, b) => a - b);
  const q = f => (edges.length ? Math.round(edges[Math.min(edges.length - 1, Math.floor(f * edges.length))] * 10) / 10 : null);
  found.sort((a, b) => b.edgePct - a.edgePct);
  return { righe: (records || []).length, partite: events.size, partiteConPinnacle: withPin.size, quote: edges.length, esiti: keys, esitiSconosciuti: unknown, siti: books,
    vantaggioMediano: q(0.5), vantaggio90: q(0.9), conVantaggio: found.length, partiteConVantaggio: new Set(found.map(f => f.event)).size,
    quotaConVantaggioPct: edges.length ? Math.round(1000 * found.length / edges.length) / 10 : null, esempi: found.slice(0, 5), prezzoGiusto: '1X2 di Pinnacle salvato dalle scansioni' };
}

module.exports = { MARKETS, summarizeMarket, summarizeDC, dcKey, marketCheck };
