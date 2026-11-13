// 🧠 Cervello: gruppi, verdetti prudenti, fuori campione. Senza rete e senza database.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
Module._load = function (request) {
  if (request === 'dotenv') return { config() {} };
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  return origLoad.apply(this, arguments);
};
const B = require('../services/brain'), I = require('../services/italia');

(async () => {
  let id = 0;
  const sig = (o) => ({ id: ++id, event_id: 'e' + id, strategy: 'I', league: 'Serie A', selection: 'home', odd: 2.5, fair_prob: 0.4, edge_pct: 3,
    pin_h: 2.6, pin_d: 3.4, pin_a: 3.0, commence_time: '2026-11-14T15:00:00Z', created_at: '2026-11-13T09:00:00Z', result: 'lost', clv_pct: 1, quotes: null, ...o });

  // fasce: quota bassa e alta in gruppi diversi, margine calcolato da Pinnacle
  const f = B.featuresOf(sig({ odd: 1.8 }), I);
  assert.strictEqual(B.DIMENSIONS.find(d => d.key === 'quota').of(f), '1,50–2,00');
  assert.strictEqual(B.DIMENSIONS.find(d => d.key === 'quota').of(B.featuresOf(sig({ odd: 4.2 }), I)), '3,50–5,00');
  assert.strictEqual(B.DIMENSIONS.find(d => d.key === 'coppa').of(B.featuresOf(sig({ league: 'FA Cup' }), I)), 'coppa');
  assert.strictEqual(B.DIMENSIONS.find(d => d.key === 'giorno').of(f), 'sabato e domenica');   // 14 novembre 2026 = sabato
  assert.ok(f.margin > 1 && f.margin < 1.5);
  assert.strictEqual(B.DIMENSIONS.find(d => d.key === 'anticipo').of(f), '12–48 ore');
  console.log('fasce: ok');

  // pochi dati: sotto 30 chiuse nessun giudizio
  const few = Array.from({ length: 10 }, () => B.featuresOf(sig({ result: 'won', odd: 2.5, clv_pct: 5 }), I));
  assert.strictEqual(B.summarize(few).verdict, 'pochi');

  // forte: 40 chiuse, vinte sopra le attese e CLV sicuramente positivo
  const strong = Array.from({ length: 40 }, (_, i) => B.featuresOf(sig({ result: i < 22 ? 'won' : 'lost', clv_pct: 3 + (i % 3) }), I));
  const s = B.summarize(strong);
  assert.strictEqual(s.verdict, 'forte'); assert.ok(s.won === 22 && s.expected > 15.9 && s.expected < 16.1 && s.z > 1.5 && s.clvCi95[0] > 0);
  // debole: stesso ma al contrario
  const weak = Array.from({ length: 40 }, (_, i) => B.featuresOf(sig({ result: i < 8 ? 'won' : 'lost', clv_pct: -3 - (i % 3) }), I));
  assert.strictEqual(B.summarize(weak).verdict, 'debole');
  // segnali discordi (CLV positivo ma vinte molto sotto): non e' ne' forte ne' debole se i due non concordano su "debole"
  const mixed = Array.from({ length: 40 }, (_, i) => B.featuresOf(sig({ result: i < 16 ? 'won' : 'lost', clv_pct: i % 2 ? 6 : -6 }), I));
  assert.strictEqual(B.summarize(mixed).verdict, 'norma');
  // valore positivo ma vinte sotto le attese e saldo negativo: il solo valore non basta
  const lure = Array.from({ length: 40 }, (_, i) => B.featuresOf(sig({ result: i < 13 ? 'won' : 'lost', clv_pct: 3 + (i % 3) }), I));
  assert.strictEqual(B.summarize(lure).verdict, 'norma');
  console.log('verdetti prudenti: ok');

  // fuori campione: conta solo dal 5 novembre; i void non entrano
  const old = sig({ created_at: '2026-11-01T09:00:00Z', result: 'won' }), neu = sig({ created_at: '2026-11-08T09:00:00Z', result: 'lost' }), vd = sig({ result: 'void' });
  const br = B.buildBrain([old, neu, vd], I);
  assert.strictEqual(br.total.settled, 2);
  assert.deepStrictEqual([br.total.oos.settled, br.total.oos.won], [1, 0]);
  const quota = br.dimensions.find(d => d.key === 'quota');
  assert.strictEqual(quota.groups.length, 1); assert.strictEqual(quota.groups[0].name, '2,50–3,50');
  assert.strictEqual(br.dimensions.length, B.DIMENSIONS.length);
  console.log('fuori campione e void: ok');

  // getBrain legge dal database e non scrive
  const writes = []; const pool = { query: async (q) => { if (/^\s*(INSERT|UPDATE|DELETE)/i.test(q)) writes.push(q); return { rows: [old, neu] }; } };
  const g = await B.getBrain(pool); assert.strictEqual(g.total.settled, 2); assert.strictEqual(writes.length, 0);
  console.log('sola lettura: ok');
})().catch(e => { console.error(e); process.exit(1); });
