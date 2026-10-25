// Budget crediti The Odds API per giro (24 ottobre 2026)
const assert = require('assert');
const { runBudget, daysToReset } = require('../services/oddsApi');

const d = s => new Date(s);
assert.strictEqual(daysToReset(d('2026-10-24T09:00:00Z'), 1), 8);
assert.strictEqual(daysToReset(d('2026-11-01T09:00:00Z'), 1), 30);
assert.strictEqual(daysToReset(d('2026-11-30T23:00:00Z'), 1), 1);

// inizio mese: (500 - 60 - 4*30) / 30 / 2 = 5,33 -> 5 crediti per giro
let b = runBudget({ now: d('2026-11-01T09:00:00Z'), env: {}, remaining: 500 });
assert.strictEqual(b.budget, 5); assert.strictEqual(b.days, 30);
// un solo giro al giorno: il doppio
assert.strictEqual(runBudget({ now: d('2026-11-01T09:00:00Z'), env: { ODDS_RUNS_PER_DAY: '1' }, remaining: 500 }).budget, 10);
// crediti quasi finiti: zero, mai negativo
assert.strictEqual(runBudget({ now: d('2026-10-24T09:00:00Z'), env: {}, remaining: 8 }).budget, 0);
// spento o crediti sconosciuti: nessun limite
assert.strictEqual(runBudget({ env: { ODDS_PACING: '0' }, remaining: 500 }), null);
assert.strictEqual(runBudget({ env: {}, remaining: null }), null);
console.log('budget.test.js: tutti i controlli passati');
