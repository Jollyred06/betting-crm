/**
 * Strategia A dal vivo ("quote contro il bookmaker piu' preciso"), funzioni PURE.
 * Riferimento di prezzo onesto = Pinnacle (o, se manca, una exchange), margine tolto con il metodo "power":
 * si cerca c tale che somma((1/quota)^c) = 1 e la probabilita' onesta e' (1/quota)^c.
 * Edge = quota_book * p_pinnacle_pre - 1, dove quota_book e' la MIGLIORE quota tra i bookmaker "morbidi".
 * Si segnala l'esito solo se l'edge sta tra minEdge e maxEdge (default 2% e 25%: sopra, quasi sempre e' una quota sbagliata o scaduta).
 * Per ogni segnale si restituiscono anche: la quota presa (quota_presa), la quota massima di tutto il mercato (quota_max),
 * la quota Pinnacle pre-partita e l'eventuale quota Goldbet se il bookmaker compare tra le quote.
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

/** Margine tolto in proporzione (metodo vecchio, tenuto per i confronti). */
function noVig(p) {
  const inv = { home: 1 / p.home, draw: 1 / p.draw, away: 1 / p.away };
  const s = inv.home + inv.draw + inv.away;
  return { home: inv.home / s, draw: inv.draw / s, away: inv.away / s };
}

/** Margine tolto con il metodo "power": trova c con somma((1/quota)^c) = 1. Rispetto al metodo proporzionale da' meno probabilita' alle quote alte. */
function noVigPower(p) {
  const q = [1 / p.home, 1 / p.draw, 1 / p.away];
  if (q[0] + q[1] + q[2] <= 1) return noVig(p);          // nessun margine (o negativo): niente da togliere in questo modo
  let lo = 1, hi = 30;
  for (let i = 0; i < 100; i++) {
    const c = (lo + hi) / 2, s = q[0] ** c + q[1] ** c + q[2] ** c;
    if (s > 1) lo = c; else hi = c;
  }
  const c = (lo + hi) / 2, r = q.map(x => x ** c), s = r[0] + r[1] + r[2];
  return { home: r[0] / s, draw: r[1] / s, away: r[2] / s };
}

/** Riferimento onesto dell'evento: Pinnacle se presente, altrimenti la prima exchange. */
function sharpReference(event) {
  const books = event.bookmakers || [];
  for (const key of SHARP) {
    const b = books.find(x => x.key === key); const p = b && h2h(b, event);
    if (p) return { source: key, fair: noVigPower(p), odds: p };
  }
  const ex = books.find(x => isExchange(x.key) && h2h(x, event));
  return ex ? { source: ex.key, fair: noVigPower(h2h(ex, event)), odds: h2h(ex, event) } : null;
}

/** Quota "presa": se BOOK_PRESA elenca i tuoi bookmaker (nomi anche parziali, es. "goldbet,codere") e uno ha la quota, si usa la migliore tra quelli; altrimenti la migliore in assoluto. */
function pickPresa(quotes, best) {
  const prefs = (process.env.BOOK_PRESA || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  for (const pref of prefs) {
    const hit = quotes.find(q => String(q.bookmaker).toLowerCase().includes(pref));   // quotes e' ordinata dalla migliore
    if (hit) return hit;
  }
  return best;
}

function analyzeEvent(event, { minEdge = 0.02, maxEdge = 0.25 } = {}) {
  const ref = sharpReference(event);
  if (!ref) return { ok: false, reason: 'nessun riferimento Pinnacle/exchange' };
  const best = {}, count = { home: 0, draw: 0, away: 0 }, all = { home: [], draw: [], away: [] }, maxAll = {};
  for (const b of event.bookmakers || []) {
    const p = h2h(b, event); if (!p) continue;
    for (const sel of ['home', 'draw', 'away'])                 // massimo di TUTTO il mercato (anche Pinnacle ed exchange)
      if (!maxAll[sel] || p[sel] > maxAll[sel].odd) maxAll[sel] = { odd: p[sel], bookmaker: b.title || b.key };
    if (SHARP.includes(b.key) || isExchange(b.key)) continue;
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
      // quote di TUTTI i bookmaker al momento del segnale: servono a capire se la quota migliore era davvero ottenibile (non un'unica quota fuori linea)
      const quotes = all[sel].slice().sort((x, y) => y.odd - x.odd), odds = quotes.map(q => q.odd), mid = Math.floor(odds.length / 2);
      const median = odds.length % 2 ? odds[mid] : (odds[mid - 1] + odds[mid]) / 2;
      const presa = pickPresa(quotes, best[sel]), gold = quotes.find(q => /goldbet/i.test(q.bookmaker));
      candidates.push({ selection: sel, odd: best[sel].odd, bookmaker: best[sel].bookmaker, fair: ref.fair[sel], edge,
        quotes, nBooks: count[sel], nNear: odds.filter(o => o >= best[sel].odd * 0.97).length, medianOdd: Math.round(median * 1000) / 1000,
        sharpOdd: ref.odds ? ref.odds[sel] : null, sharpOdds: ref.odds || null,
        presaOdd: presa.odd, presaBook: presa.bookmaker ?? null, maxOdd: maxAll[sel].odd, maxBook: maxAll[sel].bookmaker, goldbetOdd: gold ? gold.odd : null });
    }
  }
  return { ok: true, source: ref.source, fair: ref.fair, candidates, top, softBooks: Math.max(count.home, count.draw, count.away) };
}

