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
function valueDraws(rows, minEdge = 0.02) {
  const out = [];
  for (const r of rows) {
    const h = Number(r.ph), d = Number(r.pd), a = Number(r.pa), m = Number(r.md); if (!(h > 1 && d > 1 && a > 1 && m > 1)) continue;
    const fair = (1 / d) / (1 / h + 1 / d + 1 / a); if (m * fair - 1 >= minEdge) out.push({ ...r, ad: m });
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
const MT_VERSION = 6;
async function getMartingala(pool, { force = false } = {}) {
  const C = require('./calib'); await C.ensureCalib(pool);
  if (!force) { const sv = await C.loadState(pool, 'martingala').catch(() => null); if (sv && sv.version === MT_VERSION && !C.isRunning()) return sv; }
  const rows = (await pool.query(`SELECT match_date, league, home, away, hg, ag, ph, pd, pa, md, ad FROM hist_pin WHERE pd IS NOT NULL OR ad IS NOT NULL ORDER BY match_date`)).rows;
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
    // solo pareggi pagati piu' del giusto (alla quota piu' alta): raddoppio, una e tre scalate, e a puntata fissa per confronto
    valore: { una: simulate(valueDraws(rows)), tre: parallel(valueDraws(rows), 3), fissa: flat(valueDraws(rows)) },
    // per confronto: la scalata "giusta" che alza solo quanto basta per recuperare (meno aggressiva del raddoppio)
    recupero: simulate(rows, { double: false })
  };
  if (rows.length && !C.isRunning()) await C.saveState(pool, 'martingala', val);
  return val;
}

module.exports = { simulate, parallel, valueDraws, flat, getMartingala };
