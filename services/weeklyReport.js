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
  return {
    signals: bets.length, settled: settled.length, pending: bets.filter(b => b.status === 'pending').length,
    hitRatePct: settled.length ? (settled.filter(b => b.status === 'won').length / settled.length) * 100 : null,
    roiFlatPct: profits.length ? mean(profits) * 100 : null,
    avgOdd: mean(bets.map(b => Number(b.odd))), avgEdgePct: mean(bets.map(b => Number(b.edge_pct))),
    avgClvPct: mean(clvs), nClv: clvs.length, clvCi95: clvCi
  };
}

const f = (v, d = 1, sign = false) => (v === null || v === undefined ? '—' : (sign && v >= 0 ? '+' : '') + Number(v).toFixed(d));

function formatReport(week, total) {
  const line = (t, s) => `${t}: ${s.signals} segnali (${s.settled} chiusi, ${s.pending} in attesa) | vinte ${f(s.hitRatePct)}% | ROI a puntata fissa ${f(s.roiFlatPct, 1, true)}% | valore medio vs chiusura ${f(s.avgClvPct, 2, true)}% su ${s.nClv}`;
  let txt = `📊 Riepilogo settimanale (tracker, senza soldi veri)\n${line('Ultimi 7 giorni', week)}\n${line('Da inizio tracciamento', total)}`;
  if (total.clvCi95) txt += `\nValore vs chiusura, intervallo 95%: da ${f(total.clvCi95[0], 2, true)}% a ${f(total.clvCi95[1], 2, true)}%`;
  txt += '\n\nLettura: un vantaggio vero si vede se il valore vs chiusura e\' positivo con intervallo sopra lo zero. ' +
    (total.nClv < 300 ? `Servono circa 300 segnali chiusi: ora ${total.nClv}. Prima non e' una prova.` : 'Il campione e\' sufficiente per una prima lettura.');
  return txt;
}

async function loadBets(pool, sinceDays) {
  const { rows } = await pool.query(
    `SELECT bookmaker_odd AS odd, status, edge_pct, clv_pct FROM value_bets
     WHERE strategy = 'A_sharp' ${sinceDays ? `AND created_at >= NOW() - INTERVAL '${Number(sinceDays)} days'` : ''}`);
  return rows;
}

async function buildStats(pool) {
  const week = summarize(await loadBets(pool, 7)), total = summarize(await loadBets(pool, null));
  return { week, total, text: formatReport(week, total) };
}

module.exports = { summarize, formatReport, buildStats };
