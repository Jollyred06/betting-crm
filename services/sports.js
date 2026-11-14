/**
 * Prova di altri sport (14 novembre 2026): tennis e basket, solo a mano e solo sulla carta. Costa UNA richiesta odss.
 * Dice quante partite arrivano, quali siti le quotano, se c'e' Pinnacle come riferimento e quante hanno un prezzo migliore
 * di Pinnacle di almeno il 2% (senza margine, in modo semplice). Non salva nulla e non crea segnali.
 */
const SPORTS = ['tennis', 'basket'], MARKETS = ['moneyline', 'ou', 'ah', '1x2'];

/** Le due quote di un mercato a due esiti: HOME/AWAY, OVER/UNDER oppure i primi due esiti numerici. */
function twoWay(outcomes) {
  if (!outcomes) return null;
  const up = {}; for (const [k, v] of Object.entries(outcomes)) up[String(k).toUpperCase()] = Number(v);
  if (up.DRAW > 1 || up.X > 1) return null;   // mercato a tre esiti: non e' una partita a due
  const pairs = [['HOME', 'AWAY'], ['OVER', 'UNDER'], ['1', '2']];
  for (const [a, b] of pairs) if (up[a] > 1 && up[b] > 1) return { names: [a, b], odds: [up[a], up[b]] };
  const e = Object.entries(up).filter(([, v]) => v > 1);
  return e.length === 2 ? { names: [e[0][0], e[1][0]], odds: [e[0][1], e[1][1]] } : null;
}

/** Parte pura: riassume i record di odss. */
function summarizeSport(records, { minEdge = 2 } = {}) {
  const books = {}, events = new Set(), withPin = new Set(), margins = [], found = [];
  for (const r of records || []) {
    events.add(r.event_id);
    for (const b of r.bookmakers || []) books[b.key] = (books[b.key] || 0) + 1;
    const pin = (r.bookmakers || []).find(b => b.key === 'pinnacle'), pw = pin && twoWay(pin.outcomes);
    if (!pw) continue;
    withPin.add(r.event_id);
    const inv = pw.odds.map(o => 1 / o), s = inv[0] + inv[1]; margins.push((s - 1) * 100);
    const fair = inv.map(x => x / s);
    for (const b of r.bookmakers || []) {
      if (b.key === 'pinnacle') continue;
      const w = twoWay(b.outcomes); if (!w) continue;
      for (let i = 0; i < 2; i++) {
        const idx = w.names[i] === pw.names[0] ? 0 : w.names[i] === pw.names[1] ? 1 : -1; if (idx < 0) continue;
        const edge = (w.odds[i] * fair[idx] - 1) * 100;
        if (edge >= minEdge && edge <= 25) found.push({ event: r.event_id, partita: `${r.home_team || r.home || '?'} – ${r.away_team || r.away || '?'}`, lega: r.league || null, mercato: r.market || null, esito: w.names[i], sito: b.key, quota: w.odds[i], edgePct: Number(edge.toFixed(1)) });
      }
    }
  }
  found.sort((a, b) => b.edgePct - a.edgePct);
  margins.sort((a, b) => a - b);
  return { righe: (records || []).length, partite: events.size, partiteConPinnacle: withPin.size, siti: books,
    margineMedianoPinnacle: margins.length ? Number(margins[Math.floor(margins.length / 2)].toFixed(1)) : null,
    conVantaggio: new Set(found.map(f => f.event)).size, esempi: found.slice(0, 5) };
}

async function sportCheck(pool, { sport, market }, env = process.env, { http, nowMs = Date.now() } = {}) {
  if (!SPORTS.includes(sport)) return { ok: false, motivo: `sport non ammesso (${SPORTS.join(', ')})` };
  if (!MARKETS.includes(market)) return { ok: false, motivo: `mercato non ammesso (${MARKETS.join(', ')})` };
  const I = require('./italia'), c = I.cfg(env);
  if (!c.key) return { ok: false, motivo: 'ODSS_API_KEY non impostata' };
  // prova larga: nessun filtro su siti e orario, cosi' si vede cosa esiste davvero per quello sport e quel mercato
  const records = await I.fetchOdds(pool, c, { sport, market, content: 'match', limit: 200 }, 'sport_check', http);
  const mercati = {}; for (const r of records) mercati[r.market || '?'] = (mercati[r.market || '?'] || 0) + 1;
  return { ok: true, sport, market, mercati, campione: records[0] ? { chiavi: Object.keys(records[0]).slice(0, 15), inizio: records[0].commence_time || null } : null, ...summarizeSport(records) };
}

/** Elenco ufficiale di sport e mercati di odss (probabilmente gratis): mostra anche i crediti prima e dopo, cosi' si vede se costa. */
async function sportsList(pool, env = process.env, { http = require('axios') } = {}) {
  const I = require('./italia'), c = I.cfg(env);
  if (!c.key) return { ok: false, motivo: 'ODSS_API_KEY non impostata' };
  const before = await I.lastRemaining(pool).catch(() => null);
  const res = await http.get('https://odss-api.com/api/v1/sports', { headers: { 'x-api-key': c.key }, timeout: 30000 });
  const h = res.headers || {}, after = h['x-quota-remaining'] !== undefined ? Number(h['x-quota-remaining']) : null;
  return { ok: true, crediti: { prima: before, dopo: after }, elenco: JSON.stringify(res.data).slice(0, 1500) };
}

module.exports = { sportsList, SPORTS, MARKETS, twoWay, summarizeSport, sportCheck };
