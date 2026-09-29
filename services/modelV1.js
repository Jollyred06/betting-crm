/**
 * MODELLO V1 — quello validato col backtest (Serie A 2022/23-2025/26).
 *
 * Idea: Poisson con forza di attacco/difesa di ogni squadra calcolata sulle ultime
 * 60 partite (qualsiasi campo), "ristretta" verso la media di lega (k = 6) perché
 * poche partite non bastano per fidarsi di un dato, più la correzione di Dixon-Coles
 * per i punteggi bassi (rho = -0.15). Sostituisce il vecchio modello (valueEngine.js),
 * che nei test aveva probabilità troppo sicure e a volte non normalizzate.
 *
 * Parametri scelti SOLO sulle stagioni di sviluppo (2022/23-2024/25); la stagione
 * 2025/26 è stata vista una volta sola. Risultato onesto: probabilità ben calibrate,
 * ma nessun vantaggio dimostrato sul mercato. Vedi backtest_serieA_report.md.
 *
 * Funzioni PURE (nessun database): `matches` è una lista in ordine cronologico di
 * { date: 'YYYY-MM-DD', home, away, hg, ag }.
 */
const N = 60;             // partite recenti per squadra
const K = 6;              // "ristrettezza" verso la media di lega
const RHO = -0.15;        // correzione punteggi bassi (Dixon-Coles)
const LEAGUE_WINDOW = 380; // partite per calcolare le medie gol di lega
const MAXG = 10;

function lowerBound(matches, dateStr) {
  let lo = 0, hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (matches[mid].date < dateStr) lo = mid + 1; else hi = mid;
  }
  return lo; // primo indice con date >= dateStr
}

function daysBetween(a, b) {
  return (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000;
}

/** Costruisce il contesto per una partita usando SOLO partite strettamente precedenti alla data. */
function buildContext(matches, homeName, awayName, dateStr) {
  const end = lowerBound(matches, dateStr);
  const lh = matches.slice(Math.max(0, end - LEAGUE_WINDOW), end);
  let sh = 0, sa = 0;
  for (const m of lh) { sh += m.hg; sa += m.ag; }
  const mu_h = lh.length ? sh / lh.length : 1.5;
  const mu_a = lh.length ? sa / lh.length : 1.2;

  function teamHistory(team) {
    const hist = [];      // [gol fatti, gol subiti], dalla più recente
    let recent = 0;       // partite negli ultimi 400 giorni (per la copertura minima)
    for (let i = end - 1; i >= 0 && hist.length < N; i--) {
      const m = matches[i];
      if (m.home === team) hist.push([m.hg, m.ag]);
      else if (m.away === team) hist.push([m.ag, m.hg]);
      else continue;
      if (daysBetween(m.date, dateStr) <= 400) recent++;
    }
    return { hist, recent };
  }
  const h = teamHistory(homeName), a = teamHistory(awayName);
  return { hh: h.hist, aa: a.hist, mu_h, mu_a, recentHome: h.recent, recentAway: a.recent };
}

function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function pmf(k, lambda) { return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k); }

function strength(hist, mu) {
  const h = hist.slice(0, N);
  const n = h.length;
  let gf = 0, ga = 0;
  for (const x of h) { gf += x[0]; ga += x[1]; }
  return { att: (gf + K * mu) / ((n + K) * mu), def: (ga + K * mu) / ((n + K) * mu) };
}

/** Probabilità 1X2 e Over/Under 2.5 + gol attesi. */
function predict(ctx) {
  const mu = (ctx.mu_h + ctx.mu_a) / 2;
  const sh = strength(ctx.hh, mu), sa = strength(ctx.aa, mu);
  const hxg = ctx.mu_h * sh.att * sa.def;
  const axg = ctx.mu_a * sa.att * sh.def;

  const ph = [], pa = [];
  for (let g = 0; g <= MAXG; g++) { ph.push(pmf(g, hxg)); pa.push(pmf(g, axg)); }
  const M = [];
  for (let h = 0; h <= MAXG; h++) {
    M.push([]);
    for (let a = 0; a <= MAXG; a++) M[h].push(ph[h] * pa[a]);
  }
  M[0][0] *= 1 - hxg * axg * RHO;
  M[0][1] *= 1 + hxg * RHO;
  M[1][0] *= 1 + axg * RHO;
  M[1][1] *= 1 - RHO;
  let total = 0;
  for (let h = 0; h <= MAXG; h++) for (let a = 0; a <= MAXG; a++) { if (M[h][a] < 0) M[h][a] = 0; total += M[h][a]; }

  let home = 0, draw = 0, away = 0, over = 0;
  for (let h = 0; h <= MAXG; h++) {
    for (let a = 0; a <= MAXG; a++) {
      const p = M[h][a] / total;
      if (h > a) home += p; else if (h === a) draw += p; else away += p;
      if (h + a > 2.5) over += p;
    }
  }
  return { home, draw, away, over25: over, under25: 1 - over, hxg, axg };
}

module.exports = { buildContext, predict, N, K, RHO, LEAGUE_WINDOW };
