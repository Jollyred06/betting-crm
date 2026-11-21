/**
 * 🎢 PROVA DELLA MARTINGALA SUI PAREGGI (21 novembre 2026, chiesta da Christian dopo un video: "puntava sempre sul pareggio,
 * tra le partite della stessa ora quella con la quota del pareggio piu' bassa, e dopo ogni pareggio mancato alzava la puntata").
 * Sullo storico (hist_pin, ~127.000 partite dal 2012 con le quote vere): ogni giorno UNA giocata, il pareggio con la quota piu'
 * bassa tra le partite di quel giorno (lo storico non ha l'ora, quindi un giro al giorno), alla quota MEDIA dei bookmaker
 * (quella che si trova davvero sui siti; se manca, Pinnacle). Dopo ogni giocata persa la puntata sale quanto basta per
 * recuperare tutto e guadagnare l'obiettivo del giro. Solo misura: nessuna giocata, nessun credito.
 */
const { seasonOf } = require('./backtest');

/** Parte pura. rows: {match_date, league, home, away, hg, ag, pd, ad}. */
/** 21/11 (idea di Christian: "giocare le piu' probabili con quote piu' giuste del normale"): solo i pareggi PAGATI PIU' DEL GIUSTO,
 *  cioe' quota piu' alta tra i bookmaker (md) almeno il 2% sopra la quota giusta di Pinnacle senza margine; si gioca a quella quota. */
function valueDraws(rows, minEdge = 0.02) { return valueOf(rows, 'draw', minEdge); }
/** 21/11 ("non soffermiamoci solo sui pareggi"): lo stesso per casa, pareggio o trasferta. Ogni riga diventa la giocata su quell'esito,
 *  con 'ad' = quota piu' alta e hg/ag riscritti in modo che "pareggio" della simulazione = esito vinto (cosi' simulate/flat valgono per tutti). */