/* ===== Over/Under (mercato "totals" di The Odds API), una sola linea per volta (default 2,5) =====
 * Stessa idea dell'1X2 ma a 2 esiti: riferimento Pinnacle senza margine (power), edge = quota * p_pinnacle - 1.
 * I segnali hanno strategy 'A_sharp_ou' e market 'OU2.5': cosi' non si mescolano con l'1X2 in nessuna statistica. */
const OU_LINE = parseFloat(process.env.OU_LINE || '2.5');

function ou(book, line = OU_LINE) {
  const m = (book.markets || []).find(x => x.key === 'totals');
  if (!m) return null;
  const p = {};
  for (const o of m.outcomes || []) {
    if (Number(o.point) !== line) continue;                       // ogni bookmaker puo' avere linee diverse: conta solo quella scelta
    const n = String(o.name).toLowerCase();
    if (n === 'over') p.over = o.price; else if (n === 'under') p.under = o.price;
  }
  return p.over > 1 && p.under > 1 ? p : null;
}

/** Margine tolto con il metodo "power" a 2 esiti: trova c con (1/over)^c + (1/under)^c = 1. */
function noVigPower2(p) {
  const q = [1 / p.over, 1 / p.under];
  if (q[0] + q[1] <= 1) { const s = q[0] + q[1]; return { over: q[0] / s, under: q[1] / s }; }
  let lo = 1, hi = 30;
  for (let i = 0; i < 100; i++) { const c = (lo + hi) / 2; if (q[0] ** c + q[1] ** c > 1) lo = c; else hi = c; }
  const c = (lo + hi) / 2, r = [q[0] ** c, q[1] ** c], s = r[0] + r[1];
  return { over: r[0] / s, under: r[1] / s };
}

function analyzeTotals(event, { minEdge = 0.02, maxEdge = 0.25, line = OU_LINE } = {}) {
  const books = event.bookmakers || [];
  const pin = books.find(x => x.key === 'pinnacle'), pp = pin && ou(pin, line);
  if (!pp) return { ok: false, reason: `nessuna quota Pinnacle Over/Under ${line}` };
  const fair = noVigPower2(pp);
  const best = {}, all = { over: [], under: [] }, maxAll = {};
  for (const b of books) {
    const p = ou(b, line); if (!p) continue;
    for (const sel of ['over', 'under']) {
      if (!maxAll[sel] || p[sel] > maxAll[sel].odd) maxAll[sel] = { odd: p[sel], bookmaker: b.title || b.key };
      if (SHARP.includes(b.key) || isExchange(b.key)) continue;
      all[sel].push({ bookmaker: b.title || b.key, odd: p[sel] });
      if (!best[sel] || p[sel] > best[sel].odd) best[sel] = { odd: p[sel], bookmaker: b.title || b.key };
    }
  }
  const candidates = [];
  for (const sel of ['over', 'under']) {
    if (!best[sel] || all[sel].length < MIN_SOFT_BOOKS) continue;
    const edge = best[sel].odd * fair[sel] - 1;
    if (edge < minEdge || edge > maxEdge) continue;
    const quotes = all[sel].slice().sort((x, y) => y.odd - x.odd), odds = quotes.map(q => q.odd), mid = Math.floor(odds.length / 2);
    const median = odds.length % 2 ? odds[mid] : (odds[mid - 1] + odds[mid]) / 2;
    const presa = pickPresa(quotes, best[sel]), gold = quotes.find(q => /goldbet/i.test(q.bookmaker));
    candidates.push({ market: `OU${line}`, strategy: 'A_sharp_ou', selection: sel, odd: best[sel].odd, bookmaker: best[sel].bookmaker, fair: fair[sel], edge,
      quotes, nBooks: quotes.length, nNear: odds.filter(o => o >= best[sel].odd * 0.97).length, medianOdd: Math.round(median * 1000) / 1000,
      sharpOdd: pp[sel], sharpOdds: pp, presaOdd: presa.odd, presaBook: presa.bookmaker ?? null,
      maxOdd: maxAll[sel].odd, maxBook: maxAll[sel].bookmaker, goldbetOdd: gold ? gold.odd : null });
  }
  return { ok: true, fair, candidates };
}

module.exports = { analyzeEvent, sharpReference, noVig, noVigPower, h2h, pickPresa, MIN_SOFT_BOOKS, ou, noVigPower2, analyzeTotals, OU_LINE };
