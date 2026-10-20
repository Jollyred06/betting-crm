// Il CRM che impara: restringimento dei gruppi piccoli, prova a ritroso senza barare, nessuna promozione su pochi dati.
const assert = require('assert');
const L = require('../services/learner');

const T0 = Date.parse('2026-10-01T10:00:00Z');
const sig = (i, o = {}) => ({ id: i, strategy: 'I', selection: 'home', odd: 2.0, edge_pct: 3,
  created_at: new Date(T0 + i * 3 * 3600000).toISOString(), commence_time: new Date(T0 + i * 3 * 3600000 + 2 * 3600000).toISOString(), clv_pct: 1, ...o });

// pochi dati: non giudica
assert.strictEqual(L.buildLearning([sig(1), sig(2)]).ready, false);

// 200 segnali: quelli con vantaggio 4-6% valgono +6, gli altri 0 (con un po' di rumore)
const rows = Array.from({ length: 200 }, (_, i) => i % 4 === 0 ? sig(i, { edge_pct: 5, clv_pct: 6 + (i % 3) - 1 }) : sig(i, { edge_pct: 2.5, clv_pct: (i % 5) - 2 }));
const out = L.buildLearning(rows, T0 + 1000 * 3600000);
assert.strictEqual(out.ready, true);
const v = out.learned.find(f => f.key === 'vantaggio').levels;
assert.strictEqual(v[0].level, '4–6%'); assert.ok(v[0].effect > 2, 'impara che il 4-6% vale di piu');
// il restringimento: l'effetto stimato e' piu' piccolo di quello grezzo
assert.ok(Math.abs(v[0].effect) < Math.abs(v[0].raw));
// prova a ritroso: le scelte battono gli scartati e la differenza viene riconosciuta
assert.ok(out.test.judged > 100); assert.ok(out.test.picked.mean > out.test.skipped.mean + 3); assert.strictEqual(out.test.proven, true);

// un gruppo di 3 segnali fortunati non sposta quasi niente
const lucky = Array.from({ length: 100 }, (_, i) => sig(i, { clv_pct: (i % 5) - 2 })).concat([sig(200, { selection: 'draw', clv_pct: 30 }), sig(201, { selection: 'draw', clv_pct: 30 }), sig(202, { selection: 'draw', clv_pct: 30 })]);
const m = L.fit(lucky);
assert.ok(m.effects.esito.pareggio.shrunk < m.effects.esito.pareggio.raw / 5, 'tre colpi di fortuna pesano poco');

// rumore puro: nessuna promozione
const noise = Array.from({ length: 200 }, (_, i) => sig(i, { edge_pct: 2 + (i % 5), selection: ['home', 'draw', 'away'][i % 3], clv_pct: ((i * 7919) % 13) - 6 }));
assert.strictEqual(L.buildLearning(noise).test.proven, false);
console.log('learner.test.js: tutti i controlli passati');
