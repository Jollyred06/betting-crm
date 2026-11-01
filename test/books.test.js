// 📊 Bookmaker: parte pura (giudizio per sito, avvisi)
const assert = require('assert');
const { buildBooks, verdictOf, band } = require('../services/books');
const NOW = Date.parse('2026-11-01T10:00:00Z');
const at = d => new Date(NOW - d * 86400000).toISOString();
const rows = [];
let id = 1;
// 888sport (mio): 25 segnali misurati, valore positivo stabile
for (let i = 0; i < 25; i++) rows.push({ id: id++, event_id: 'a' + i, selection: 'home', phase: 'near', strategy: 'I', book: '888sport_it', created_at: at(10 - i * 0.3), odd: 2, fair_prob: 0.52, edge_pct: 4, clv_pct: 3 + (i % 3), result: i % 2 ? 'won' : 'lost' });
// la stessa occasione anche nella T: non si conta due volte
rows.push({ ...rows[0], id: id++, strategy: 'T' });
// fastbet (non mio): 22 segnali, valore piu' alto, recenti
for (let i = 0; i < 22; i++) rows.push({ id: id++, event_id: 'f' + i, selection: 'away', phase: 'near', strategy: 'T', book: 'fastbet', created_at: at(i * 0.5), odd: 2.5, fair_prob: 0.42, edge_pct: 5, clv_pct: 6 + (i % 2), result: null });
// eurobet: pochi
rows.push({ id: id++, event_id: 'e1', selection: 'draw', phase: 'far', strategy: 'I', book: 'eurobet', created_at: at(2), odd: 3.4, fair_prob: 0.3, edge_pct: 2, clv_pct: -1, result: 'lost' });
const B = buildBooks(rows, { my: ['888sport_it', 'snai'], names: { '888sport_it': '888sport', fastbet: 'Fastbet' }, nowMs: NOW });
const s888 = B.books.find(b => b.key === '888sport_it'), fb = B.books.find(b => b.key === 'fastbet'), eu = B.books.find(b => b.key === 'eurobet');
assert.strictEqual(s888.signals, 25); assert.strictEqual(s888.mine, true); assert.strictEqual(s888.verdict, 'ok');
assert.strictEqual(fb.verdict, 'ok'); assert.strictEqual(eu.verdict, 'pochi');
assert.strictEqual(B.books[0].key, '888sport_it');          // prima i miei siti
assert.ok(Math.abs(s888.pnlEur - (12 * 2 - 13 * 2)) < 1e-9);  // 12 vinte a quota 2, 13 perse
assert.ok(B.alerts.some(a => a.kind === 'apri' && a.book === 'Fastbet'));
assert.strictEqual(B.missed14, 23);
// sito in calo: ultimi 30 segnali sotto zero
const bad = []; for (let i = 0; i < 30; i++) bad.push({ id: 1000 + i, event_id: 'b' + i, selection: 'home', strategy: 'I', book: 'snai', created_at: at(5 - i * 0.1), odd: 2, fair_prob: 0.5, edge_pct: 3, clv_pct: -2 });
assert.ok(buildBooks(bad, { my: ['snai'], nowMs: NOW }).alerts.some(a => a.kind === 'calo'));
// quote che spariscono: il mio sito c'era quasi sempre, negli ultimi 3 giorni quasi mai
const pres = [];
const q = has => JSON.stringify({ snai: has ? [2, 3, 4] : null, a: [2, 3, 4], b: [2, 3, 4], c: [2, 3, 4], d: [2, 3, 4], e: [2, 3, 4] });
for (let i = 0; i < 25; i++) pres.push({ id: 2000 + i, event_id: 'p' + i, selection: 'home', strategy: 'T', book: 'a', created_at: at(4 + i * 0.3), quotes: q(true) });
for (let i = 0; i < 12; i++) pres.push({ id: 3000 + i, event_id: 'r' + i, selection: 'home', strategy: 'T', book: 'a', created_at: at(i * 0.2), quotes: q(i === 0) });
assert.ok(buildBooks(pres, { my: ['snai'], nowMs: NOW }).alerts.some(a => a.kind === 'sparisce'));
assert.strictEqual(verdictOf(band([1, 2])), 'pochi');
console.log('books.test.js: tutti i controlli passati');
// quote dei siti italiani alla chiusura (stessa richiesta di Pinnacle)
{
  const I = require('../services/italia');
  const rec = (id, books) => ({ event_id: id, market: '1x2', home_team: 'A', away_team: 'B', commence_time: '2026-11-01T15:00:00Z', bookmakers: books });
  const bk = (key, h, d, a) => ({ key, outcomes: { HOME: h, DRAW: d, AWAY: a } });
  const q = I.closingQuotes([rec('e1', [bk('pinnacle', 2, 3.4, 3.9), bk('snai', 1.95, 3.3, 3.8)]), rec('e2', [bk('888sport_it', 1.9, 3.2, 4)])], 'e1');
  assert.deepStrictEqual(q.snai, [1.95, 3.3, 3.8]); assert.ok(!q.pinnacle && q['888sport_it']);   // anche la riga separata dello stesso match
  assert.strictEqual(I.closingQuotes([], 'x'), null);
  assert.deepStrictEqual(Object.keys(require('../services/played').SKIP_REASONS), ['quota', 'trovata', 'tempo']);
  console.log('quote italiane alla chiusura e motivi delle non giocate: ok');
}
// prova di Highlightly: abbinamento e punteggio finale
{
  const H = require('../services/highlightly'), I = require('../services/italia');
  assert.strictEqual(H.finalScore({ state: { description: 'Finished', score: { current: '2 - 1' } } }), '2-1');
  assert.strictEqual(H.finalScore({ state: { description: 'Second half', score: { current: '0 - 0' } } }), null);
  const c = H.coverage([{ homeTeam: { name: 'Real Madrid' }, awayTeam: { name: 'Getafe' }, state: { description: 'Finished', score: { current: '3 - 0' } } }],
    [{ event_id: 'a', league: 'La Liga', home: 'Real Madrid', away: 'Getafe CF' }, { event_id: 'a', league: 'La Liga', home: 'Real Madrid', away: 'Getafe CF' }, { event_id: 'b', league: 'Tercera', home: 'Lugo', away: 'Ferrol' }], I.sameTeam);
  assert.deepStrictEqual([c.nostrePartite, c.trovate, c.conRisultato], [2, 1, 1]); assert.ok(/Tercera/.test(c.campionatiMancanti[0]));
  console.log('prova Highlightly (abbinamento): ok');
}
// Highlightly: abbinamento con orario quando i nomi sono scritti diversamente, niente supplementari
{
  const H = require('../services/highlightly'), I = require('../services/italia');
  const ms = [{ homeTeam: { name: 'CD Lugo' }, awayTeam: { name: 'Racing Club Ferrol B' }, date: '2026-10-31T15:00:00Z', state: { description: 'Finished', score: { current: '1 - 0' } } },
    { homeTeam: { name: 'Other' }, awayTeam: { name: 'Team' }, date: '2026-10-31T15:00:00Z' }];
  const m = H.findMatch({ home: 'Lugo', away: 'Ferrol Reserves', commence_time: '2026-10-31T15:05:00Z' }, ms, I.sameTeam);
  assert.ok(m && m.homeTeam.name === 'CD Lugo');
  assert.strictEqual(H.findMatch({ home: 'Lugo', away: 'X', commence_time: '2026-10-31T18:00:00Z' }, ms, I.sameTeam), null);   // orario lontano: no
  assert.strictEqual(H.finalScore({ state: { description: 'Finished after extra time', score: { current: '2 - 1' } } }), null);
  console.log('Highlightly (orario, supplementari): ok');
}
// crediti odss distribuiti fino alla ricarica del 12
{
  const I = require('../services/italia');
  const p = I.odssPace(188, 10, 12, Date.parse('2026-11-01T12:00:00Z'));
  assert.strictEqual(p.daysLeft, 11); assert.strictEqual(p.perDay, 18); assert.strictEqual(p.over, false);
  assert.strictEqual(I.odssPace(30, 20, 12, Date.parse('2026-11-01T12:00:00Z')).over, true);       // pochi crediti: oggi basta cosi'
  assert.strictEqual(I.odssPace(400, 0, 12, Date.parse('2026-11-12T10:00:00Z')).daysLeft, 30);      // dopo la ricarica: mese dopo
  console.log('crediti odss distribuiti: ok');
}