function valueOf(rows, sel, minEdge = 0.02, { minOdd = 1, maxOdd = Infinity } = {}) {
  const out = [], P = { home: ['ph', 'mh'], draw: ['pd', 'md'], away: ['pa', 'ma'] }[sel];
  for (const r of rows) {
    const h = Number(r.ph), d = Number(r.pd), a = Number(r.pa), m = Number(r[P[1]]); if (!(h > 1 && d > 1 && a > 1 && m > 1) || m < minOdd || m > maxOdd) continue;
    const fair = (1 / Number(r[P[0]])) / (1 / h + 1 / d + 1 / a); if (m * fair - 1 < minEdge) continue;
    const res = Number(r.hg) > Number(r.ag) ? 'home' : Number(r.hg) === Number(r.ag) ? 'draw' : 'away', won = res === sel;
    out.push({ match_date: r.match_date, league: r.league, home: r.home, away: r.away, hg: won ? 1 : 1, ag: won ? 1 : 0, ad: m, pd: m, p: fair });
  }
  return out;
}
function simulate(rows, { base = 0.2, cap = Infinity, bank = Infinity, double = true, pick = 0, maxSteps = Infinity } = {}) {
  // il pareggio con la quota piu' bassa di ogni giorno (pick = 0), oppure il secondo piu' basso (pick = 1), ecc.: cosi' piu' scalate
  // in parallelo, ognuna con la sua partita del giorno (21/11: "si arriva a 20k giocando su piu' partite")
  const byDay = new Map();
  for (const r of rows) {
    const odd = Number(r.ad) > 1 ? Number(r.ad) : Number(r.pd); if (!(odd > 1)) continue;
    const d = String(r.match_date instanceof Date ? r.match_date.toISOString() : r.match_date).slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push({ d, odd, draw: Number(r.hg) === Number(r.ag), r });
  }
  const days = [...byDay.values()].map(l => l.sort((a, b) => a.odd - b.odd)[pick]).filter(Boolean).sort((a, b) => a.d.localeCompare(b.d));
  let lossRun = 0, lost = 0, maxStake = 0, maxLost = 0, longest = 0, pnl = 0, staked = 0, busts = 0, cycles = 0, peak = 0, maxDd = 0, bets = 0, draws = 0;
  const seasons = new Map(), hist = {};   // hist[k] = quante volte si e' arrivati ad almeno k pareggi mancati di fila
  for (const x of days) {
    const target = base * 2;                                       // obiettivo di ogni giro: quanto rende la prima puntata a quota ~3
    // il metodo del video (chiarito da Christian): si raddoppia la puntata dopo ogni pareggio mancato, 0,20 0,40 0,80 1,60...
    let stake = double ? base * 2 ** lossRun : (lost + target) / (x.odd - 1);
    const S = seasons.get(seasonOf(x.d)) || { season: seasonOf(x.d), bets: 0, draws: 0, pnl: 0, maxStake: 0, longest: 0, busts: 0 };
    seasons.set(S.season, S);
    // salta: il bookmaker non accetta la puntata o la cassa non basta -> si perde tutto il giro e si riparte da capo
    // maxSteps (21/11, "non devono uscire molte serie negative"): dopo N pareggi mancati si accetta la perdita e si riparte da 0,20
    if (stake > cap || lost + stake > bank || lossRun >= maxSteps) { busts++; S.busts++; lost = 0; lossRun = 0; stake = double ? base : target / (x.odd - 1); }
    bets++; S.bets++; staked += stake; maxStake = Math.max(maxStake, stake); S.maxStake = Math.max(S.maxStake, stake);
    if (x.draw) { const win = stake * (x.odd - 1); pnl += win; S.pnl += win; draws++; S.draws++; cycles++; lost = 0; lossRun = 0; }
    else { pnl -= stake; S.pnl -= stake; lost += stake; lossRun++; hist[lossRun] = (hist[lossRun] || 0) + 1; longest = Math.max(longest, lossRun); S.longest = Math.max(S.longest, lossRun); maxLost = Math.max(maxLost, lost); }
    peak = Math.max(peak, pnl); maxDd = Math.max(maxDd, peak - pnl);
  }
  const avgOdd = days.length ? days.reduce((a, x) => a + x.odd, 0) / days.length : null;
  return { days: days.length, bets, draws, drawPct: bets ? 100 * draws / bets : null, avgOdd, fairDrawPct: avgOdd ? 100 / avgOdd : null,
    // 21/11: quanto puo' durare la serie negativa. Osservato: quante serie hanno raggiunto almeno k. Atteso: con la probabilita'
    // di pareggio q giocata ogni giorno, P(almeno k di fila) = (1-q)^k per ogni partenza: serie attese ~ partenze x (1-q)^k
    streaks: Object.keys(hist).map(Number).sort((a, b) => a - b).map(k => ({ k, seen: hist[k], expected: draws ? (draws + 1) * (1 - draws / bets) ** k : null })),
    cycles, pnl, staked, roiPct: staked ? 100 * pnl / staked : null, maxStake, maxLost, longest, busts, maxDrawdown: maxDd,
    seasons: [...seasons.values()].sort((a, b) => a.season.localeCompare(b.season)) };
}

