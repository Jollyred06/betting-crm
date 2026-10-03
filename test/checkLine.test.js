// Le righe CONTROLLO del Log: informative, non cambiano i segnali.
const assert = require('assert');
// librerie esterne e database non servono: si sostituiscono (come negli altri test)
const Module = require('module'), origLoad = Module._load;
Module._load = function (request) {
  if (request === 'axios') { const c = { get: async () => ({ data: [] }), post: async () => ({}), interceptors: { request: { use() {} }, response: { use() {} } }, defaults: { headers: {} } }; return { ...c, create: () => c }; }
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'dotenv') return { config() {} };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  return origLoad.apply(this, arguments);
};
const { checkLine } = require('../services/orchestrator');
const { analyzeEvent } = require('../services/sharpSignals');
const bk = (key, h, d, a, t) => ({ key, title: t || key, markets: [{ key: 'h2h', outcomes: [{ name: 'A', price: h }, { name: 'Draw', price: d }, { name: 'B', price: a }] }] });
const ev = { home_team: 'A', away_team: 'B', bookmakers: [bk('pinnacle', 2.0, 3.5, 3.8), bk('x', 1.95, 3.4, 3.9, 'X'), bk('y', 1.95, 3.4, 3.85, 'Y'), bk('z', 1.98, 3.4, 3.88, 'Z')] };
let a = analyzeEvent(ev, { minEdge: 0.02, maxEdge: 0.15 });
let l = checkLine('A vs B', 'SP2', a, 0.02, 0.15);
assert.ok(/^CONTROLLO A vs B \(SP2\): miglior vantaggio -3\.7%.*sotto soglia\.$/.test(l), l);
const good = analyzeEvent({ ...ev, bookmakers: [bk('pinnacle', 2.0, 3.5, 3.8), bk('x', 1.95, 3.4, 4.3, 'X'), bk('y', 1.95, 3.4, 4.2, 'Y'), bk('z', 1.98, 3.4, 4.25, 'Z')] }, { minEdge: 0.02, maxEdge: 0.15 });
l = checkLine('A vs B', 'SP2', good, 0.02, 0.15);
assert.ok(/vittoria trasferta \(2\)/.test(l) && /SEGNALE\.$/.test(l) && good.candidates.length === 1, l);
assert.ok(/non valutabile/.test(checkLine('A vs B', 'SP2', { top: null }, 0.02, 0.15)));
console.log('righe CONTROLLO: ok');
