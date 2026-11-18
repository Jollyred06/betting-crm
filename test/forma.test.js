const assert = require('assert');
const { formaTest } = require('../services/forma');
// squadra A batte sempre le attese (vince sempre a quota 3): la forma deve aiutare
const rows = []; const d0 = new Date('2020-08-01');
for (let i = 0; i < 400; i++) {
  const d = new Date(d0.getTime() + i * 86400000).toISOString().slice(0, 10);
  const aHome = i % 2 === 0, opp = 'T' + (i % 7);
  rows.push({ match_date: d, league: 'X', home: aHome ? 'A' : opp, away: aHome ? opp : 'A', hg: aHome ? 1 : 0, ag: aHome ? 0 : 1, ph: 3, pd: 3.2, pa: 2.5 });
}
const r = formaTest(rows);
assert.ok(r.matches === 400 && r.best && r.best.diffPerMille < 0, 'la forma aiuta quando c\'è');
assert.strictEqual(r.verdict, 'aiuta');
// risultati a caso coerenti con Pinnacle: niente da guadagnare
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const rows2 = []; for (let i = 0; i < 3000; i++) { const u = rnd(); rows2.push({ match_date: new Date(d0.getTime() + i * 3600000).toISOString(), league: 'X', home: 'T' + (i % 20), away: 'T' + ((i + 7) % 20), hg: u < 0.45 ? 1 : 0, ag: u > 0.73 ? 1 : 0, ph: 2.2, pd: 3.5, pa: 3.6 }); }
const r2 = formaTest(rows2);
assert.ok(r2.verdict !== 'aiuta', 'sul caso non deve dire che aiuta');
console.log('forma sullo storico: ok');
