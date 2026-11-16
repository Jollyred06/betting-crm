// Priorita' delle chiusure (16/11/2026): ordine, chi fa partire la richiesta, divisione in richieste. Senza rete e senza database.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
Module._load = function (request) {
  if (request === 'dotenv') return { config() {} };
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  return origLoad.apply(this, arguments);
};
const I = require('../services/italia');
// tre tipi di segnale: Coppa (membro in campo), giocato senza gruppo, nessun gruppo
const cup = { id: 1, event_id: 'c', strategy: 'I', league: 'FA Cup', selection: 'home', odd: 2.6, edge_pct: 3, pin_h: 2.5, pin_d: 3.3, pin_a: 2.9, commence_time: '2026-11-17T20:00:00Z' };
const played = { id: 2, event_id: 'p', strategy: 'I', league: 'Serie D', selection: 'home', odd: 1.7, edge_pct: 2.5, pin_h: 1.7, pin_d: 3.6, pin_a: 4.4, commence_time: '2026-11-17T19:00:00Z' };
const other = { id: 3, event_id: 'o', strategy: 'I', league: 'Serie D', selection: 'home', odd: 1.7, edge_pct: 2.5, pin_h: 1.7, pin_d: 3.6, pin_a: 4.4, commence_time: '2026-11-17T18:00:00Z' };
const opts = { team: { oceani: true, prova: true, coppe: true }, playedIds: new Set([2]) };
assert.strictEqual(I.closeTier(cup, opts), 1); assert.strictEqual(I.closeTier(played, opts), 2); assert.strictEqual(I.closeTier(other, opts), 4);
assert.strictEqual(I.closeTier(cup, { team: { coppe: false, prova: false, oceani: false }, playedIds: new Set() }), 3, 'Coppe in panchina: resta misurata ma non come membro in campo');
const { ranked, batches } = I.closeBatches([other, played, cup], opts);
assert.deepStrictEqual(ranked.map(x => x.r.id), [1, 2, 3], 'ordine: membri, giocate, altri (anche se gli altri iniziano prima)');
assert.strictEqual(batches.length, 1); assert.deepStrictEqual(batches[0].events, ['c', 'p', 'o'], 'gli altri salgono gratis sulla stessa richiesta');
// solo "altri": nessuna richiesta
assert.strictEqual(I.closeBatches([other], opts).batches.length, 0);
// tante partite: richieste da 40, quelle con solo "altri" non partono
const many = Array.from({ length: 90 }, (_, i) => ({ ...other, id: 100 + i, event_id: 'x' + i }));
const b2 = I.closeBatches([cup, ...many], opts).batches;
assert.strictEqual(b2.length, 1, 'la seconda e terza richiesta (solo altri) non partono'); assert.strictEqual(b2[0].events.length, I.CLOSE_MAX_EVENTS); assert.strictEqual(b2[0].events[0], 'c');
console.log('priorita delle chiusure: ok');
