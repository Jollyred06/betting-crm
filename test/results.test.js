// Risultati automatici (API-Football): esito 1X2 sui 90 minuti, abbinamento prudente, errori del piano leggibili.
const assert = require('assert');
const R = require('../services/results');
const { sameTeam } = require('../services/italia');

assert.strictEqual(R.outcome('home', 2, 1), 'won'); assert.strictEqual(R.outcome('draw', 1, 1), 'won'); assert.strictEqual(R.outcome('away', 2, 1), 'lost');

const fx = (id, date, home, away, st, h, a, ftH = h, ftA = a) => ({ fixture: { id, date, status: { short: st } }, teams: { home: { name: home }, away: { name: away } }, goals: { home: h, away: a }, score: { fulltime: { home: ftH, away: ftA } } });
const sig = { id: 1, home: 'Lincoln City', away: 'West Ham United', selection: 'home', commence_time: '2026-10-17T19:00:00Z', odd: '2.5' };
const list = [fx(10, '2026-10-17T19:00:00+00:00', 'Lincoln', 'West Ham', 'FT', 2, 0), fx(11, '2026-10-17T19:00:00+00:00', 'Inter', 'Roma', 'FT', 1, 1)];
const m = R.matchFixture(sig, list, sameTeam);
assert.strictEqual(m.fixture.id, 10);
assert.deepStrictEqual(R.settle(sig, m), { result: 'won', score: '2-0' });
// orario troppo lontano o squadre diverse: niente abbinamento
assert.strictEqual(R.matchFixture({ ...sig, commence_time: '2026-10-17T21:00:00Z' }, list, sameTeam), null);
assert.strictEqual(R.matchFixture({ ...sig, home: 'Inter U23', away: 'Roma U23' }, list, sameTeam), null);
// supplementari: conta il risultato dei 90 minuti
assert.deepStrictEqual(R.settle({ ...sig, selection: 'draw' }, fx(12, sig.commence_time, 'A', 'B', 'AET', 2, 1, 1, 1)), { result: 'won', score: '1-1' });
// in corso: non si chiude; rinviata: annullata
assert.strictEqual(R.settle(sig, fx(13, sig.commence_time, 'A', 'B', '2H', 1, 0)), null);
assert.strictEqual(R.settle(sig, fx(14, sig.commence_time, 'A', 'B', 'PST', null, null)).result, 'void');
// errori del piano gratuito
assert.ok(/season/.test(R.apiError({ errors: { plan: 'Free plans do not have access to this season, try from 2022 to 2024.' } })));
assert.strictEqual(R.apiError({ errors: [] }), null); assert.strictEqual(R.apiError({ errors: {} }), null);
// saldo di carta: vinte e perse, i void non contano
const st = R.resultStats([{ result: 'won', odd: '2.5' }, { result: 'lost', odd: '3' }, { result: 'void', odd: '2' }, { result: null, odd: '2' }]);
assert.strictEqual(st.settled, 2); assert.strictEqual(st.won, 1); assert.ok(Math.abs(st.pnlEur - 1) < 1e-9);
// chiave copiata con spazi o virgolette
assert.strictEqual(R.rcfg({ APIFOOTBALL_KEY: ' "abc" ' }).key, 'abc');
console.log('results.test.js: tutti i controlli passati');
