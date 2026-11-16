/**
 * 🧪 PROVA DEL METODO SULLO STORICO (17 novembre 2026). Domanda: "se avessi giocato ogni volta che un bookmaker pagava piu'
 * del giusto secondo Pinnacle, su 14 stagioni, quanto avrei guadagnato?". Usa lo storico di football-data.co.uk:
 * Pinnacle senza margine come probabilita' vera, e la quota piu' alta tra i bookmaker (o la media) come prezzo giocato.
 * Limiti onesti: sono bookmaker internazionali, non i siti italiani; la quota massima a volte e' di siti con limiti bassi;
 * le quote sono quasi sempre di chiusura (piu' difficili da battere delle nostre, prese ore prima). Solo misura.
 */
const { noVigPower } = require('./sharpSignals');
const SELS = ['home', 'draw', 'away'];
const ODD_BANDS = [[1, 1.6], [1.6, 2], [2, 2.5], [2.5, 3], [3, 3.5], [3.5, 5], [5, 1000]];
const EDGE_BANDS = [[-100, 0], [0, 2], [2, 4], [4, 8], [8, 1000]];
const lab = ([a, b]) => (b >= 1000 ? `${String(a).replace('.', ',')} e oltre` : `${String(a).replace('.', ',')}–${String(b).replace('.', ',')}`);

const seasonOf = d => { const s = (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10), y = +s.slice(0, 4), m = +s.slice(5, 7), st = m >= 7 ? y : y - 1; return `${st}/${String((st + 1) % 100).padStart(2, '0')}`; };
const acc = () => ({ n: 0, won: 0, exp: 0, pnl: 0 });
const add = (t, win, p, odd) => { t.n++; t.won += win; t.exp += p; t.pnl += win ? odd - 1 : -1; };
const fin = t => ({ n: t.n, won: t.won, expected: Math.round(t.exp * 10) / 10, roiPct: t.n ? Math.round(1000 * t.pnl / t.n) / 10 : null, z: t.n ? Math.round(100 * (t.won - t.exp) / Math.sqrt(Math.max(1e-9, t.exp * (1 - t.exp / t.n)))) / 100 : null });

/** Parte pura. rows: {match_date, league, hg, ag, ph, pd, pa, mh, md, ma, ah, ad, aa}. */
function backtest(rows, { minEdge = 2, minOdd = 2, maxOdd = 3.5, maxMargin = 6 } = {}) {
  const rule = acc(), ruleAvg = acc(), all = acc(), byOdd = new Map(), byEdge = new Map(), bySeason = new Map(), byLeague = new Map();
  let matches = 0;
  for (const r of rows) {
    const pin = { home: Number(r.ph), draw: Number(r.pd), away: Number(r.pa) }, mx = { home: Number(r.mh), draw: Number(r.md), away: Number(r.ma) }, av = { home: Number(r.ah), draw: Number(r.ad), away: Number(r.aa) };
    if (!SELS.every(k => pin[k] > 1 && mx[k] > 1)) continue;
    matches++;
    const fair = noVigPower(pin), margin = (1 / pin.home + 1 / pin.draw + 1 / pin.away - 1) * 100;
    const hg = Number(r.hg), ag = Number(r.ag), out = hg > ag ? 'home' : hg === ag ? 'draw' : 'away';
    for (const k of SELS) {
      const p = fair[k], odd = mx[k], edge = (odd * p - 1) * 100, win = out === k ? 1 : 0;
      if (edge > 25) continue;   // quasi sempre un errore di lettura nel file
      add(all, win, p, odd);
      const eb = EDGE_BANDS.find(([a, b]) => edge >= a && edge < b); if (eb) { const key = lab(eb); if (!byEdge.has(key)) byEdge.set(key, acc()); add(byEdge.get(key), win, p, odd); }
      if (edge < minEdge) continue;
      const ob = ODD_BANDS.find(([a, b]) => odd >= a && odd < b); if (ob) { const key = lab(ob); if (!byOdd.has(key)) byOdd.set(key, acc()); add(byOdd.get(key), win, p, odd); }
      if (odd < minOdd || odd > maxOdd || margin >= maxMargin) continue;
      add(rule, win, p, odd);
      if (av[k] > 1) add(ruleAvg, win, p, av[k]);
      const se = seasonOf(r.match_date); if (!bySeason.has(se)) bySeason.set(se, acc()); add(bySeason.get(se), win, p, odd);
      if (!byLeague.has(r.league)) byLeague.set(r.league, acc()); add(byLeague.get(r.league), win, p, odd);
    }
  }
  const list = m => [...m.entries()].map(([k, v]) => ({ group: k, ...fin(v) }));
  return {
    rules: { minEdge, minOdd, maxOdd, maxMargin }, matches,
    rule: fin(rule), ruleAtAverage: fin(ruleAvg), everything: fin(all),
    byEdge: list(byEdge), byOdd: list(byOdd).sort((a, b) => parseFloat(a.group.replace(',', '.')) - parseFloat(b.group.replace(',', '.'))),
    bySeason: list(bySeason).sort((a, b) => a.group.localeCompare(b.group)), byLeague: list(byLeague).sort((a, b) => b.n - a.n)
  };
}

/** Calcolata una volta e salvata (calib_state 'backtest'); si rifa' dopo l'aggiornamento dello storico. */
const BT_VERSION = 2;   // cambia quando cambia il calcolo: il risultato salvato si rifa' da solo
async function getBacktest(pool, { force = false } = {}) {
  const C = require('./calib'); await C.ensureCalib(pool);
  if (!force) { const sv = await C.loadState(pool, 'backtest').catch(() => null); if (sv && sv.version === BT_VERSION && !C.isRunning()) return sv; }
  const rows = (await pool.query(`SELECT match_date, league, hg, ag, ph, pd, pa, mh, md, ma, ah, ad, aa FROM hist_pin WHERE ph IS NOT NULL AND mh IS NOT NULL`)).rows;
  const val = { ...backtest(rows), version: BT_VERSION, updatedAt: new Date().toISOString() };
  if (val.matches && !C.isRunning()) await C.saveState(pool, 'backtest', val);   // a scarico in corso non si salva un risultato parziale
  return val;
}

module.exports = { backtest, getBacktest, seasonOf };
