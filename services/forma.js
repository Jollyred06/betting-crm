/**
 * 🏃 PROVA DELLA FORMA SULLO STORICO (18 novembre 2026). Domanda: "una squadra che nelle ultime partite ha fatto meglio di
 * quanto diceva Pinnacle continua a fare meglio?". Se si', la forma diventa un nuovo modo di leggere la partita per l'IA.
 * Per ogni partita, in ordine di tempo e usando solo le partite precedenti: residuo di ogni squadra = vittorie meno vittorie
 * attese da Pinnacle, con le partite vecchie che pesano meno. Si sposta la probabilita' di casa/trasferta di meta' della
 * differenza tra le due squadre e si misura l'errore contro Pinnacle da solo. Solo misura: non cambia nessuna regola.
 */
const { noVigPower } = require('./sharpSignals');
const { seasonOf } = require('./backtest');
const SELS = ['home', 'draw', 'away'];
// varianti provate: K = quanta prudenza (piu' alto = sposta meno), decay = quanto pesa il passato (1 = tutto uguale)
const CONFIGS = [{ K: 5, decay: 0.9 }, { K: 10, decay: 0.9 }, { K: 20, decay: 0.95 }, { K: 10, decay: 1 }, { K: 40, decay: 1 }];
const MIN_PAST = 5;
const LL = p => -Math.log(Math.max(1e-6, p));
const pick = p => SELS.reduce((a, b) => (p[a] >= p[b] ? a : b));

function formaOf(team, name) { const t = team.get(name); return t || { w: 0, res: 0, n: 0 }; }
function shiftOf(t, K) { return t.n >= MIN_PAST ? t.res / (t.w + K) : 0; }

/** Parte pura. rows ordinate per data: {match_date, league, home, away, hg, ag, ph, pd, pa}. */
function formaTest(rows) {
  const st = CONFIGS.map(c => ({ ...c, team: new Map(), n: 0, lossPin: 0, loss: 0, hitPin: 0, hit: 0, good: { n: 0, won: 0, exp: 0 }, bad: { n: 0, won: 0, exp: 0 }, bySeason: new Map() }));
  let matches = 0;
  for (const r of rows) {
    const pin = { home: Number(r.ph), draw: Number(r.pd), away: Number(r.pa) };
    if (!SELS.every(k => pin[k] > 1)) continue;
    matches++;
    const p = noVigPower(pin), hg = Number(r.hg), ag = Number(r.ag), out = hg > ag ? 'home' : hg === ag ? 'draw' : 'away';
    const hk = `${r.home}`, ak = `${r.away}`;
    for (const c of st) {
      const th = formaOf(c.team, hk), ta = formaOf(c.team, ak);
      if (th.n >= MIN_PAST && ta.n >= MIN_PAST) {
        const sh = shiftOf(th, c.K), sa = shiftOf(ta, c.K), d = (sh - sa) / 2;
        const q0 = { home: Math.max(0.01, p.home + d), draw: p.draw, away: Math.max(0.01, p.away - d) }, s = q0.home + q0.draw + q0.away;
        const q = { home: q0.home / s, draw: q0.draw / s, away: q0.away / s };
        c.n++; c.lossPin += LL(p[out]); c.loss += LL(q[out]); c.hitPin += pick(p) === out ? 1 : 0; c.hit += pick(q) === out ? 1 : 0;
        const se = seasonOf(r.match_date); if (!c.bySeason.has(se)) c.bySeason.set(se, { n: 0, lossPin: 0, loss: 0 }); const b = c.bySeason.get(se); b.n++; b.lossPin += LL(p[out]); b.loss += LL(q[out]);
        // squadre "in forma" (la forma alza la vittoria di almeno 2 punti): vincono piu' di quanto dice Pinnacle?
        for (const [k, sh0] of [['home', d], ['away', -d]]) { const g = sh0 >= 0.02 ? c.good : sh0 <= -0.02 ? c.bad : null; if (g) { g.n++; g.won += out === k ? 1 : 0; g.exp += p[k]; } }
      }
      const upd = (key, t, k) => c.team.set(key, { w: t.w * c.decay + 1, res: t.res * c.decay + ((out === k ? 1 : 0) - p[k]), n: t.n + 1 });
      upd(hk, th, 'home'); upd(ak, ta, 'away');
    }
  }
  const z = g => (g.n ? Math.round(100 * (g.won - g.exp) / Math.sqrt(Math.max(1e-9, g.exp * (1 - g.exp / g.n)))) / 100 : null);
  const grp = g => ({ n: g.n, won: g.won, expected: Math.round(g.exp * 10) / 10, z: z(g) });
  const res = st.map(c => ({
    K: c.K, decay: c.decay, n: c.n,
    diffPerMille: c.n ? Math.round(10000 * (c.loss - c.lossPin) / c.n) / 10 : null,   // negativo = la forma aiuta
    hits: c.hit, hitsPin: c.hitPin, inForma: grp(c.good), fuoriForma: grp(c.bad),
    bySeason: [...c.bySeason.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([s, b]) => ({ season: s, n: b.n, diffPerMille: Math.round(10000 * (b.loss - b.lossPin) / b.n) / 10 }))
  }));
  const best = res.reduce((a, b) => (b.n && (a == null || b.diffPerMille < a.diffPerMille) ? b : a), null);
  const better = best ? best.bySeason.filter(s => s.diffPerMille < 0).length : 0, seasons = best ? best.bySeason.length : 0;
  // giudizio: serve aiutare nel complesso di almeno 0,5 per mille E nella maggior parte delle stagioni
  const verdict = !best ? 'pochi' : best.diffPerMille <= -0.5 && better >= Math.ceil(seasons * 0.6) ? 'aiuta' : best.diffPerMille < 0 ? 'quasi' : 'no';
  return { matches, minPast: MIN_PAST, configs: res, best, betterSeasons: better, seasons, verdict };
}

const FT_VERSION = 1;
async function getFormaTest(pool, { force = false } = {}) {
  const C = require('./calib'); await C.ensureCalib(pool);
  if (!force) { const sv = await C.loadState(pool, 'forma_test').catch(() => null); if (sv && sv.version === FT_VERSION && !C.isRunning()) return sv; }
  const rows = (await pool.query(`SELECT match_date, league, home, away, hg, ag, ph, pd, pa FROM hist_pin WHERE ph IS NOT NULL ORDER BY match_date, league, home`)).rows;
  const val = { ...formaTest(rows), version: FT_VERSION, updatedAt: new Date().toISOString() };
  if (val.matches && !C.isRunning()) await C.saveState(pool, 'forma_test', val);
  return val;
}

module.exports = { formaTest, getFormaTest, CONFIGS };
