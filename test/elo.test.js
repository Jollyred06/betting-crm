// 💪 Elo: la squadra che vince sale, la differenza di forza diventa 1 X 2, ricerca delle squadre. Senza rete e senza database.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
Module._load = function (request) {
  if (request === 'dotenv') return { config() {} };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  return origLoad.apply(this, arguments);
};
const E = require('../services/elo'), O = require('../services/opinion'), I = require('../services/italia');
// 4 squadre, 3 stagioni: Forte vince quasi sempre, Debole perde quasi sempre
const teams = ['Forte', 'Media', 'Altra', 'Debole'], rows = [];
let d = Date.parse('2022-08-01');
for (let r = 0; r < 60; r++) for (const h of teams) for (const a of teams) if (h !== a) {
  const sh = teams.indexOf(h), sa = teams.indexOf(a), hg = sh < sa ? 2 : sh === sa ? 1 : (r % 3 === 0 ? 1 : 0), ag = sh < sa ? (r % 4 === 0 ? 2 : 0) : 1;
  rows.push({ league: 'XX', match_date: new Date(d += 86400000).toISOString().slice(0, 10), home: h, away: a, hg, ag });
}
const m = E.buildElo(rows);
assert.ok(m.ratings.get('XX|Forte') > m.ratings.get('XX|Media') && m.ratings.get('XX|Media') > m.ratings.get('XX|Debole'), 'ordine di forza giusto');
const p1 = E.probsFromDiff(m, 300), p2 = E.probsFromDiff(m, -300);
assert.ok(p1.home > p2.home && p2.away > p1.away, 'piu forza in casa = piu 1');
assert.ok(Math.abs(p1.home + p1.draw + p1.away - 1) < 1e-9);
const idx = O.teamIndex(teams.map(t => ({ league: 'XX', team: t + ' United' })));
const m2 = E.buildElo(rows.map(r => ({ ...r, home: r.home + ' United', away: r.away + ' United' })));
const pr = E.eloProbs(m2, idx, 'Forte United', 'Debole United', { leagueOf: O.leagueOf, sameTeam: I.sameTeam, cache: new Map() });
assert.ok(pr && pr.home > 0.5 && pr.league === 'XX', 'trova le squadre e dice 1');
assert.strictEqual(E.eloProbs(m2, idx, 'Sconosciuta', 'Ignota', { leagueOf: O.leagueOf, sameTeam: I.sameTeam, cache: new Map() }), null);
// l'IA con l'esperto forza: se la forza indovina sempre, il suo peso sale
const G = require('../services/guess');
const pq = (h, dd, a) => { const g = G.guessOf(h, dd, a); return { home: g.probs['1'], draw: g.probs.X, away: g.probs['2'] }; };
const evs = Array.from({ length: 60 }, (_, i) => ({ id: 'e' + i, t: i, f: pq(2.6, 3.3, 2.8), l: pq(2.6, 3.3, 2.8), out: 'away', elo: { home: 0.2, draw: 0.2, away: 0.6 } }));
const L = G.learn(evs, null, null);
assert.ok(L.weights.forza > 0.9, 'la forza delle squadre prende quasi tutta la fiducia'); assert.strictEqual(L.withElo, 60);
console.log('forza delle squadre (Elo): ok');
