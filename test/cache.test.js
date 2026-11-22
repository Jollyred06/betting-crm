// 22/11: copia vecchia subito + ricalcolo in sottofondo
const assert = require('assert'), express = require('express'), http = require('http');
const app = express(); let calls = 0;
const server = app.listen(0, async () => {
  process.env.PORT = server.address().port;
  const cache = require('../services/cache');
  app.use('/api/x', cache.middleware(50));
  app.get('/api/x/a', async (req, res) => { calls++; await new Promise(r => setTimeout(r, 300)); res.json({ v: calls, pad: 'x'.repeat(10) }); });
  const get = () => new Promise((ok, ko) => { const t0 = Date.now(); http.get({ host: '127.0.0.1', port: process.env.PORT, path: '/api/x/a' }, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => ok({ d: JSON.parse(s), ms: Date.now() - t0 })); }).on('error', ko); });
  try {
    const a = await get(); assert.strictEqual(a.d.v, 1); assert.ok(a.ms >= 290, 'la prima si calcola');
    const b = await get(); assert.strictEqual(b.d.v, 1); assert.ok(b.ms < 100, 'copia fresca subito');
    await new Promise(r => setTimeout(r, 80));
    const c = await get(); assert.strictEqual(c.d.v, 1, 'scaduta: si manda la vecchia'); assert.ok(c.ms < 100, 'subito: ' + c.ms);
    await new Promise(r => setTimeout(r, 450));
    assert.strictEqual(calls, 2, 'intanto rifatta in sottofondo');
    const d = await get(); assert.strictEqual(d.d.v, 2, 'la nuova'); 
    cache.clear(); const e = await get(); assert.strictEqual(e.d.v, 3); assert.ok(e.ms >= 290, 'dopo un salvataggio si ricalcola');
    console.log('cache: copia vecchia subito e ricalcolo in sottofondo ok', cache.stats());
  } catch (err) { console.error(err); process.exitCode = 1; }
  server.close(); setTimeout(() => process.exit(process.exitCode || 0), 50);
});
