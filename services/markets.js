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
  const records = await I.fetchOdds(pool, c, { market, content: 'match', limit: 3000, bookmakers: [...new Set(['pinnacle', ...c.books, ...c.myBooks])].join(','),
    commence_from: new Date(nowMs + 15 * 60000).toISOString(), commence_to: new Date(nowMs + 24 * 3600000).toISOString() }, 'market_check', http);
  return { ok: true, market, nome: MARKETS[market], ...summarizeMarket(records) };
}

module.exports = { MARKETS, summarizeMarket, marketCheck };
