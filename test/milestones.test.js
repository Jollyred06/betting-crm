// Tappe: fotografia sui PRIMI N segnali chiusi, salvata una sola volta, decisione fissata, esportazione CSV.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
Module._load = function (request) { if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } }; if (request === 'dotenv') return { config() {} }; return origLoad.apply(this, arguments); };
const ms = require('../services/milestones');
const view = require('../services/trackerView');

// segnali di prova deterministici: 320 chiusi
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
function makeRows(n, { clvShift = 0 } = {}) {
  const r = rng(11), out = [], leagues = ['T1', 'SP2', 'SA', 'E3', 'B1', 'I2'];
  for (let i = 0; i < n; i++) {
    const odd = 2.2 + r() * 7, p = 1 / odd * 0.97, won = r() < p;
    out.push({ id: i + 1, odd, status: won ? 'won' : 'lost', edge_pct: 2 + r() * 8, clv_pct: (r() - 0.5) * 24 + clvShift, est_prob: p, league_code: leagues[i % 6], selection: ['home', 'draw', 'away'][i % 3], sharp_source: i % 10 ? 'pinnacle' : 'betfair_ex_eu', n_near_best: i % 4 === 0 ? 1 : (i % 4 === 1 ? 3 : null) });
  }
  return out;
}

// --- fotografia
const rows = makeRows(100);
const snap = ms.buildSnapshot(rows, { pendingNow: 7 });
assert.strictEqual(snap.n, 100); assert.strictEqual(snap.wins, rows.filter(r => r.status === 'won').length);
assert.ok(Math.abs(snap.expectedWins - rows.reduce((t, r) => t + r.est_prob, 0)) < 0.06);                      // vittorie attese = somma delle probabilità di Pinnacle
assert.strictEqual(snap.groups.edge['2-3%'].n + snap.groups.edge['3% o più'].n, 100);
assert.strictEqual(snap.groups.tier.maggiori.n + snap.groups.tier.minori.n, 100);
assert.strictEqual(snap.groups.tier.maggiori.n, rows.filter(r => r.league_code === 'SA' || r.league_code === 'T1' || r.league_code === 'B1').length);   // SA, T1, B1 sono "maggiori"
assert.strictEqual(snap.groups.selection.casa.n + snap.groups.selection.pareggio.n + snap.groups.selection.trasferta.n, 100);
assert.strictEqual(snap.groups.odds['sotto 4'].n + snap.groups.odds['4 o più'].n, 100);
assert.ok(snap.clvCi95 && snap.clvCi95[0] < snap.avgClvPct && snap.avgClvPct < snap.clvCi95[1]); assert.ok(snap.pinnacleSharePct > 80 && snap.pinnacleSharePct < 100);
assert.strictEqual(snap.quality.pendingNow, 7);
// disponibilità della quota: più bookmaker / uno solo; quelle senza dato non finiscono in nessun gruppo
const a1 = rows.filter(r => r.n_near_best === 1).length, a3 = rows.filter(r => r.n_near_best === 3).length;
assert.strictEqual(snap.groups.avail['un solo bookmaker'].n, a1); assert.strictEqual(snap.groups.avail['più bookmaker'].n, a3);
assert.strictEqual(snap.quality.quoteRegistrate, a1 + a3); assert.ok(a1 > 0 && a3 > 0 && a1 + a3 < 100);
console.log('fotografia: ok');

// --- decisione: regola fissata
const mk = (clv, roi) => ({ clvCi95: clv, roiCi95: roi });
assert.strictEqual(ms.decide(mk(null, null)).title, 'Dati insufficienti');
assert.strictEqual(ms.decide(mk([1, 5], [-10, 20])).level, 'plausible');
assert.strictEqual(ms.decide(mk([-1, 4], [-10, 20])).level, 'none');
assert.strictEqual(ms.decide(mk([-6, -1], [-30, 5])).level, 'close');
assert.strictEqual(ms.decide(mk([1, 5], [-30, -4])).level, 'mixed');                                          // CLV positivo ma ROI chiaramente negativo
assert.ok(/non è un via libera a giocare/i.test(ms.decide(mk([1, 5], [-10, 20])).text));
assert.strictEqual(ms.RULE.fixedOn, '2026-10-01'); assert.ok(ms.RULE.lines.length === 4);
console.log('decisione: ok');