/** N scalate in parallelo (la k-esima prende ogni giorno il k-esimo pareggio piu' basso): somma di saldi e rischi. */
function parallel(rows, n, opts = {}) {
  const L = Array.from({ length: n }, (_, k) => simulate(rows, { ...opts, pick: k }));
  const sum = k => L.reduce((a, x) => a + (x[k] || 0), 0);
  const seasons = new Map();
  for (const x of L) for (const S of x.seasons) { const t = seasons.get(S.season) || { season: S.season, bets: 0, draws: 0, pnl: 0, maxStake: 0, longest: 0, busts: 0 };
    t.bets += S.bets; t.draws += S.draws; t.pnl += S.pnl; t.maxStake = Math.max(t.maxStake, S.maxStake); t.longest = Math.max(t.longest, S.longest); t.busts += S.busts; seasons.set(S.season, t); }
  return { ladders: n, bets: sum('bets'), draws: sum('draws'), pnl: sum('pnl'), staked: sum('staked'), roiPct: sum('staked') ? 100 * sum('pnl') / sum('staked') : null,
    maxStake: Math.max(...L.map(x => x.maxStake)), longest: Math.max(...L.map(x => x.longest)), busts: sum('busts'),
    // cassa che sarebbe servita: nel caso peggiore le scalate perdono insieme (somma delle perdite massime di ognuna)
    bankNeeded: sum('maxLost'), seasons: [...seasons.values()].sort((a, b) => a.season.localeCompare(b.season)) };
}
/** Per confronto: tutti i pareggi di valore a puntata fissa (2 euro), senza scalata. */
function flat(rows, stake = 2) {
  let pnl = 0, n = 0, w = 0; for (const r of rows) { const o = Number(r.ad); if (!(o > 1)) continue; n++; if (Number(r.hg) === Number(r.ag)) { w++; pnl += stake * (o - 1); } else pnl -= stake; }
  return { bets: n, draws: w, pnl, staked: stake * n, roiPct: n ? 100 * pnl / (stake * n) : null };
}
/** I giorni della scalata: per ogni giorno la giocata con la quota piu' bassa (la piu' probabile). */
function dailyPicks(rows) {
  const byDay = new Map();
  for (const r of rows) { const odd = Number(r.ad); if (!(odd > 1)) continue; const d = String(r.match_date instanceof Date ? r.match_date.toISOString() : r.match_date).slice(0, 10);
    const cur = byDay.get(d); if (!cur || odd < cur.odd) byDay.set(d, { d, odd, won: Number(r.hg) === Number(r.ag), p: Number(r.p) || 1 / odd }); }
  return [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d));
}
/** 🎰 21/11 sera: i sistemi di puntata messi a confronto sulle STESSE giocate (una al giorno), cassa iniziale 100 euro, unita' 1 euro.
 *  Ogni sistema e' una funzione: (stato, giocata) -> puntata; dopo il risultato aggiorna lo stato. */
