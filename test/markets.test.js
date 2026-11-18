// Prova di altri mercati: probabilita' giusta per mercati a 2 esiti, a 3 e doppia chance; una richiesta. Senza rete e senza database.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
Module._load = function (request) {
  if (request === 'dotenv') return { config() {} };
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  return origLoad.apply(this, arguments);
};
const M = require('../services/markets');
// handicap asiatico: Pinnacle 1,95/1,95 (giusto 2,00): snai 2,06 su HOME = +3%, netwin 1,85 = -7,5%
const ah = { event_id: 'a', market: 'ah', line: -0.5, home_team: 'A', away_team: 'B', bookmakers: [{ key: 'pinnacle', outcomes: { HOME: 1.95, AWAY: 1.95 } }, { key: 'snai', outcomes: { HOME: 2.06, AWAY: 1.8 } }, { key: 'netwin', outcomes: { HOME: 1.85, AWAY: 1.85 } }] };
let s = M.summarizeMarket([ah]);
assert.strictEqual(s.partite, 1); assert.strictEqual(s.quote, 4); assert.strictEqual(s.conVantaggio, 1); assert.strictEqual(s.esempi[0].sito, 'snai');
assert.ok(Math.abs(s.esempi[0].edgePct - 3) < 0.2);
// doppia chance: 1X 1,25 / X2 1,80 / 12 1,30 -> somma degli inversi circa 2,12: margine tolto in proporzione, probabilita' che sommano 2
const dc = { event_id: 'd', market: 'dc', home_team: 'C', away_team: 'D', bookmakers: [{ key: 'pinnacle', outcomes: { '1X': 1.25, X2: 1.8, '12': 1.3 } }, { key: 'snai', outcomes: { '1X': 1.2, X2: 1.7, '12': 1.25 } }] };
s = M.summarizeMarket([dc]);
assert.strictEqual(s.quote, 3); assert.ok(s.vantaggioMediano < 0, 'snai paga meno del giusto');
// record fuori dal 90' o senza Pinnacle: non conta
assert.strictEqual(M.summarizeMarket([{ ...ah, period: 'first_half' }]).partite, 0);
assert.strictEqual(M.summarizeMarket([{ ...ah, bookmakers: ah.bookmakers.slice(1) }]).quote, 0);
(async () => {
  let calls = 0, params = null; const http = { get: async (u, o) => { calls++; params = o.params; return { data: { odds: [ah] }, headers: {} }; } };
  const r = await M.marketCheck({ query: async () => ({ rows: [] }) }, 'ah', { ODSS_API_KEY: 'k', ODSS_BOOKS: 'snai,netwin', MY_BOOKS: 'snai' }, { http });
  assert.ok(r.ok && calls === 1 && params.market === 'ah' && /pinnacle/.test(params.bookmakers));
  assert.strictEqual((await M.marketCheck({ query: async () => ({ rows: [] }) }, 'xyz', { ODSS_API_KEY: 'k' }, { http })).ok, false); assert.strictEqual(calls, 1);
  console.log('prova di altri mercati: ok');
})().catch(e => { console.error(e); process.exit(1); });
// doppia chance dal 1X2 di Pinnacle salvato
{
  const M2 = require('../services/markets');
  assert.strictEqual(M2.dcKey('1X'), '1X'); assert.strictEqual(M2.dcKey('home_draw'), '1X'); assert.strictEqual(M2.dcKey('X2'), 'X2'); assert.strictEqual(M2.dcKey('12'), '12'); assert.strictEqual(M2.dcKey('pippo'), null);
  // Pinnacle 2,00 / 3,60 / 4,20: 1X giusto circa 1/(0,49+0,27) = 1,31; snai 1,36 = circa +3%
  const pins = new Map([['e', { pin_h: 2.0, pin_d: 3.6, pin_a: 4.2 }]]);
  const rec = { event_id: 'e', market: 'dc', home_team: 'A', away_team: 'B', bookmakers: [{ key: 'snai', outcomes: { '1X': 1.36, X2: 1.6, '12': 1.25 } }] };
  const s = M2.summarizeDC([rec], pins);
  assert.strictEqual(s.partiteConPinnacle, 1); assert.strictEqual(s.quote, 3); assert.ok(s.esempi.length >= 1 && s.esempi[0].esito === '1X');
  assert.strictEqual(M2.summarizeDC([rec], new Map()).quote, 0, 'senza 1X2 di Pinnacle non si confronta');
  console.log('doppia chance dal 1X2: ok');
}
