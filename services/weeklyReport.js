/** Riepilogo dei segnali della strategia A: numeri, ROI a puntata fissa e valore rispetto alla chiusura. */
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

function summarize(bets) {
  const settled = bets.filter(b => b.status === 'won' || b.status === 'lost');
  const profits = settled.map(b => (b.status === 'won' ? Number(b.odd) - 1 : -1));
  const clvs = bets.map(b => b.clv_pct).filter(v => v !== null && v !== undefined).map(Number);
  let clvCi = null;
  if (clvs.length >= 20) {
    const m = mean(clvs), sd = Math.sqrt(clvs.reduce((s, x) => s + (x - m) ** 2, 0) / (clvs.length - 1));
    clvCi = [m - 1.96 * sd / Math.sqrt(clvs.length), m + 1.96 * sd / Math.sqrt(clvs.length)];
  }
  // cattura = quanta parte dello spazio tra Pinnacle (pre) e il massimo del mercato ha preso la quota presa: (presa - pin) / (max - pin)
  const caps = bets.map(b => { const o = Number(b.odd), pin = Number(b.pin_pre), mx = Number(b.max_odd); return pin > 1 && mx > pin ? (o - pin) / (mx - pin) : null; })
    .filter(v => v !== null && Number.isFinite(v));
  return {
    captureAvgPct: caps.length ? mean(caps) * 100 : null, nCapture: caps.length,
    signals: bets.length, settled: settled.length, pending: bets.filter(b => b.status === 'pending').length,
    hitRatePct: settled.length ? (settled.filter(b => b.status === 'won').length / settled.length) * 100 : null,
    roiFlatPct: profits.length ? mean(profits) * 100 : null,
    avgOdd: mean(bets.map(b => Number(b.odd))), avgEdgePct: mean(bets.map(b => Number(b.edge_pct))),
    avgClvPct: mean(clvs), nClv: clvs.length, clvCi95: clvCi
  };
}

const f = (v, d = 1, sign = false) => (v === null || v === undefined ? '—' : (sign && v >= 0 ? '+' : '') + Number(v).toFixed(d));

function formatReport(week, total, strong) {
  const line = (t, s) => `${t}: ${s.signals} segnali (${s.settled} chiusi, ${s.pending} in attesa) | vinte ${f(s.hitRatePct)}% | ROI a puntata fissa ${f(s.roiFlatPct, 1, true)}% | CLV medio (chiusura Pinnacle) ${f(s.avgClvPct, 2, true)}% su ${s.nClv} | cattura media ${f(s.captureAvgPct, 0)}% su ${s.nCapture}`;
  let txt = `📊 Riepilogo settimanale (tracker, senza soldi veri)\n${line('Ultimi 7 giorni', week)}\n${line('Da inizio tracciamento', total)}`;
  if (strong && strong.signals && strong.signals !== total.signals) txt += `\n${line('Solo vantaggio >= 3%', strong)}`;
  if (total.clvCi95) txt += `\nValore vs chiusura, intervallo 95%: da ${f(total.clvCi95[0], 2, true)}% a ${f(total.clvCi95[1], 2, true)}%`;
  txt += '\n\nLettura: un vantaggio vero si vede se il valore vs chiusura è positivo con intervallo sopra lo zero. ' +
    (total.nClv < 300 ? `Servono circa 300 segnali chiusi: ora ${total.nClv}. Prima non è una prova.` : 'Il campione è sufficiente per una prima lettura.');
  return txt;
}

async function loadBets(pool, sinceDays) {
  const where = `WHERE strategy = 'A_sharp' ${sinceDays ? `AND created_at >= NOW() - INTERVAL '${Number(sinceDays)} days'` : ''}`;
  try {   // quota presa, Pinnacle pre, massimo e CLV contro la chiusura Pinnacle (solo quello conta nel CLV del riepilogo)
    const { rows } = await pool.query(
      `SELECT COALESCE(quota_presa, bookmaker_odd) AS odd, status, edge_pct, CASE WHEN clv_source = 'pinnacle' THEN clv_pct END AS clv_pct,
              sharp_odd AS pin_pre, quota_max AS max_odd FROM value_bets ${where}`);
    return rows;
  } catch (e) {   // schema non ancora aggiornato: riepilogo come prima
    const { rows } = await pool.query(`SELECT bookmaker_odd AS odd, status, edge_pct, clv_pct FROM value_bets ${where}`);
    return rows;
  }
}

async function buildStats(pool) {
  const all = await loadBets(pool, null), recent = await loadBets(pool, 7);
  const week = summarize(recent), total = summarize(all);
  const strong = summarize(all.filter(b => Number(b.edge_pct) >= 3));      // i segnali "forti" (soglia originale 3%), per confronto se si abbassa la soglia
  return { week, total, strong, text: formatReport(week, total, strong) };
}

module.exports = { summarize, formatReport, buildStats };
