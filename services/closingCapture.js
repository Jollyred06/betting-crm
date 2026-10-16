/**
 * Cattura della quota di CHIUSURA di Pinnacle per i segnali ancora in attesa, poco prima del calcio d'inizio.
 * Per ogni segnale: ultima quota Pinnacle 1X2 vista prima della partita -> probabilita' onesta (metodo power)
 * -> clv = quota_presa * p_pinnacle_chiusura - 1 (salvato in percentuale in clv_pct, con clv_source = 'pinnacle').
 * Costo: 1 credito di The Odds API per campionato con segnali in finestra (nessun credito se non ce ne sono).
 * Va chiamata ogni 10-30 minuti (POST /api/capture-closing, vedi .github/workflows/chiusura.yml): ogni segnale viene
 * catturato tra 0 e 45 minuti prima del calcio d'inizio e ricatturato se l'ultima cattura e' piu' vecchia di MIN_GAP_MIN:
 * vale l'ultima, la piu' vicina al calcio d'inizio (close_lag_min dice quanti minuti mancavano).
 */
const { h2h, noVigPower, ou, noVigPower2 } = require('./sharpSignals');

const WINDOW_MIN = 45;      // segnali con calcio d'inizio entro 45 minuti
const MIN_GAP_MIN = 20;     // non ricatturare lo stesso segnale se l'ultima cattura e' recente (ritardi del cron)

async function captureClosing(pool, oddsApi, { windowMin = WINDOW_MIN, minGapMin = MIN_GAP_MIN, now = Date.now() } = {}) {
  const out = { segnaliInFinestra: 0, catturate: 0, saltate: 0, chiamate: 0, errori: [] };
  const { rows } = await pool.query(
    `SELECT vb.id, vb.selection, vb.bookmaker_odd, vb.quota_presa, vb.league_code, vb.odds_event_id
     FROM value_bets vb JOIN fixtures f ON f.id = vb.fixture_id
     WHERE vb.strategy = 'A_sharp' AND vb.status = 'pending' AND vb.odds_event_id IS NOT NULL
       AND f.date > NOW() AND f.date <= NOW() + make_interval(mins => $1::int)
       AND (vb.close_captured_at IS NULL OR vb.close_captured_at < NOW() - make_interval(mins => $2::int))`,
    [windowMin, minGapMin]);
  out.segnaliInFinestra = rows.length;
  const byLeague = {};
  for (const r of rows) (byLeague[r.league_code] = byLeague[r.league_code] || []).push(r);

  for (const [code, sigs] of Object.entries(byLeague)) {
    let events;
    try { events = await oddsApi.getOddsForCompetition(code); out.chiamate++; }
    catch (err) { out.errori.push(`${code}: ${err.message}`); out.saltate += sigs.length; continue; }
    for (const s of sigs) {
      const ev = events.find(e => e.id === s.odds_event_id);
      const pin = ev && (ev.bookmakers || []).find(b => b.key === 'pinnacle');
      const p = pin && h2h(pin, ev);
      if (!p) { out.saltate++; continue; }                              // evento non piu' in elenco o senza Pinnacle: resta il ripiego sulla media di chiusura
      const fair = noVigPower(p)[s.selection];
      const presa = Number(s.quota_presa ?? s.bookmaker_odd);
      const clv = (presa * fair - 1) * 100;
      const lag = Math.max(0, Math.round((Date.parse(ev.commence_time) - now) / 60000));
      await pool.query(
        `UPDATE value_bets SET close_pin_h=$2, close_pin_d=$3, close_pin_a=$4, closing_fair_prob=$5, clv_pct=$6,
                clv_source='pinnacle', close_lag_min=$7, close_captured_at=NOW() WHERE id=$1`,
        [s.id, p.home, p.draw, p.away, fair, clv, lag]);
      out.catturate++;
    }
  }
  return out;
}

/**
 * Stessa cattura per i segnali Over/Under (strategy 'A_sharp_ou', market 'OU2.5'): chiusura Pinnacle sulla STESSA linea.
 * Se Pinnacle non ha piu' quella linea il segnale resta senza CLV (non si confronta con un'altra linea).
 * Salvataggio: close_pin_h = quota Over, close_pin_a = quota Under (close_pin_d resta vuoto).
 * Costo: 1 credito per campionato con segnali in finestra (solo mercato totals); nessun credito se non ce ne sono.
 */
async function captureClosingOU(pool, oddsApi, { windowMin = WINDOW_MIN, minGapMin = MIN_GAP_MIN, now = Date.now() } = {}) {
  const out = { segnaliInFinestra: 0, catturate: 0, saltate: 0, chiamate: 0, errori: [] };
  const { rows } = await pool.query(
    `SELECT vb.id, vb.market, vb.selection, vb.bookmaker_odd, vb.quota_presa, vb.league_code, vb.odds_event_id
     FROM value_bets vb JOIN fixtures f ON f.id = vb.fixture_id
     WHERE vb.strategy = 'A_sharp_ou' AND vb.status = 'pending' AND vb.odds_event_id IS NOT NULL
       AND f.date > NOW() AND f.date <= NOW() + make_interval(mins => $1::int)
       AND (vb.close_captured_at IS NULL OR vb.close_captured_at < NOW() - make_interval(mins => $2::int))`,
    [windowMin, minGapMin]);
  out.segnaliInFinestra = rows.length;
  const byLeague = {};
  for (const r of rows) (byLeague[r.league_code] = byLeague[r.league_code] || []).push(r);
  for (const [code, sigs] of Object.entries(byLeague)) {
    let events;
    try { events = await oddsApi.getOddsForCompetition(code, { markets: 'totals' }); out.chiamate++; }
    catch (err) { out.errori.push(`${code}: ${err.message}`); out.saltate += sigs.length; continue; }
    for (const s of sigs) {
      const ev = events.find(e => e.id === s.odds_event_id);
      const pin = ev && (ev.bookmakers || []).find(b => b.key === 'pinnacle');
      const line = parseFloat(String(s.market).slice(2));
      const p = pin && ou(pin, line);
      if (!p) { out.saltate++; continue; }
      const fair = noVigPower2(p)[s.selection];
      const presa = Number(s.quota_presa ?? s.bookmaker_odd);
      const clv = (presa * fair - 1) * 100;
      const lag = Math.max(0, Math.round((Date.parse(ev.commence_time) - now) / 60000));
      await pool.query(
        `UPDATE value_bets SET close_pin_h=$2, close_pin_a=$3, closing_fair_prob=$4, clv_pct=$5,
                clv_source='pinnacle', close_lag_min=$6, close_captured_at=NOW() WHERE id=$1`,
        [s.id, p.over, p.under, fair, clv, lag]);
      out.catturate++;
    }
  }
  return out;
}

module.exports = { captureClosing, captureClosingOU, WINDOW_MIN, MIN_GAP_MIN };
