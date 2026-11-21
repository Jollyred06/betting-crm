const assert = require('assert');
const { agreesWithFav } = require('../services/italia');
assert.strictEqual(agreesWithFav({ pin_h: 1.8, pin_d: 3.6, pin_a: 4.5, selection: 'home' }), true);
assert.strictEqual(agreesWithFav({ pin_h: 1.8, pin_d: 3.6, pin_a: 4.5, selection: 'away' }), false);
assert.strictEqual(agreesWithFav({ pin_h: 4.5, pin_d: 3.6, pin_a: 1.8, selection: 'away' }), true);
assert.strictEqual(agreesWithFav({ pin_h: null, pin_d: 3.6, pin_a: 1.8, selection: 'away' }), false, 'senza quote non e\' d\'accordo');
console.log('pronostico e quota d\'accordo: ok');
