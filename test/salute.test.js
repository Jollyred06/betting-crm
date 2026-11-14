// Controllo di salute: cosa conta come problema. Senza rete.
const assert = require('assert');
const { evaluate } = require('../scripts/salute');
const ok = { status: { status: 'ok' }, credits: { items: [{ name: 'odss', level: 'ok' }] }, advice: { advice: [{ level: 'good', title: 'x' }] } };
const t = (h) => Date.parse(`2026-11-14T${String(h - 1).padStart(2, '0')}:30:00Z`);   // ora italiana h:30 in inverno
const recent = h => ({ lastRequest: { at: new Date(t(h) - 40 * 60000).toISOString(), ok: true } });

assert.deepStrictEqual(evaluate({ ...ok, italia: recent(15) }, t(15)), []);
assert.strictEqual(evaluate({}, t(15)).length, 1);                                                          // server giu'
assert.strictEqual(evaluate({ ...ok, status: { status: 'x' } }, t(15)).length, 1);
let p = evaluate({ ...ok, credits: { items: [{ name: 'odss', level: 'bad', text: 'finiti' }] }, italia: recent(15) }, t(15));
assert.ok(p.length === 1 && /odss/.test(p[0]));                                                              // crediti finiti
p = evaluate({ ...ok, advice: { advice: [{ level: 'bad', title: 'A' }, { level: 'bad', title: 'B' }, { level: 'bad', title: 'C' }] }, italia: recent(15) }, t(15));
assert.strictEqual(p.length, 2);                                                                              // al massimo 2 avvisi
// scansione ferma: segnalata solo di giorno (12-22 ora italiana)
const old = { lastRequest: { at: new Date(t(15) - 7 * 3600000).toISOString(), ok: true } };
assert.ok(evaluate({ ...ok, italia: old }, t(15)).some(x => /scansione/.test(x)));
assert.deepStrictEqual(evaluate({ ...ok, italia: old }, t(4)), []);                                          // di notte e' normale
assert.ok(evaluate({ ...ok, italia: { lastRequest: { at: new Date(t(15)).toISOString(), ok: false, note: 'errore' } } }, t(15)).some(x => /fallita/.test(x)));
console.log('controllo di salute: ok');
