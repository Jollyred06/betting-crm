/**
 * Strategia A dal vivo ("quote contro il bookmaker piu' preciso"), funzioni PURE.
 * Riferimento di prezzo onesto = Pinnacle (o, se manca, una exchange), margine tolto in proporzione.
 * Si segnala l'esito dove la MIGLIORE quota tra i bookmaker "morbidi" supera la probabilita' onesta
 * di almeno minEdge (e al massimo maxEdge: sopra, quasi sempre e' una quota sbagliata o scaduta).
 * NOTA: nel backtest la strategia usava le quote di Bet365; qui Bet365 non e' disponibile, quindi
 * si usa la quota migliore tra tutti i bookmaker europei: e' una variante, non la stessa cosa.
 */
const SHARP = ['pinnacle'];
const isExchange = key => /^(betfair_ex|matchbook|smarkets|betopenly)/.test(key);
const MIN_SOFT_BOOKS = 3;

function h2h(book, event) {
  const m = (book.markets || []).find(x => x.key === 'h2h');
  if (!m) return null;
  const p = {};
  for (const o of m.outcomes || []) {
    const n = String(o.name).toLowerCase();
    if (o.name === event.home_team) p.home = o.price;
    else if (o.name === event.away_team) p.away = o.price;
    else if (n === 'draw') p.draw = o.price;
  }
  return p.home > 1 && p.draw > 1 && p.away > 1 ? p : null;
}

function noVig(p) {
  const inv = { home: 1 / p.home, draw: 1 / p.draw, away: 1 / p.away };
  const s = inv.home + inv.draw + inv.away;
  return { home: inv.home / s, draw: inv.draw / s, away: inv.away / s };
}

/** Riferimento onesto dell'evento: Pinnacle se presente, altrimenti la prima exchange. */
function sharpReference(event) {
  const books = event.bookmakers || [];
  for (const key of SHARP) {
    const b = books.find(x => x.key === key); const p = b && h2h(b, event);
    if (p) return { source: key, fair: noVig(p), odds: p };
  }
  const ex = books.find(x => isExchange(x.key) && h2h(x, event));
  return ex ? { source: ex.key, fair: noVig(h2h(ex, event)), odds: h2h(ex, event) } : null;
}

function analyzeEvent(event, { minEdge = 0.03, maxEdge = 0.15 } = {}) {
  const ref = sharpReference(event);
  if (!ref) return { ok: false, reason: 'nessun riferimento Pinnacle/exchange' };
  const best = {}, count = { home: 0, draw: 0, away: 0 }, all = { home: [], draw: [], away: [] };
  for (const b of event.bookmakers || []) {
    if (SHARP.includes(b.key) || isExchange(b.key)) continue;
    const p = h2h(b, event); if (!p) continue;
    for (const sel of ['home', 'draw', 'away']) {
      count[sel]++; all[sel].push({ bookmaker: b.title || b.key, odd: p[sel] });
      if (!best[sel] || p[sel] > best[sel].odd) best[sel] = { odd: p[sel], bookmaker: b.title || b.key };
    }
  }
  const candidates = [];
  let top = null;   // il vantaggio piu' alto della partita, anche se sotto soglia (solo per il Log)
  for (const sel of ['home', 'draw', 'away']) {
    if (!best[sel] || count[sel] < MIN_SOFT_BOOKS) continue;
    const edge = best[sel].odd * ref.fair[sel] - 1;
    if (!top || edge > top.edge) top = { selection: sel, edge, odd: best[sel].odd, bookmaker: best[sel].bookmaker, fair: ref.fair[sel] };
    if (edge >= minEdge && edge <= maxEdge) {
      // quote complete al momento del segnale: servono a capire se la quota migliore era davvero ottenibile (non un'unica quota fuori linea)
      const quotes = all[sel].slice().sort((x, y) => y.odd - x.odd), odds = quotes.map(q => q.odd), mid = Math.floor(odds.length / 2);
      const median = odds.length % 2 ? odds[mid] : (odds[mid - 1] + odds[mid]) / 2;
      candidates.push({ selection: sel, odd: best[sel].odd, bookmaker: best[sel].bookmaker, fair: ref.fair[sel], edge,
        quotes: quotes.slice(0, 12), nBooks: count[sel], nNear: odds.filter(o => o >= best[sel].odd * 0.97).length, medianOdd: Math.round(median * 1000) / 1000, sharpOdd: ref.odds ? ref.odds[sel] : null });
    }
  }
  return { ok: true, source: ref.source, fair: ref.fair, candidates, top, softBooks: Math.max(count.home, count.draw, count.away) };
}

module.exports = { analyzeEvent, sharpReference, noVig, h2h, MIN_SOFT_BOOKS };
