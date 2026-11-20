const assert = require('assert');
const S = require('../services/sicure');
const rows = [{ pin_h: 1.2, pin_d: 7, pin_a: 13, result_score: '2-0' }, { pin_h: 1.25, pin_d: 6, pin_a: 11, result_score: '1-1' }, { pin_h: 2.5, pin_d: 3.2, pin_a: 2.9, result_score: '0-1' }, { pin_h: 1.6, pin_d: 4, pin_a: 5.5, result_score: '3-1' }];
const t = Object.fromEntries(S.tierStats(rows).map(x => [x.key, x]));
assert.strictEqual(t.top.n, 2); assert.strictEqual(t.top.hit, 1);
assert.strictEqual(t.aperta.n, 1); assert.strictEqual(t.aperta.hit, 0);
assert.strictEqual(t.media.n, 1); assert.strictEqual(t.media.hit, 1);
// in arrivo: ordinate per fiducia, l'IA se c'e' decide pronostico e fiducia
const next = [{ event_id: 'a', home: 'A', away: 'B', pin_h: 2.5, pin_d: 3.2, pin_a: 2.9 }, { event_id: 'b', home: 'C', away: 'D', pin_h: 1.2, pin_d: 7, pin_a: 13 }];
const u = S.upcoming(next, new Map());
assert.strictEqual(u[0].event, 'b'); assert.strictEqual(u[0].pick, '1'); assert.strictEqual(u[0].src, 'pinnacle');
const u2 = S.upcoming(next, new Map(), () => ({ pick: '2', prob: 0.9 }));
assert.strictEqual(u2[0].pick, '2'); assert.strictEqual(u2[0].src, 'ia');
assert.strictEqual(S.upcoming([{ event_id: 'x', pin_h: null }], new Map()).length, 0);
console.log('le piu sicure: ok');
