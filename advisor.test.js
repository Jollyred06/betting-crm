// Il Consigliere: niente giudizi su pochi dati, giudizio netto quando la fascia di incertezza sta tutta da una parte.
const assert = require('assert');
const { buildAdvice, summary, MIN_N } = require('../services/advisor');

const rows = (n, clv, extra = {}) => Array.from({ length: n }, (_, i) => ({ strategy: 'I', book: i % 2 ? 'Netwin' : '888sport', odd: i % 3 ? 2.0 : 3.2, selection: ['home', 'draw', 'away'][i % 3], clv_pct: String(clv + (i % 5) - 2), netwin_clv_pct: null, ...extra }));

// pochi dati: nessun giudizio, consiglio di non giocare
let adv = buildAdvice({ it: rows(5, 3) });
assert.strictEqual(adv[0].key, 'azione'); assert.ok(/non giocare/i.test(adv[0].title));
assert.ok(adv.some(x => /Strategia I/.test(x.title) && /pochi dati/.test(x.title)));

// I positiva e solida: si puo' valutare di giocare
adv = buildAdvice({ it: rows(50, 4) });
assert.ok(/valutare di giocare/i.test(adv[0].title), adv[0].title);
assert.ok(adv.some(x => x.level === 'good' && /Strategia I/.test(x.title)));
assert.ok(adv.some(x => x.key === 'libri'));
assert.ok(adv.some(x => x.key === 'fascia'));

// I negativa: non giocare
adv = buildAdvice({ it: rows(40, -5) });
assert.ok(/^Non giocare/.test(adv[0].title)); assert.ok(adv.some(x => x.level === 'bad' && /Strategia I .*non batte/.test(x.title)));

// incerto
adv = buildAdvice({ it: rows(30, 0) });
assert.ok(adv.some(x => /incerto/.test(x.title)));

// B e A giudicate separatamente; le righe B non entrano nella I
adv = buildAdvice({ it: [...rows(5, 3), ...rows(25, 3, { strategy: 'B' })], a: rows(30, 2).map(r => ({ clv_pct: r.clv_pct })) });
assert.ok(adv.some(x => /Strategia B/.test(x.title) && x.level === 'good'));
assert.ok(adv.some(x => /Strategia I/.test(x.title) && /pochi dati/.test(x.title)));
assert.ok(adv.some(x => /Strategia A/.test(x.title)));

// Netwin da solo
adv = buildAdvice({ it: rows(20, 3).map(r => ({ ...r, netwin_clv_pct: '-4' })) });
assert.ok(adv.some(x => x.key === 'netwin' && /non basta/.test(x.title)));

// selezione F con abbastanza dati decide il consiglio principale
adv = buildAdvice({ it: rows(10, 1), final: rows(25, 4) });
assert.ok(/✅ F/.test(adv[0].title), adv[0].title); assert.ok(adv.some(x => /Selezione F/.test(x.title) && x.level === 'good'));
adv = buildAdvice({ it: rows(10, 1), final: rows(25, -5) });
assert.ok(/selezione F non regge/.test(adv[0].title));

const s = summary(['1', '2', '3', null].filter(v => v !== null)); assert.strictEqual(s.n, 3); assert.strictEqual(s.mean, 2);
assert.strictEqual(MIN_N, 20);
console.log('advisor.test.js: tutti i controlli passati');