const FIB = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];
function masanielloTable(N, K, q) {   // M[n][w]: capitale necessario (in unita' dell'obiettivo) con n giocate rimaste e w vittorie da fare
  const M = Array.from({ length: N + 1 }, () => Array(K + 1).fill(0));
  for (let n = 0; n <= N; n++) for (let w = 0; w <= K; w++) {
    if (w === 0) M[n][w] = 1; else if (w > n) M[n][w] = 0; else M[n][w] = (M[n - 1][w - 1] + (q - 1) * M[n - 1][w]) / q;
  }
  return M;
}
const SYSTEMS = {
  fissa: { label: 'Puntata fissa 1 €', stake: () => 1, after() {} },
  martingala8: { label: 'Martingala, freno a 8', init: s => { s.k = 0; }, stake: s => 2 ** s.k, after: (s, won) => { s.k = won ? 0 : s.k + 1; if (s.k >= 8) { s.k = 0; s.stops = (s.stops || 0) + 1; } } },
  martingala10: { label: 'Martingala, freno a 10', init: s => { s.k = 0; }, stake: s => 2 ** s.k, after: (s, won) => { s.k = won ? 0 : s.k + 1; if (s.k >= 10) { s.k = 0; s.stops = (s.stops || 0) + 1; } } },
  fibonacci: { label: 'Fibonacci, freno a 10', init: s => { s.i = 0; }, stake: s => FIB[s.i], after: (s, won) => { s.i = won ? Math.max(0, s.i - 2) : s.i + 1; if (s.i >= 10) { s.i = 0; s.stops = (s.stops || 0) + 1; } } },
  dalembert: { label: "D'Alembert", init: s => { s.u = 1; }, stake: s => s.u, after: (s, won) => { s.u = won ? Math.max(1, s.u - 1) : s.u + 1; } },
  paroli: { label: 'Paroli (3 vinte)', init: s => { s.k = 0; }, stake: s => 2 ** s.k, after: (s, won) => { s.k = won ? s.k + 1 : 0; if (s.k >= 3) s.k = 0; } },
  masaniello: { label: 'Masaniello (4 su 10, ciclo da 20 unità)', init: (s, unit = 1) => { s.n = 10; s.w = 4; s.cap = 20 * unit; s.M = masanielloTable(10, 4, 2.6); s.goal = s.cap / s.M[10][4]; s.bk = s.cap; },
    stake: (s, x) => { if (s.w === 0 || s.w > s.n) return 0; const st = s.goal * (s.M[s.n - 1][s.w - 1] - s.M[s.n - 1][s.w]) / x.odd; return Math.max(0, Math.min(st, s.bk)); },
    after: (s, won, st, x) => { s.bk += won ? st * (x.odd - 1) : -st; s.n--; if (won) s.w--; if (s.w === 0 || s.w > s.n || s.n === 0 || s.bk <= 0.01) { s.cycles = (s.cycles || 0) + 1; if (s.w > 0) s.stops = (s.stops || 0) + 1; s.n = 10; s.w = 4; s.bk = s.cap; } } },
  kelly: { label: '¼ Kelly (2% max)', stake: (s, x, bank) => Math.max(0, Math.min(0.02 * bank, bank * ((x.odd * x.p - 1) / (x.odd - 1)) / 4)), after() {} }
};
function compareSystems(rows, { bank0 = 100, unit = 1 } = {}) {
  const days = dailyPicks(rows), out = {};
  for (const [key, sys] of Object.entries(SYSTEMS)) {
    const st = {}; if (sys.init) sys.init(st, unit);
    let bank = bank0, peak = bank0, maxDd = 0, staked = 0, maxStake = 0, minBank = bank0, ruined = null; const seasons = new Map();
    for (const x of days) {
      let s = key === 'kelly' || key === 'masaniello' ? sys.stake(st, x, bank) : unit * sys.stake(st, x, bank); if (!(s > 0)) { sys.after(st, x.won, 0, x); continue; }
      if (s > bank) { s = bank; } if (bank <= 0.01) { ruined = ruined || x.d; break; }
      const pnl = x.won ? s * (x.odd - 1) : -s; bank += pnl; staked += s; maxStake = Math.max(maxStake, s); minBank = Math.min(minBank, bank);
      peak = Math.max(peak, bank); maxDd = Math.max(maxDd, peak - bank); const se = seasonOf(x.d); seasons.set(se, (seasons.get(se) || 0) + pnl);
      sys.after(st, x.won, s, x);
    }
    const sv = [...seasons.values()];
    out[key] = { label: sys.label, final: bank, pnl: bank - bank0, staked, roiPct: staked ? 100 * (bank - bank0) / staked : null, maxStake, maxDrawdown: maxDd, minBank, ruined,
      gainRisk: maxDd > 0 ? (bank - bank0) / maxDd : null, maxDrawdownPct: 100 * maxDd / bank0,
      redSeasons: sv.filter(v => v < 0).length, seasons: sv.length, worstSeason: sv.length ? Math.min(...sv) : null, bestSeason: sv.length ? Math.max(...sv) : null, stops: st.stops || 0 };
  }
  return { days: days.length, winPct: days.length ? 100 * days.filter(x => x.won).length / days.length : null, avgOdd: days.length ? days.reduce((a, x) => a + x.odd, 0) / days.length : null, systems: out };
}
/** 🎚️ 21/11 sera (idea di Christian): scalata che sceglie la partita in base al gradino. Gradini bassi: quella con PIU' VALORE
 *  (di solito quota piu' alta, vince di piu'); dal gradino `switchAt` in su: la PIU' PROBABILE (si rischia di piu', conta non perdere).
 *  Una giocata al giorno, raddoppio da `base`, freno a `stop`. Confronto: sempre la piu' probabile (la scalata attuale) e sempre la
 *  piu' di valore. rows: giocate di valore della fascia con p (probabilita' vera) e ad (quota). */
