// Over/Under 2,5: analisi, chiusura Pinnacle, esito e interruttore. Senza rete e senza database.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
Module._load = function (request) {
  if (request === 'dotenv') return { config() {} };
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  return origLoad.apply(this, arguments);
};
const { ou, noVigPower2, analyzeTotals } = require('../services/sharpSignals');
const { captureClosingOU } = require('../services/closingCapture');
const { outcomeFromScore } = require('../services/settler');
const oddsApi = require('../services/oddsApi');

(async () => {
  const bk = (key, over, under, point = 2.5, title) => ({ key, title: title || key, markets: [{ key: 'totals', outcomes: [{ name: 'Over', price: over, point }, { name: 'Under', price: under, point }] }] });

  // 1) solo la linea scelta; metodo power a 2 esiti
  assert.deepStrictEqual(ou(bk('x', 1.9, 1.95, 3.5)), null);
  assert.deepStrictEqual(ou(bk('x', 1.9, 1.95)), { over: 1.9, under: 1.95 });
  const f = noVigPower2({ over: 1.9, under: 1.95 });
  assert.ok(Math.abs(f.over + f.under - 1) < 1e-12 && f.over > 0.49 && f.over < 0.52);
  console.log('linea e metodo power a 2 esiti: ok');

  // 2) segnale tra 2% e 25%, linee diverse ignorate, niente Pinnacle = niente segnale
  const pin = bk('pinnacle', 1.9, 1.95);
  const ev = { id: 'e1', bookmakers: [pin, bk('a', 1.85, 1.9, 2.5, 'A'), bk('b', 1.86, 1.9, 2.5, 'B'), bk('c', 1.84, 1.92, 2.5, 'C')] };
  assert.strictEqual(analyzeTotals(ev).candidates.length, 0);
  const good = analyzeTotals({ ...ev, bookmakers: [...ev.bookmakers, bk('d', 2.05, 1.8, 2.5, 'D'), bk('e', 2.5, 1.5, 3.5, 'E')] });   // Over 2,05: +2.9% circa; la linea 3,5 non conta
  const c = good.candidates.find(x => x.selection === 'over');
  assert.ok(c && c.market === 'OU2.5' && c.strategy === 'A_sharp_ou' && c.bookmaker === 'D' && c.edge > 0.02 && c.edge < 0.05, JSON.stringify(c));
  assert.strictEqual(c.maxOdd, 2.05); assert.strictEqual(c.sharpOdd, 1.9);
  assert.ok(!analyzeTotals({ ...ev, bookmakers: [...ev.bookmakers.filter(b => b.key !== 'pinnacle'), bk('d', 2.05, 1.8)] }).ok);
  assert.ok(!analyzeTotals({ ...ev, bookmakers: [pin, bk('d', 2.05, 1.8)] }).candidates.length, 'servono almeno 3 bookmaker morbidi');
  console.log('analisi Over/Under: ok');

  // 3) esito
  assert.strictEqual(outcomeFromScore('over', 2, 1, 'OU2.5'), 'won'); assert.strictEqual(outcomeFromScore('over', 1, 1, 'OU2.5'), 'lost');
  assert.strictEqual(outcomeFromScore('under', 1, 1, 'OU2.5'), 'won'); assert.strictEqual(outcomeFromScore('under', 3, 0, 'OU2.5'), 'lost');
  assert.strictEqual(outcomeFromScore('home', 2, 1), 'won'); assert.strictEqual(outcomeFromScore('draw', 2, 1, '1X2'), 'lost');   // l'1X2 non cambia
  console.log('esito Over/Under: ok');

  // 4) chiusura Pinnacle sulla stessa linea
  const updates = [];
  const pool = { query: async (sql, p) => /^\s*SELECT/i.test(sql) ? { rows: [
    { id: 7, market: 'OU2.5', selection: 'over', bookmaker_odd: '2.05', quota_presa: '2.05', league_code: 'T1', odds_event_id: 'e1' },
    { id: 8, market: 'OU2.5', selection: 'under', bookmaker_odd: '1.80', quota_presa: '1.80', league_code: 'T1', odds_event_id: 'e2' }] } : (updates.push({ sql, p }), { rowCount: 1 }) };
  let asked;
  const fakeOdds = { getOddsForCompetition: async (code, opts) => { asked = opts; return [
    { id: 'e1', commence_time: new Date(Date.now() + 15 * 60000).toISOString(), bookmakers: [bk('pinnacle', 2.0, 1.85)] },
    { id: 'e2', commence_time: new Date(Date.now() + 15 * 60000).toISOString(), bookmakers: [bk('pinnacle', 1.5, 2.6, 3.5)] }] } };   // e2: Pinnacle non ha piu' la 2,5
  const r = await captureClosingOU(pool, fakeOdds);
  assert.deepStrictEqual(asked, { markets: 'totals' });
  assert.strictEqual(r.catturate, 1); assert.strictEqual(r.saltate, 1); assert.strictEqual(updates.length, 1);
  const up = updates[0].p, fair = noVigPower2({ over: 2.0, under: 1.85 }).over;
  assert.strictEqual(up[0], 7); assert.strictEqual(up[1], 2.0); assert.strictEqual(up[2], 1.85);
  assert.ok(Math.abs(up[3] - fair) < 1e-12 && Math.abs(up[4] - (2.05 * fair - 1) * 100) < 1e-9);
  console.log('chiusura Pinnacle Over/Under: ok');

  // 5) interruttore: spento di default (1 mercato), acceso = h2h + totals
  const calls = [];
  oddsApi.__setClient({ get: async (url, o) => { calls.push(o.params.markets); return { data: [], headers: { 'x-requests-used': '10', 'x-requests-remaining': '490' } }; } });
  delete process.env.TOTALS_ENABLED; await oddsApi.getOddsForCompetition('SA');
  process.env.TOTALS_ENABLED = '1'; await oddsApi.getOddsForCompetition('SA');
  await oddsApi.getOddsForCompetition('SA', { markets: 'totals' });
  assert.deepStrictEqual(calls, ['h2h', 'h2h,totals', 'totals']);
  console.log('interruttore: ok');
  console.log('TUTTI I TEST overunder OK');
})().catch(e => { console.error(e); process.exit(1); });
