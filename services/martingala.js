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
function simulate(rows, { base = 0.2, cap = Infinity, bank = Infinity, double = true } = {}) {
  // il pareggio con la quota piu' bassa di ogni giorno
  const byDay = new Map();
  for (const r of rows) {
    const odd = Number(r.ad) > 1 ? Number(r.ad) : Number(r.pd); if (!(odd > 1)) continue;
    const d = String(r.match_date instanceof Date ? r.match_date.toISOString() : r.match_date).slice(0, 10), cur = byDay.get(d);
    if (!cur || odd < cur.odd) byDay.set(d, { d, odd, draw: Number(r.hg) === Number(r.ag), r });
  }
  const days = [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d));
  let lossRun = 0, lost = 0, maxStake = 0, maxLost = 0, longest = 0, pnl = 0, staked = 0, busts = 0, cycles = 0, peak = 0, maxDd = 0, bets = 0, draws = 0;
  const seasons = new Map();
  for (const x of days) {
    const target = base * 2;                                       // obiettivo di ogni giro: quanto rende la prima puntata a quota ~3
    // il metodo del video (chiarito da Christian): si raddoppia la puntata dopo ogni pareggio mancato, 0,20 0,40 0,80 1,60...
    let stake = double ? base * 2 ** lossRun : (lost + target) / (x.odd - 1);
    const S = seasons.get(seasonOf(x.d)) || { season: seasonOf(x.d), bets: 0, draws: 0, pnl: 0, maxStake: 0, longest: 0, busts: 0 };
    seasons.set(S.season, S);
    // salta: il bookmaker non accetta la puntata o la cassa non basta -> si perde tutto il giro e si riparte da capo
    if (stake > cap || lost + stake > bank) { busts++; S.busts++; lost = 0; lossRun = 0; stake = double ? base : target / (x.odd - 1); }
    bets++; S.bets++; staked += stake; maxStake = Math.max(maxStake, stake); S.maxStake = Math.max(S.maxStake, stake);
    if (x.draw) { const win = stake * (x.odd - 1); pnl += win; S.pnl += win; draws++; S.draws++; cycles++; lost = 0; lossRun = 0; }
    else { pnl -= stake; S.pnl -= stake; lost += stake; lossRun++; longest = Math.max(longest, lossRun); S.longest = Math.max(S.longest, lossRun); maxLost = Math.max(maxLost, lost); }
    peak = Math.max(peak, pnl); maxDd = Math.max(maxDd, peak - pnl);
  }
  const avgOdd = days.length ? days.reduce((a, x) => a + x.odd, 0) / days.length : null;
  return { days: days.length, bets, draws, drawPct: bets ? 100 * draws / bets : null, avgOdd, fairDrawPct: avgOdd ? 100 / avgOdd : null,
    cycles, pnl, staked, roiPct: staked ? 100 * pnl / staked : null, maxStake, maxLost, longest, busts, maxDrawdown: maxDd,
    seasons: [...seasons.values()].sort((a, b) => a.season.localeCompare(b.season)) };
}

const MT_VERSION = 2;
async function getMartingala(pool, { force = false } = {}) {
  const C = require('./calib'); await C.ensureCalib(pool);
  if (!force) { const sv = await C.loadState(pool, 'martingala').catch(() => null); if (sv && sv.version === MT_VERSION && !C.isRunning()) return sv; }
  const rows = (await pool.query(`SELECT match_date, league, home, away, hg, ag, pd, ad FROM hist_pin WHERE pd IS NOT NULL OR ad IS NOT NULL ORDER BY match_date`)).rows;
  const val = {
    version: MT_VERSION, matches: rows.length, updatedAt: new Date().toISOString(),
    // il metodo del video: parte da 0,20 e raddoppia. Scenari: senza limiti (il sogno), banco che accetta al massimo 1.000 euro,
    // cassa da 1.000 euro; e la stessa scalata partendo da 50 euro (quanto servirebbe per avvicinarsi ai 20.000 l'anno)
    senzaLimiti: simulate(rows),
    tetto1000: simulate(rows, { cap: 1000 }),
    cassa1000: simulate(rows, { bank: 1000 }),
    base50: simulate(rows, { base: 50 }),
    // per confronto: la scalata "giusta" che alza solo quanto basta per recuperare (meno aggressiva del raddoppio)
    recupero: simulate(rows, { double: false })
  };
  if (rows.length && !C.isRunning()) await C.saveState(pool, 'martingala', val);
  return val;
}

module.exports = { simulate, getMartingala };