function adaptiveLadder(rows, { base = 0.2, stop = 10, switchAt = 4, mode = 'adattiva' } = {}) {
  const byDay = new Map();
  for (const r of rows) { const odd = Number(r.ad); if (!(odd > 1)) continue; const d = String(r.match_date instanceof Date ? r.match_date.toISOString() : r.match_date).slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push({ odd, p: Number(r.p) || 1 / odd, won: Number(r.hg) === Number(r.ag) }); }
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let k = 0, pnl = 0, staked = 0, stops = 0, peak = 0, maxDd = 0, longest = 0, wins = 0, bets = 0; const seasons = new Map(), reach = Array(stop + 1).fill(0);
  for (const [d, list] of days) {
    const step = k + 1, byValue = list.reduce((a, x) => (x.odd * x.p > a.odd * a.p ? x : a)), byProb = list.reduce((a, x) => (x.p > a.p ? x : a));
    const x = mode === 'valore' ? byValue : mode === 'probabile' ? byProb : (step < switchAt ? byValue : byProb);
    const stake = base * 2 ** k; staked += stake; bets++; reach[step]++;
    const v = x.won ? stake * (x.odd - 1) : -stake; pnl += v; const se = seasonOf(d); seasons.set(se, (seasons.get(se) || 0) + v);
    if (x.won) { wins++; k = 0; } else { k++; longest = Math.max(longest, k); if (k >= stop) { stops++; k = 0; } }
    peak = Math.max(peak, pnl); maxDd = Math.max(maxDd, peak - pnl);
  }
  const sv = [...seasons.values()];
  return { mode, switchAt, bets, winPct: bets ? 100 * wins / bets : null, pnl, staked, roiPct: staked ? 100 * pnl / staked : null, stops, longest, maxDrawdown: maxDd,
    redSeasons: sv.filter(v => v < 0).length, seasons: sv.length, reachPct: reach.map(n => (bets ? 100 * n / bets : 0)) };
}
/** 🛡️ 21/11 sera: martingala ADATTIVA AL RISCHIO (proposta a Christian). Una giocata al giorno, la piu' probabile della fascia.
 *  adaptBase: la partenza di ogni giro = cassa della scalata / 1.250 (arrotondata in giu' a 0,10, minimo 0,10): la perdita massima
 *  col freno a 10 (partenza x 1.023) resta sotto l'82% della cassa; sale con le vincite, scende con le perdite.
 *  strictFrom: da quel gradino in su si gioca solo con probabilita' >= strictProb, altrimenti quel giorno si salta. */