(async () => {
  // --- salvataggio: una sola volta, sui primi N, in ordine di chiusura
  const all = makeRows(320), db = { saved: [] };
  const pool = { query: async (sql, params) => {
    if (/FROM milestone_snapshots WHERE target/.test(sql)) return { rows: db.saved.filter(s => s.target === params[0]).map(() => ({})) };
    if (/COUNT\(\*\)::int AS n FROM value_bets WHERE strategy = 'A_sharp' AND status IN/.test(sql)) return { rows: [{ n: db.settled }] };
    if (/COUNT\(\*\)::int AS n FROM value_bets WHERE strategy = 'A_sharp' AND status = 'pending'/.test(sql)) return { rows: [{ n: 4 }] };
    if (/ORDER BY settled_at ASC/.test(sql)) return { rows: all.slice(0, params[0]) };
    if (/INSERT INTO milestone_snapshots/.test(sql)) { db.saved.push({ target: params[0], last: params[1], snapshot: JSON.parse(params[2]), decision: params[3] && JSON.parse(params[3]), hash: params[4], reached_at: '2026-11-12T10:00:00Z' }); return { rows: [] }; }
    if (/FROM milestone_snapshots ORDER BY/.test(sql)) return { rows: db.saved.map(s => ({ ...s, snapshot: JSON.stringify(s.snapshot), decision: s.decision && JSON.stringify(s.decision) })) };
    return { rows: [] }; } };
  db.settled = 99; assert.deepStrictEqual(await ms.checkMilestones(pool), []);                                // 99: niente
  db.settled = 108; assert.deepStrictEqual(await ms.checkMilestones(pool), [100]);                            // 108: tappa 100, calcolata sui primi 100 (non sui 108)
  assert.strictEqual(db.saved[0].snapshot.n, 100); assert.strictEqual(db.saved[0].last, 100);
  assert.deepStrictEqual(await ms.checkMilestones(pool), []);                                                // seconda volta: nessun doppione, nessuna riscrittura
  db.settled = 330; assert.deepStrictEqual(await ms.checkMilestones(pool), [200, 300]);                      // salto: entrambe le tappe, ognuna sui suoi N
  assert.deepStrictEqual(db.saved.map(s => s.snapshot.n), [100, 200, 300]); assert.strictEqual(db.saved[1].decision, null); assert.ok(db.saved[2].decision && db.saved[2].decision.level);
  // impronta: stabile se i dati sono gli stessi, diversa se qualcuno cambia un numero
  const s0 = db.saved[0]; assert.strictEqual(s0.hash, ms.hashOf(100, s0.snapshot, null));
  assert.notStrictEqual(s0.hash, ms.hashOf(100, { ...s0.snapshot, avgClvPct: s0.snapshot.avgClvPct + 1 }, null));
  console.log('salvataggio, ritardi e impronta: ok');

  // --- lettura per l'app
  const g = await ms.getMilestones(pool);
  assert.strictEqual(g.targets.length, 3); assert.ok(g.targets.every(t => t.reached && /^[0-9a-f]{10}$/.test(t.hash))); assert.strictEqual(g.targets[2].decision.level === undefined, false);
  db.saved = []; db.settled = 34; const g2 = await ms.getMilestones(pool);
  assert.deepStrictEqual(g2.targets.map(t => [t.reached, t.progress]), [[false, 34], [false, 34], [false, 34]]);   // "34 su 100" (al massimo il traguardo)
  db.settled = 150; assert.strictEqual((await ms.getMilestones(pool)).targets[0].progress, 100);
  console.log('lettura per l\'app: ok');

  // --- CSV
  const csvPool = { query: async () => ({ rows: [{ id: 1, created_at: new Date('2026-10-02T09:00:00Z'), kickoff: '2026-10-02T18:30:00Z', league_code: 'SP2', selection: 'draw', bookmaker_odd: '3.80', bookmaker_name: 'Bet "X", Co', edge_pct: '3.2', estimated_probability: '0.2750',
    sharp_source: 'pinnacle', quotes: [{ bookmaker: 'A', odd: 4 }, { bookmaker: 'B', odd: 3.9 }, { bookmaker: 'C', odd: 3.5 }], sharp_odd: '3.6', n_books: 3, n_near_best: 2, status: 'won', result_score: '1-1', closing_fair_prob: '0.2600', clv_pct: '-1.2', settled_at: null, model_version: 'sharp-v1', home: 'Almeria', away: 'Sp Gijon' }] }) };
  const csv = await view.signalsCsv(csvPool), lines = csv.split('\n');
  assert.strictEqual(lines.length, 2); assert.ok(lines[0].startsWith('id,creato,partita_inizio')); assert.strictEqual(lines[0].split(',').length, 25);
  assert.ok(lines[1].includes(',3,2,3.6,3.9,') && lines[1].includes('"[{""bookmaker"":""A""'), 'colonne delle quote complete: ' + lines[1]);
  assert.ok(lines[1].includes('"Bet ""X"", Co"') && lines[1].includes(',Pareggio,3.80,') && lines[1].includes('Segunda Division'));        // virgole e virgolette nei nomi non rompono il file
  console.log('esportazione CSV: ok');
  console.log('TUTTI I TEST milestones OK');
})().catch(e => { console.error(e); process.exit(1); });
