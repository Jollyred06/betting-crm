// Secondo parere: campionato dalle squadre, probabilita' corretta, verdetto, riepilogo. Senza rete e senza database vero.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
Module._load = function (request) {
  if (request === 'dotenv') return { config() {} };
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  return origLoad.apply(this, arguments);
};
const O = require('../services/opinion'), C = require('../services/calib'), I = require('../services/italia'), B = require('../services/brain');
(async () => {
  const idx = O.teamIndex([{ league: 'PL', team: 'Manchester United' }, { league: 'PL', team: 'Liverpool' }, { league: 'SA', team: 'Juventus' }, { league: 'SA', team: 'Inter' }, { league: 'E1', team: 'Leeds' }]);
  assert.strictEqual(O.leagueOf(idx, 'Manchester United', 'Liverpool FC', I.sameTeam), 'PL');
  assert.strictEqual(O.leagueOf(idx, 'Juventus', 'Liverpool', I.sameTeam), null, 'squadre di campionati diversi: nessun campionato');
  assert.strictEqual(O.leagueOf(idx, 'Squadra Sconosciuta', 'Altra Sconosciuta', I.sameTeam), null);
  // taratura: in fascia 35-50% la casa vince 5 punti MENO di quanto dice Pinnacle
  const mk = (n, win) => Array.from({ length: n }, (_, i) => ({ league: 'PL', hg: i < win ? 1 : 0, ag: i < win ? 0 : 1, ph: 2.2, pd: 50, pa: 2.2 }));
  const cal = C.calibrate(mk(1000, 450));      // Pinnacle dice ~49%, esce 45%
  const sig = { fair_prob: 0.45, odd: 2.30, selection: 'home' };      // vantaggio dichiarato +3,5%
  const op = O.opinionOf(cal, 'PL', sig);
  assert.ok(op && op.shiftPts < 0 && op.edgeAdj < 3.5, 'probabilita corretta verso il basso');
  assert.ok(['dubbio', 'contraddice'].includes(op.verdict));
  assert.strictEqual(O.opinionOf(cal, 'PL', { fair_prob: 0.5, odd: 3, selection: 'home' }).verdict, 'conferma', 'vantaggio enorme: resta confermato');
  assert.strictEqual(O.opinionOf(null, 'PL', sig), null); assert.strictEqual(O.opinionOf(cal, null, { fair_prob: 0.45, odd: 2.3, selection: 'x' }), null);
  // riepilogo per verdetto
  const f = (v, res) => ({ op: v ? { verdict: v } : null, result: res, p: 0.4, odd: 2.5, clv: null, created: Date.parse('2026-11-10') });
  const s = O.summarizeByVerdict([f('conferma', 'won'), f('conferma', 'lost'), f('contraddice', 'lost'), f(null, 'won')], B.summarize);
  assert.strictEqual(s.conferma.settled, 2); assert.strictEqual(s.contraddice.settled, 1); assert.strictEqual(s.dubbio.settled, 0); assert.strictEqual(s.senza.settled, 1);
  // senza storico: non pronto
  const pool = { query: async sql => /CREATE/.test(sql) ? { rows: [] } : { rows: [] } };
  assert.deepStrictEqual(await O.getOpinions(pool, { force: true }), { ready: false });
  console.log('secondo parere: ok');
})().catch(e => { console.error(e); process.exit(1); });
