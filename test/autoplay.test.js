// Giocate simulate automatiche: scelta dei segnali, riepilogo, partenza senza storico. Senza rete e senza database vero.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
Module._load = function (request) {
  if (request === 'dotenv') return { config() {} };
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  return origLoad.apply(this, arguments);
};
const A = require('../services/autoplay');
const NOW = Date.parse('2026-11-14T12:00:00Z');
const sig = (id, ev, sel, created, start) => ({ id, event_id: ev, selection: sel, created_at: created, commence_time: start, strategy: 'I', book: 'snai', odd: 2.5, jl: true });
const fake = { isOceani: r => r.jl === true, primaryRows: rows => rows };
(async () => {
  assert.strictEqual(A.stakeOf({}), 2); assert.strictEqual(A.stakeOf({ AUTO_STAKE: '3' }), 3); assert.strictEqual(A.stakeOf({ AUTO_STAKE: 'x' }), 2); assert.strictEqual(A.stakeOf({ AUTO_STAKE: '5000' }), 2);
  const rows = [sig(1, 'e1', 'home', '2026-11-14T11:00:00Z', '2026-11-14T18:00:00Z'), sig(2, 'e2', 'away', '2026-11-14T11:00:00Z', '2026-11-14T10:00:00Z'),
    sig(3, 'e3', 'draw', '2026-11-13T11:00:00Z', '2026-11-14T18:00:00Z'), { ...sig(4, 'e4', 'home', '2026-11-14T11:00:00Z', '2026-11-14T18:00:00Z'), jl: false }, sig(5, 'e5', 'home', '2026-11-14T11:30:00Z', '2026-11-14T19:00:00Z')];
  const pick = A.pickNew(rows, { sinceMs: Date.parse('2026-11-14T00:00:00Z'), nowMs: NOW, taken: { ids: [], keys: ['e5|home'] }, ...fake });
  assert.deepStrictEqual(pick.map(r => r.id), [1], 'solo JL, dopo la partenza, partita non iniziata, non gia presa');
  const s = A.summarize([
    { id: 1, created_at: '2026-11-14T11:00:00Z', home: 'A', away: 'B', selection: 'home', odd: 2.5, stake: 2, result: 'won', fair_prob: 0.42, closing_fair_prob: 0.43 },
    { id: 2, created_at: '2026-11-14T11:10:00Z', home: 'C', away: 'D', selection: 'away', odd: 3, stake: 2, result: 'lost', fair_prob: 0.35, closing_fair_prob: null },
    { id: 3, created_at: '2026-11-14T11:20:00Z', home: 'E', away: 'F', selection: 'draw', odd: 3.2, stake: 2, result: null, fair_prob: 0.3, closing_fair_prob: null }]);
  assert.strictEqual(s.count, 3); assert.strictEqual(s.open, 1); assert.strictEqual(s.settled, 2); assert.strictEqual(s.won, 1);
  assert.ok(Math.abs(s.pnlEur - (3 - 2)) < 1e-9 && Math.abs(s.roiPct - 25) < 1e-9); assert.ok(Math.abs(s.expectedWon - 0.77) < 1e-9);
  assert.strictEqual(s.measured, 1); assert.ok(Math.abs(s.avgClvPct - 7.5) < 1e-9); assert.strictEqual(s.items[0].id, 3);
  // partenza: la prima volta registra l'inizio e NON gioca lo storico; poi gioca i nuovi
  const state = {}, bets = [], signals = [];
  const pool = { query: async (sql, p) => {
    if (/CREATE/.test(sql)) return { rows: [] };
    if (/FROM auto_state/.test(sql)) return { rows: state.start ? [{ val: state.start }] : [] };
    if (/INSERT INTO auto_state/.test(sql)) { state.start = p[0]; return { rowCount: 1 }; }
    if (/FROM italia_signals/.test(sql)) return { rows: p ? signals.filter(r => Date.parse(r.created_at) >= Date.parse(p[0])) : signals };
    if (/FROM auto_bets/.test(sql)) return { rows: bets };
    if (/INSERT INTO auto_bets/.test(sql)) { bets.push({ signal_id: p[0], event_id: p[1], selection: p[2] }); return { rowCount: 1 }; }
    return { rows: [] }; } };
  const I = require('../services/italia'), origO = I.isOceani; I.isOceani = r => r.jl === true;
  signals.push(sig(10, 'old', 'home', '2026-11-14T09:00:00Z', '2026-11-14T18:00:00Z'));
  assert.deepStrictEqual(await (require('../services/sigstore').reset(), A).runAutoplay(pool, { nowMs: NOW }), { nuoveSimulate: 0 }, 'il primo giro non gioca lo storico');
  assert.ok(state.start);
  signals.push(sig(11, 'new', 'away', '2026-11-14T12:10:00Z', '2026-11-14T20:00:00Z'));
  assert.deepStrictEqual(await (require('../services/sigstore').reset(), A).runAutoplay(pool, { nowMs: NOW + 15 * 60000 }), { nuoveSimulate: 1 });
  assert.deepStrictEqual(await (require('../services/sigstore').reset(), A).runAutoplay(pool, { nowMs: NOW + 20 * 60000 }), { nuoveSimulate: 0 }, 'nessun doppione');
  I.isOceani = origO;
  console.log('giocate simulate: ok');
})().catch(e => { console.error(e); process.exit(1); });
