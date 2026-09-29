/**
 * Funzioni PURE per quote e selezione dei segnali (nessun database, testabili da sole).
 */

function updateBestOdd(odds, bookmakerBySelection, market, selection, price, bookmakerTitle) {
  odds[market] = odds[market] || {};
  bookmakerBySelection[market] = bookmakerBySelection[market] || {};
  if (!odds[market][selection] || price > odds[market][selection]) {
    odds[market][selection] = price;
    bookmakerBySelection[market][selection] = bookmakerTitle;
  }
}

/**
 * Da un evento di The Odds API ricava, per ogni esito, la quota più alta tra tutti i
 * bookmaker. Solo i mercati che abbiamo potuto validare col backtest:
 * 1X2 e Over/Under 2.5 (BTTS, Over/Under 1.5 e doppia chance NON sono nei dati storici).
 */
function parseBestOdds(event) {
  const odds = {}, bookmakerBySelection = {};
  if (!event || !event.bookmakers) return { odds, bookmakerBySelection };
  for (const bookmaker of event.bookmakers) {
    for (const market of bookmaker.markets || []) {
      if (market.key === 'h2h') {
        for (const o of market.outcomes) {
          const sel = o.name === event.home_team ? 'home'
            : o.name === event.away_team ? 'away'
            : String(o.name).toLowerCase() === 'draw' ? 'draw' : null;
          if (sel) updateBestOdd(odds, bookmakerBySelection, '1X2', sel, o.price, bookmaker.title);
        }
      } else if (market.key === 'totals') {
        for (const o of market.outcomes) {
          if (o.point !== 2.5) continue;
          const n = String(o.name).toLowerCase();
          const sel = n === 'over' ? 'over' : n === 'under' ? 'under' : null;
          if (sel) updateBestOdd(odds, bookmakerBySelection, 'OU_2.5', sel, o.price, bookmaker.title);
        }
      }
    }
  }
  return { odds, bookmakerBySelection };
}

/** Candidati: esiti in cui il modello vede un vantaggio compreso tra minEdge e maxEdge. */
function findCandidates(pred, odds, minEdge, maxEdge) {
  const probs = {
    '1X2': { home: pred.home, draw: pred.draw, away: pred.away },
    'OU_2.5': { over: pred.over25, under: pred.under25 }
  };
  const out = [];
  for (const market of Object.keys(probs)) {
    for (const selection of Object.keys(probs[market])) {
      const odd = odds[market]?.[selection];
      if (!odd) continue;
      const p = probs[market][selection];
      const edge = p * odd - 1;
      // Sopra maxEdge scartiamo: nei test i "vantaggi" grandi erano quasi sempre errori del modello o quote anomale.
      if (edge >= minEdge && edge <= maxEdge) out.push({ market, selection, odd, p, edge });
    }
  }
  return out;
}

/**
 * Protezioni giornaliere: massimo N segnali e tetto di esposizione totale.
 * Ordine: prima i segnali con vantaggio più piccolo (più vicini al mercato), perché nei test
 * i vantaggi più grandi rendevano PEGGIO. È una scelta prudente, non una promessa di rendimento.
 */
function selectDailySignals(candidates, bankroll, kellyStake, { maxSignals, maxExposurePct }) {
  const sorted = [...candidates].sort((a, b) => a.edge - b.edge);
  const cap = bankroll * maxExposurePct;
  const chosen = [], skipped = [];
  let exposure = 0;
  for (const c of sorted) {
    if (chosen.length >= maxSignals) { skipped.push({ ...c, reason: 'limite segnali giornalieri' }); continue; }
    const stake = kellyStake(c.odd, c.p, bankroll);
    if (stake <= 0) { skipped.push({ ...c, reason: 'stake nullo' }); continue; }
    if (exposure + stake > cap) { skipped.push({ ...c, reason: 'tetto di esposizione giornaliera' }); continue; }
    chosen.push({ ...c, stake });
    exposure += stake;
  }
  return { chosen, skipped, exposure, cap };
}

module.exports = { parseBestOdds, findCandidates, selectDailySignals };