function riskLadder(rows, { bank0 = 250, adaptBase = false, fixedBase = 0.2, strictFrom = 0, strictProb = 0.45, stop = 10 } = {}) {
  const byDay = new Map();
  for (const r of rows) { const odd = Number(r.ad); if (!(odd > 1)) continue; const d = String(r.match_date instanceof Date ? r.match_date.toISOString() : r.match_date).slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push({ odd, p: Number(r.p) || 1 / odd, won: Number(r.hg) === Number(r.ag) }); }
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const baseOf = bank => (adaptBase ? Math.max(0.1, Math.floor(bank / 1250 * 10) / 10) : fixedBase);
  let bank = bank0, base = baseOf(bank), k = 0, stops = 0, bets = 0, wins = 0, skipped = 0, peak = bank0, maxDd = 0, minBank = bank0, longest = 0, ruined = null; const seasons = new Map();
  for (const [d, list] of days) {
    const step = k + 1, best = list.reduce((a, x) => (x.p > a.p ? x : a));
    if (strictFrom && step >= strictFrom && best.p < strictProb) { skipped++; continue; }
    const stake = base * 2 ** k; if (stake > bank) { ruined = ruined || d; break; }
    const v = best.won ? stake * (best.odd - 1) : -stake; bank += v; bets++; const se = seasonOf(d); seasons.set(se, (seasons.get(se) || 0) + v);
    if (best.won) { wins++; k = 0; base = baseOf(bank); } else { k++; longest = Math.max(longest, k); if (k >= stop) { stops++; k = 0; base = baseOf(bank); } }
    peak = Math.max(peak, bank); maxDd = Math.max(maxDd, peak - bank); minBank = Math.min(minBank, bank);
  }
  const sv = [...seasons.values()];
  return { bank0, final: bank, pnl: bank - bank0, bets, winPct: bets ? 100 * wins / bets : null, skipped, stops, longest, maxDrawdown: maxDd, minBank, ruined, finalBase: base,
    redSeasons: sv.filter(v => v < 0).length, seasons: sv.length, bySeason: [...seasons.entries()].map(([k2, v]) => ({ season: k2, pnl: v })) };
}
/** 🎯 21/11 sera (idea di Christian: "arrivare ai gradini alti con partite ad alta probabilita'"): fino al gradino lowFrom-1 raddoppio
 *  sulla piu' probabile della fascia 2-3,50; da lowFrom in su si sceglie la piu' probabile tra le quote 1,50-3,50 (sempre con
 *  valore) e la puntata e' quella che RECUPERA tutto il perso del giro + il guadagno di un giro (partenza x 1,4), non il raddoppio. */
