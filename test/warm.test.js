// Memoria dei calcoli pesanti: peek non aspetta mai, get aspetta, un solo calcolo alla volta.
const assert = require('assert'), { memo } = require('../services/warm');
(async () => {
  let builds = 0; const m = memo(async () => { builds++; await new Promise(r => setTimeout(r, 50)); return { ok: builds }; }, 1000);
  assert.strictEqual(m.peek({}), null, 'la prima volta non aspetta: niente');
  assert.strictEqual(m.peek({}), null); await new Promise(r => setImmediate(r)); assert.strictEqual(builds, 1, 'un solo calcolo anche se chiesto due volte');
  const v = await m.get({}); assert.deepStrictEqual(v, { ok: 1 }); assert.strictEqual(builds, 1);
  assert.deepStrictEqual(m.peek({}), { ok: 1 }, 'poi e pronto subito');
  m.invalidate(); assert.strictEqual(m.ready, false);
  console.log('memoria dei calcoli: ok');
})().catch(e => { console.error(e); process.exit(1); });
