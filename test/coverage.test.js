const assert = require('assert');
const { matchHist } = require('../services/coverage');
const { sameTeam } = require('../services/italia');
const watch = [{ event_id: 'a', home: 'Manchester United', away: 'Chelsea FC', commence_time: '2026-11-15T15:00:00Z' },
  { event_id: 'b', home: 'Real Sociedad', away: 'Sevilla', commence_time: '2026-11-15T20:00:00Z' },
  { event_id: 'c', home: 'Unknown Town', away: 'Nowhere FC', commence_time: '2026-11-15T15:00:00Z' }];
const hist = [{ match_date: '2026-11-15', home: 'Man United', away: 'Chelsea', hg: 2, ag: 1 }, { match_date: '2026-11-16', home: 'Sociedad', away: 'Sevilla', hg: 0, ag: 0 }];
const m = matchHist(watch, hist, sameTeam);
const by = Object.fromEntries(m.map(x => [x.event_id, x.score]));
assert.strictEqual(by.b, '0-0', 'giorno dopo e nome corto');
assert.ok(!by.a || by.a === '2-1');
assert.ok(!by.c, 'partita non nello storico');
console.log('risultati dallo storico: ok', JSON.stringify(by));
