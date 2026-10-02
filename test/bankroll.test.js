// Bankroll di carta nell'app: saldo, curva, calo massimo, separazione tra movimenti dei segnali e manuali.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
Module._load = function (request) { if (request === 'dotenv') return { config() {} }; if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } }; return origLoad.apply(this, arguments); };
const view = require('../services/trackerView');

const row = (id, bet, amount, bal, note, day) => ({ id, bet_id: bet, amount: String(amount), balance_after: String(bal), note, created_at: `2026-10-0${day}T10:00:00Z` });
const pool = rows => ({ query: async sql => { assert.ok(/FROM bankroll_log ORDER BY created_at ASC/.test(sql)); return { rows }; } });

(async () => {
  // partenza 100, deposito di prova +10, poi quattro segnali chiusi a puntata fissa: +6, -2, -2, +3
  const rows = [row(1, null, 10, 110, 'Deposito manuale', 1), row(2, 11, 6, 116, 'Esito automatico: won', 2), row(3, 12, -2, 114, 'Esito automatico: lost', 3), row(4, 13, -2, 112, 'Esito automatico: lost', 4), row(5, 14, 3, 115, 'Esito automatico: won', 5)];
  const b = await view.getBankroll(pool(rows), { INITIAL_BANKROLL: '100' });
  assert.strictEqual(b.balance, 115); assert.strictEqual(b.start, 100);                                   // il saldo iniziale e' quello PRIMA del primo movimento
  assert.strictEqual(b.signalsProfit, 5); assert.strictEqual(b.signalsCount, 4); assert.strictEqual(b.netManual, 10);   // segnali e deposito manuale restano separati
  assert.strictEqual(b.peak, 116);
  assert.ok(Math.abs(b.drawdownPct - Math.round(((116 - 112) / 116) * 1000) / 10) < 0.01, 'calo massimo ' + b.drawdownPct);   // da 116 a 112
  assert.deepStrictEqual(b.series.map(p => p.b), [100, 110, 116, 114, 112, 115]);
  assert.strictEqual(b.movements[0].note, 'Esito automatico: won'); assert.strictEqual(b.movements[0].manual, false);        // dal piu' recente
  assert.strictEqual(b.movements[b.movements.length - 1].manual, true);
  console.log('saldo, curva e calo massimo: ok');

  // nessun movimento: parte dal bankroll iniziale, nessun dato inventato
  const e = await view.getBankroll(pool([]), { INITIAL_BANKROLL: '100' });
  assert.strictEqual(e.balance, 100); assert.strictEqual(e.signalsCount, 0); assert.strictEqual(e.drawdownPct, 0); assert.strictEqual(e.series.length, 1); assert.deepStrictEqual(e.movements, []);
  // prelievo: l'importo negativo manuale non e' un segnale
  const w = await view.getBankroll(pool([row(1, null, -30, 70, 'Prelievo manuale', 1)]), { INITIAL_BANKROLL: '100' });
  assert.strictEqual(w.balance, 70); assert.strictEqual(w.netManual, -30); assert.strictEqual(w.signalsProfit, 0); assert.strictEqual(w.start, 100);
  console.log('casi limite (vuoto, prelievo): ok');

  // molti movimenti: al massimo ~150 punti da disegnare, ultimo punto sempre presente, al massimo 15 movimenti elencati
  const many = Array.from({ length: 700 }, (_, i) => row(i + 1, i + 1, i % 3 ? -2 : 6, 100 + i, 'x', 1));
  const m = await view.getBankroll(pool(many), { INITIAL_BANKROLL: '100' });
  assert.ok(m.series.length <= 160); assert.strictEqual(m.series[m.series.length - 1].b, 799); assert.strictEqual(m.movements.length, 15);
  console.log('molti movimenti: ok');
  console.log('TUTTI I TEST bankroll OK');
})().catch(e => { console.error(e); process.exit(1); });
