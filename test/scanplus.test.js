// Scansioni ogni 2 ore (16/11/2026) con paracadute: se alla ricarica resterebbero meno di 30 richieste, si torna agli orari di base.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
Module._load = function (request) {
  if (request === 'dotenv') return { config() {} };
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  return origLoad.apply(this, arguments);
};
const I = require('../services/italia');
const c = I.cfg({ ODSS_API_KEY: 'x' });
assert.deepStrictEqual(c.scanHours, [9, 12, 15, 18, 21]); assert.deepStrictEqual(c.scanHoursPlus, [9, 11, 13, 15, 17, 19, 21]); assert.ok(c.scanPlus);
const mk = rem => hours => ({ ...I.planScans({ remaining: rem, daysLeft: 26, closesPerDay: 4, hours, maxReserve: 60 }) });
// 435 rimaste, 26 giorni: con 7 scansioni + 5 chiusure = 12 al giorno -> 435 - 312 = 123 >= riserva: ogni 2 ore
const a = I.choosePlan(mk(435), c);
assert.ok(a.plus && a.hours.length === 7 && a.leftAtReset >= 30, JSON.stringify(a));
// 330 rimaste: con 7 -> 330 - 312 = 18 < 30: paracadute, si torna a 5
const b = I.choosePlan(mk(330), c);
assert.ok(!b.plus && b.hours.length === 5 && /riserva/.test(b.fallback));
assert.ok(!I.choosePlan(mk(435), { ...c, scanPlus: false }).plus, 'spento da Render');
assert.ok(!I.cfg({ ITALIA_SCAN_PLUS: 'false' }).scanPlus);
console.log('scansioni ogni 2 ore con paracadute: ok');