function recoveryLadder(rowsBand, rowsLow, { bank0 = 250, adaptBase = true, lowFrom = 6, stop = 10 } = {}) {
  const pack = rows => { const m = new Map(); for (const r of rows) { const odd = Number(r.ad); if (!(odd > 1)) continue; const d = String(r.match_date instanceof Date ? r.match_date.toISOString() : r.match_date).slice(0, 10);
    if (!m.has(d)) m.set(d, []); m.get(d).push({ odd, p: Number(r.p) || 1 / odd, won: Number(r.hg) === Number(r.ag) }); } return m; };
  const B = pack(rowsBand), L = pack(rowsLow), days = [...new Set([...B.keys(), ...L.keys()])].sort();
  const baseOf = bank => (adaptBase ? Math.max(0.1, Math.floor(bank / 1250 * 10) / 10) : 0.2);
  let bank = bank0, base = baseOf(bank), k = 0, lost = 0, stops = 0, bets = 0, wins = 0, peak = bank0, maxDd = 0, minBank = bank0, longest = 0, maxStake = 0, worstStop = 0, ruined = null, lowBets = 0, lowWins = 0; const seasons = new Map();
  for (const d of days) {
    const step = k + 1, pool = step >= lowFrom ? [...(B.get(d) || []), ...(L.get(d) || [])] : (B.get(d) || []);
    if (!pool.length) continue;
    const x = pool.reduce((a, y) => (y.p > a.p ? y : a));
    const stake = step >= lowFrom ? (lost + base * 1.4) / (x.odd - 1) : base * 2 ** k;
    if (stake > bank) { ruined = ruined || d; break; }
    if (step >= lowFrom) { lowBets++; if (x.won) lowWins++; }
    maxStake = Math.max(maxStake, stake); bets++;
    const v = x.won ? stake * (x.odd - 1) : -stake; bank += v; const se = seasonOf(d); seasons.set(se, (seasons.get(se) || 0) + v);
    if (x.won) { wins++; k = 0; lost = 0; base = baseOf(bank); }
    else { k++; lost += stake; longest = Math.max(longest, k); if (k >= stop) { stops++; worstStop = Math.max(worstStop, lost); k = 0; lost = 0; base = baseOf(bank); } }
    peak = Math.max(peak, bank); maxDd = Math.max(maxDd, peak - bank); minBank = Math.min(minBank, bank);
  }
  const sv = [...seasons.values()];
  return { lowFrom, final: bank, pnl: bank - bank0, bets, winPct: bets ? 100 * wins / bets : null, lowBets, lowWinPct: lowBets ? 100 * lowWins / lowBets : null, stops, worstStop, longest, maxStake, maxDrawdown: maxDd, minBank, ruined, finalBase: base,
    redSeasons: sv.filter(v => v < 0).length, seasons: sv.length };
}
const MT_VERSION = 14;
async function getMartingala(pool, { force = false } = {}) {
  const C = require('./calib'); await C.ensureCalib(pool);
  if (!force) { const sv = await C.loadState(pool, 'martingala').catch(() => null); if (sv && sv.version === MT_VERSION && !C.isRunning()) return sv; }
  const rows = (await pool.query(`SELECT match_date, league, home, away, hg, ag, ph, pd, pa, mh, md, ma, ad FROM hist_pin WHERE pd IS NOT NULL OR ad IS NOT NULL ORDER BY match_date`)).rows;
  const val = {
    version: MT_VERSION, matches: rows.length, updatedAt: new Date().toISOString(),
    // il metodo del video: parte da 0,20 e raddoppia. Scenari: senza limiti (il sogno), banco che accetta al massimo 1.000 euro,
    // cassa da 1.000 euro; e la stessa scalata partendo da 50 euro (quanto servirebbe per avvicinarsi ai 20.000 l'anno)
    senzaLimiti: simulate(rows),
    tetto1000: simulate(rows, { cap: 1000 }),
    cassa1000: simulate(rows, { bank: 1000 }),
    base50: simulate(rows, { base: 50 }),
    // piu' scalate in parallelo: ogni giorno le N partite col pareggio piu' basso, una scalata per ciascuna (0,20 e raddoppio)
    parallele: [3, 5, 10].map(n => parallel(rows, n)),
    // la scalata con il freno: dopo 6, 8, 10 o 12 pareggi mancati di fila si chiude in perdita e si riparte (tutti i pareggi e solo quelli di valore)
    freno: [6, 8, 10, 12].map(k => ({ passi: k, tutti: simulate(rows, { maxSteps: k }), valore: simulate(valueDraws(rows), { maxSteps: k }) })),
    // per esito (casa, pareggio, trasferta) e tutti insieme: solo giocate pagate almeno il 2% piu' del giusto alla quota piu' alta;
    // a puntata fissa, scalata con freno a 6 e 8, e quanto lunga e' stata la serie peggiore (senza limiti, solo per misurarla)
    perEsito: (() => { const one = l => ({ fissa: flat(l), freno6: simulate(l, { maxSteps: 6 }), freno8: simulate(l, { maxSteps: 8 }), serieMax: simulate(l).longest });
      const H = valueOf(rows, 'home'), D = valueOf(rows, 'draw'), A = valueOf(rows, 'away');
      return { casa: one(H), pareggio: one(D), trasferta: one(A), tutti: one([...H, ...D, ...A]),
        // la fascia delle stelle: quota 2-3,50
        stelle: one([...valueOf(rows, 'home', 0.02, { minOdd: 2, maxOdd: 3.5 }), ...valueOf(rows, 'away', 0.02, { minOdd: 2, maxOdd: 3.5 }), ...valueOf(rows, 'draw', 0.02, { minOdd: 2, maxOdd: 3.5 })]) }; })(),
    // 21/11 sera: la scalata di valore nella fascia delle stelle (quota 2-3,50, dove il raddoppio recupera davvero): ogni giorno la
    // giocata di valore piu' probabile della fascia, raddoppio da 0,20, freno a 6/8/10 o niente; e 2/3 scalate in parallelo; e la
    // stessa giocata del giorno a 0,20 fissi, per vedere quanto aggiunge la scalata
    fascia: (() => { const band = [...valueOf(rows, 'home', 0.02, { minOdd: 2, maxOdd: 3.5 }), ...valueOf(rows, 'draw', 0.02, { minOdd: 2, maxOdd: 3.5 }), ...valueOf(rows, 'away', 0.02, { minOdd: 2, maxOdd: 3.5 })];
      const daily = simulate(band, { double: true }), fixedDaily = simulate(band, { maxSteps: 0 });
      // 21/11: Christian parte da 0,20 (non da 1 euro): stesso confronto con l'unita' da 0,20
      return { giocate: band.length, sistemi: compareSystems(band), sistemi020: compareSystems(band, { unit: 0.2 }),
        // 21/11 sera (Christian): cassa 500 euro, partenza 0,20; Kelly sulla cassa da 500
        sistemi500: compareSystems(band, { bank0: 500, unit: 0.2 }),
        // 🎯 gradini alti su quote 1,50-2,00 con puntata di recupero (partenza adattiva, cassa 250)
        recupero: (() => { const low = [...valueOf(rows, 'home', 0.02, { minOdd: 1.5, maxOdd: 3.5 }), ...valueOf(rows, 'draw', 0.02, { minOdd: 1.5, maxOdd: 3.5 }), ...valueOf(rows, 'away', 0.02, { minOdd: 1.5, maxOdd: 3.5 })];
          return { da4: recoveryLadder(band, low, { lowFrom: 4 }), da6: recoveryLadder(band, low, { lowFrom: 6 }), da8: recoveryLadder(band, low, { lowFrom: 8 }), mai: recoveryLadder(band, low, { lowFrom: 99 }) }; })(),
        // 🛡️ martingala adattiva al rischio, cassa della scalata 250 euro
        rischio: { attuale: riskLadder(band), partenzaAdattiva: riskLadder(band, { adaptBase: true }), filtro6: riskLadder(band, { strictFrom: 6 }),
          entrambe: riskLadder(band, { adaptBase: true, strictFrom: 6 }), entrambe5: riskLadder(band, { adaptBase: true, strictFrom: 5 }), filtro6p48: riskLadder(band, { strictFrom: 6, strictProb: 0.48 }) },
        // 🎚️ scalata adattiva (valore nei gradini bassi, probabilita' in quelli alti) contro le due pure
        adattiva: { probabile: adaptiveLadder(band, { mode: 'probabile' }), valore: adaptiveLadder(band, { mode: 'valore' }),
          da3: adaptiveLadder(band, { switchAt: 3 }), da4: adaptiveLadder(band, { switchAt: 4 }), da5: adaptiveLadder(band, { switchAt: 5 }), da6: adaptiveLadder(band, { switchAt: 6 }) }, senzaFreno: daily, freno6: simulate(band, { maxSteps: 6 }), freno8: simulate(band, { maxSteps: 8 }), freno10: simulate(band, { maxSteps: 10 }),
        parallele2: parallel(band, 2, { maxSteps: 8 }), parallele3: parallel(band, 3, { maxSteps: 8 }), fissaUnaAlGiorno: fixedDaily }; })(),
    // solo pareggi pagati piu' del giusto (alla quota piu' alta): raddoppio, una e tre scalate, e a puntata fissa per confronto
    valore: { una: simulate(valueDraws(rows)), tre: parallel(valueDraws(rows), 3), fissa: flat(valueDraws(rows)) },
    // per confronto: la scalata "giusta" che alza solo quanto basta per recuperare (meno aggressiva del raddoppio)
    recupero: simulate(rows, { double: false })
  };
  if (rows.length && !C.isRunning()) await C.saveState(pool, 'martingala', val);
  return val;
}

module.exports = { recoveryLadder, riskLadder, adaptiveLadder, compareSystems, masanielloTable, dailyPicks, simulate, parallel, valueDraws, valueOf, flat, getMartingala };
