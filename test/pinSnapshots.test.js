// Fotografie delle quote: salva una lettura per partita, rispetta l'intervallo minimo, non lancia mai.
const assert = require('assert');
const { saveSnapshot, compactQuotes } = require('../services/pinSnapshots');
const bk = (key, h, d, a) => ({ key, markets: [{ key: 'h2h', outcomes: [{ name: 'Casa', price: h }, { name: 'Draw', price: d }, { name: 'Fuori', price: a }] }] });
const ev = { id: 'e1', home_team: 'Casa', away_team: 'Fuori', commence_time: '2026-10-12T15:00:00Z', bookmakers: [bk('pinnacle', 2.0, 3.5, 3.8), bk('betsson', 1.9, 3.4, 4.0)] };
(async () => {
  assert.deepStrictEqual(compactQuotes(ev), { pinnacle: [2.0, 3.5, 3.8], betsson: [1.9, 3.4, 4.0] });
  const calls = [];
  const pool = { query: async (sql, p) => { calls.push({ sql, p }); return { rowCount: /INSERT/.test(sql) ? 1 : 0, rows: [] }; } };
  assert.strictEqual(await saveSnapshot(pool, ev, 'SA', 'giro'), true);
  const ins = calls.find(c => /INSERT INTO pin_snapshots/.test(c.sql));
  assert.ok(ins && ins.p[0] === 'e1' && ins.p[6] === 2.0 && ins.p[10] === 8);
  assert.strictEqual(await saveSnapshot(pool, ev, 'SA', 'chiusura'), true);
  assert.strictEqual(calls.filter(c => /INSERT/.test(c.sql)).pop().p[10], 25);
  // senza quote o con errore del database: nessuna eccezione, risultato false
  assert.strictEqual(await saveSnapshot(pool, { id: 'x', bookmakers: [] }, 'SA', 'giro'), false);
  assert.strictEqual(await saveSnapshot({ query: async () => { throw new Error('db giu'); } }, ev, 'SA', 'giro'), false);
  assert.strictEqual(await saveSnapshot(pool, null, 'SA', 'giro'), false);
  console.log('TUTTI I TEST pinSnapshots OK');
})();
