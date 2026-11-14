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
// lista da giocare: niente quote sopra 3,50; vinte contro attese
{
  const I = require('../services/italia');
  const now = Date.parse('2026-11-01T12:00:00Z'), ko = '2026-11-01T15:00:00Z';
  const items = [{ id: 1, event_id: 'a', final4: true, final6: true, odd: 3.4, play: { odd: 3.45 }, win_prob: 0.32, commence_time: ko, league: 'Liga' },
    { id: 2, event_id: 'b', final4: true, final6: true, odd: 3.6, play: { odd: 3.6 }, win_prob: 0.3, commence_time: ko, league: 'Liga' },
    { id: 3, event_id: 'c', final4: true, final6: true, odd: 3.3, play: { odd: 3.55 }, win_prob: 0.31, commence_time: ko, league: 'Liga' }];
  assert.deepStrictEqual(I.pickBest(items, { nowMs: now, rule: 'consigliate' }), [1]);
  assert.strictEqual(I.budgetCfg({}).maxOdd, 3.5); assert.strictEqual(I.budgetCfg({ BEST_MAX_ODD: '3' }).maxOdd, 3);
  const mk = (n, won, p) => Array.from({ length: n }, (_, i) => ({ result: i < won ? 'won' : 'lost', fair_prob: p, odd: 1 / p }));
  assert.strictEqual(I.winCheck(mk(10, 5, 0.5)).level, 'pochi');
  assert.strictEqual(I.winCheck(mk(40, 20, 0.5)).level, 'ok');
  assert.strictEqual(I.winCheck(mk(40, 12, 0.5)).level, 'allarme');      // 12 vinte su 20 attese: z = -2,5
  console.log('lista: quota massima e vinte contro attese: ok');
}
// 🧪 prove sulla carta: 🔒 7 su 10 e 💧 Liquidi
{
  const I = require('../services/italia');
  const base = { created_at: '2026-11-02T10:00:00Z', commence_time: '2026-11-02T12:00:00Z', edge_pct: 5, league: 'Serie A', selection: 'home', event_id: 'e' };
  const fav = { ...base, id: 1, odd: 1.45, fair_prob: 0.72, pin_h: 1.36, pin_d: 4.6, pin_a: 6 };            // margine alto (12%)
  const liq = { ...base, id: 2, event_id: 'f', odd: 2.6, fair_prob: 0.40, pin_h: 2.45, pin_d: 3.3, pin_a: 3.0 }; // margine ~4%
  const old = { ...liq, id: 3, event_id: 'g', created_at: '2026-10-30T10:00:00Z', commence_time: '2026-10-30T12:00:00Z' };
  const rows = [fav, liq, old], m8 = I.markFinal8(rows), m9 = I.markFinal9(rows);
  assert.strictEqual(m8.get(1).final, true); assert.strictEqual(m8.get(2).final, false);
  assert.strictEqual(m9.get(1).final, false); assert.strictEqual(m9.get(2).final, true);
  assert.strictEqual(m9.get(3).final, false); assert.strictEqual(I.markFinal9(rows, { ignoreSince: true }).get(3).final, true);
  assert.strictEqual(I.markFinal9([{ ...liq, league: 'Coppa Italia' }]).get(2).final, false);
  console.log('prove sulla carta 🔒 e 💧: ok');
}
// ⚽ gol: formula, Valanga, Over/Under
{
  const G = require('../services/goals');
  const f = G.fair1x2(1.25, 7, 11);                                   // grande favorita, X alta
  assert.ok(f.draw < 0.15 && f.marginPct > 0);
  assert.ok(Math.abs(G.expGoals(0.3) - 2.454) < 0.01);
  assert.strictEqual(G.isValanga('Spain - Tercera Division', { draw: 0.18, marginPct: 9 }), true);
  assert.strictEqual(G.isValanga('Premier League', { draw: 0.18, marginPct: 5 }), false);    // mercato liquido
  assert.strictEqual(G.isValanga('FA Cup', { draw: 0.18, marginPct: 9 }), false);             // coppa
  assert.strictEqual(G.isValanga('Serie C', { draw: 0.27, marginPct: 9 }), false);
  const nv = G.noVig2(1.9, 1.9); assert.ok(Math.abs(nv[0] - 0.5) < 1e-6 && Math.abs(nv[0] + nv[1] - 1) < 1e-9);
  assert.strictEqual(G.goalsOf('3-2'), 5); assert.strictEqual(G.goalsOf('x'), null);
  assert.strictEqual(G.sideWon('over', 2.5, 3), true); assert.strictEqual(G.sideWon('under', 2.5, 3), false);
  const t0 = Date.parse('2026-11-12T12:00:00Z'), ct = '2026-11-12T14:00:00Z';
  const recs = [
    { event_id: 'e1', market: 'over_under', line: 2.5, league: 'Tercera', home_team: 'A', away_team: 'B', commence_time: ct,
      bookmakers: [{ key: 'pinnacle', outcomes: { OVER: 1.80, UNDER: 2.05 } }, { key: 'snai', outcomes: { OVER: 1.95, UNDER: 1.80 } }] },
    { event_id: 'e1', market: 'over_under', line: 3.5, league: 'Tercera', home_team: 'A', away_team: 'B', commence_time: ct,
      bookmakers: [{ key: 'pinnacle', outcomes: { OVER: 2.6, UNDER: 1.5 } }, { key: 'snai', outcomes: { OVER: 2.5, UNDER: 1.45 } }] },
    { event_id: 'e1', market: '1x2', bookmakers: [] }
  ];
  const tot = G.parseTotals(recs);
  assert.deepStrictEqual(Object.keys(tot.get('e1').lines).sort(), ['2.5', '3.5']);
  const pin = new Map([['e1', { league: 'Spain - Tercera Division', fair: { draw: 0.18, marginPct: 9 } }]]);
  const s = G.findGoalSignals(tot, ['snai'], pin, t0);
  const g = s.filter(x => x.strategy === 'G'); assert.strictEqual(g.length, 1); assert.strictEqual(g[0].side, 'over'); assert.ok(g[0].edge_pct > 4);
  const v = s.filter(x => x.strategy === 'V'); assert.deepStrictEqual(v.map(x => x.line).sort(), [2.5, 3.5]);
  assert.strictEqual(G.findGoalSignals(tot, ['snai'], new Map(), t0).filter(x => x.strategy === 'V').length, 0);
  const st = G.overStats([0, 1, 2, 3, 4, null]); assert.strictEqual(st.n, 5); assert.strictEqual(st.over[2.5], 40);
  console.log('gol (formula, Valanga, Over/Under): ok');
}
// 🔍 controllo dei risultati scritti a mano
{
  const R = require('../services/results');
  assert.strictEqual(R.verifyStatus('2-1', '2-1'), 'ok');
  assert.strictEqual(R.verifyStatus('2-1', '1-2'), 'diff');
  assert.strictEqual(R.verifyStatus('2-1', null), null);
  assert.strictEqual(R.verifyStatus('rinviata', '1-1'), null);
  console.log('controllo risultati a mano: ok');
}
// 👥 consenso dei siti
{
  const I = require('../services/italia');
  const q = { snai: [2.2, 3.3, 3.4], eurobet: [2.15, 3.3, 3.4], sisal: [2.0, 3.2, 3.6], goldbet: [2.1, 3.3, 3.5], netwin: [2.3, 3.2, 3.3] };
  const k = I.consensusOf(2.3, 0.47, 'home', q);              // giusto 2,13: sopra del 2% chi paga da 2,17
  assert.strictEqual(k.sites, 5); assert.strictEqual(k.above, 2); assert.strictEqual(k.median, 2.15);
  assert.ok(k.ratio > 1.06 && k.ratio < 1.08);
  assert.strictEqual(I.consensusOf(2.3, 0.47, 'home', { snai: [2.2, 3, 3] }), null);   // troppo pochi siti
  console.log('consenso dei siti: ok');
}
// 💳 piano delle richieste odss fino alla ricarica
{
  const I = require('../services/italia');
  const a = I.planScans({ remaining: 181, daysLeft: 11, closesPerDay: 6.6 });
  assert.strictEqual(a.everyMin, 120); assert.ok(a.perDay * 11 <= 181);
  const b = I.planScans({ remaining: 120, daysLeft: 11, closesPerDay: 6.6 });
  assert.strictEqual(b.everyMin, 240);                                   // pochi crediti: si rallenta
  const c = I.planScans({ remaining: 40, daysLeft: 2, closesPerDay: 6.6 });
  assert.ok(c.reserve < 60 && c.reserve >= 16);                         // a fine ciclo la riserva si accorcia
  console.log('piano richieste odss: ok');
}
// 📊 Over/Under di Pinnacle con The Odds API
{
  const O = require('../services/ouPinnacle'), G = require('../services/goals');
  const now = Date.parse('2026-11-01T18:00:00Z');
  const b = O.dailyBudget(488, 0, now); assert.strictEqual(b.days, 30); assert.strictEqual(b.perDay, 15);
  assert.strictEqual(O.dailyBudget(473, 15, now).over, true);
  assert.strictEqual(O.dailyBudget(25, 0, now).perDay, 0);              // sotto la scorta: niente letture
  const ev = [{ id: 'x', home_team: 'A', away_team: 'B', commence_time: '2026-11-01T20:00:00Z', bookmakers: [{ key: 'pinnacle', markets: [{ key: 'totals', outcomes: [
    { name: 'Over', price: 1.9, point: 2.5 }, { name: 'Under', price: 1.95, point: 2.5 }, { name: 'Over', price: 2.8, point: 3.5 }, { name: 'Under', price: 1.42, point: 3.5 }] }] }] }];
  const r = O.parsePinTotals(ev, G.noVig2);
  assert.strictEqual(r.length, 2); assert.ok(Math.abs(r.find(x => x.line === 2.5).fairOver - 0.506) < 0.01);
  console.log('Over/Under di Pinnacle: ok');
}
// 🏠 fattore campo: niente 2 nei mercati sottili tra le ⭐
{
  const I = require('../services/italia');
  const base = { final4: true, final6: true, play: { book: 'Snai', odd: 2.5 }, win_prob: 0.42, odd: 2.5, league: 'Serie C', commence_time: '2099-01-01T12:00:00Z' };
  const items = [{ ...base, id: 1, event_id: 'a', selection: 'away', pin_margin: 9 }, { ...base, id: 2, event_id: 'b', selection: 'away', pin_margin: 4 }, { ...base, id: 3, event_id: 'c', selection: 'home', pin_margin: 9 }];
  assert.deepStrictEqual(I.pickBest(items, { rule: 'consigliate', noAwayThin: true }).sort(), [2, 3]);
  assert.deepStrictEqual(I.pickBest(items, { rule: 'consigliate', noAwayThin: false }).length, 3);
  assert.strictEqual(I.isAwayThin({ selection: 'away', pin_h: 2.2, pin_d: 3.2, pin_a: 3.0 }), true);    // margine circa 9%
  assert.strictEqual(I.budgetCfg({}).noAwayThin, true); assert.strictEqual(I.budgetCfg({ BEST_AWAY_THIN: 'true' }).noAwayThin, false);
  console.log('fattore campo: ok');
}
// 🟢 / 🟡 / 🔴 verdetto su ogni scheda
{
  const I = require('../services/italia'), now = Date.parse('2026-11-02T08:00:00Z');
  const r = { id: 1, commence_time: '2026-11-02T10:00:00Z', final4: true, final6: true, edge_pct: 5, odd: 2.5, league: 'Serie C', min_odd: 2.41, alt: { '888sport': 2.2 }, play: null };
  const bc = { maxOdd: 3.5, rule: 'consigliate', noAwayThin: true };
  assert.strictEqual(I.verdictOf({ ...r, play: { book: 'Snai', odd: 2.5 } }, { best: new Set([1]), bc, nowMs: now }).play, 'yes');
  const v = I.verdictOf(r, { bc, nowMs: now }); assert.strictEqual(v.play, 'no'); assert.ok(/888sport 2,20/.test(v.text));
  assert.strictEqual(I.verdictOf({ ...r, final4: false, commence_time: '2026-11-02T14:00:00Z' }, { bc, nowMs: now }).play, 'wait');
  assert.ok(/Trasferta/.test(I.verdictOf({ ...r, awayThin: true, play: { book: 'Snai', odd: 2.5 } }, { bc, nowMs: now }).text));
  assert.strictEqual(I.verdictOf({ ...r, played: { odd: 2 } }, { bc, nowMs: now }), null);
  console.log('verdetto schede: ok');
}
// 💧 liquide tra le ⭐
{
  const I = require('../services/italia');
  const mk = (id, o) => ({ id, event_id: 'e' + id, selection: 'home', strategy: 'I', league: 'Serie B', created_at: '2026-11-03T10:00:00Z', commence_time: '2026-11-03T12:00:00Z', edge_pct: 2.5, pin_h: 2.0, pin_d: 3.5, pin_a: 4.0, ...o });
  const rows = [mk(1, {}), mk(2, { pin_h: 1.9, pin_d: 3.3, pin_a: 3.6 }), mk(3, { edge_pct: 1.5 }), mk(4, { league: 'Coppa Italia' }), mk(5, { created_at: '2026-11-01T10:00:00Z', commence_time: '2026-11-01T12:00:00Z' })];
  const m = I.markLiquid(rows);   // 1: margine circa 3%; 2: circa 11% (sottile)
  assert.deepStrictEqual(rows.filter(r => m.get(r.id).final).map(r => r.id), [1]);
  assert.strictEqual(I.markLiquid(rows, { ignoreSince: true }).get(5).final, true);
  const base = { play: { book: 'Snai', odd: 2.1 }, win_prob: 0.5, odd: 2.1, league: 'Serie B', commence_time: '2099-01-01T12:00:00Z' };
  const items = [{ ...base, id: 10, event_id: 'x', final4: true, final6: true, solid: { score: 3 } }, { ...base, id: 11, event_id: 'y', liquid: true }, { ...base, id: 12, event_id: 'z' }];
  assert.deepStrictEqual(I.pickBest(items, { rule: 'consigliate', noAwayThin: true }), [11, 10]);   // la liquida per prima, la 12 fuori
  console.log('liquide tra le stelle: ok');
}
// verdetto: prima i motivi fissi (quota alta, trasferta nei minori), poi l'attesa; di notte niente attesa
{
  const I = require('../services/italia'), now = Date.parse('2026-11-02T20:11:00Z'), bc = { maxOdd: 3.5, rule: 'consigliate', noAwayThin: true };
  const r = { id: 7, commence_time: '2026-11-03T01:06:00Z', final4: false, edge_pct: 5, odd: 3.9, league: 'Liga MX', pin_margin: 7, awayThin: true, selection: 'away', play: { book: '888sport', odd: 3.9 } };
  assert.ok(/Quota sopra/.test(I.verdictOf(r, { bc, nowMs: now }).text));
  assert.ok(/Trasferta/.test(I.verdictOf({ ...r, odd: 3.0, play: { book: '888sport', odd: 3.0 } }, { bc, nowMs: now }).text));
  assert.ok(/di notte/.test(I.verdictOf({ ...r, odd: 3.0, play: { book: '888sport', odd: 3.0 }, awayThin: false, selection: 'home', win_prob: 0.4 }, { bc, nowMs: now }).text));
  assert.strictEqual(I.verdictOf({ ...r, odd: 3.0, play: { book: 'Snai', odd: 3.0 }, awayThin: false, selection: 'home', win_prob: 0.4, commence_time: '2026-11-03T18:00:00Z' }, { bc, nowMs: now }).play, 'wait');
  console.log('verdetto ordine e notte: ok');
}
// 🧮 voto delle stelle
{
  const I = require('../services/italia');
  const base = { pin_h: 2.0, pin_d: 3.5, pin_a: 4.0, edge_pct: 4, created_at: '2026-11-04T10:00:00Z', commence_time: '2026-11-04T12:00:00Z', selection: 'home', league: 'Serie B', odd: 2.1 };
  const good = I.scoreOf(base, { above: 5, ratio: 1.0 }), iso = I.scoreOf(base, { above: 1, ratio: 1.2 }), thin = I.scoreOf({ ...base, pin_h: 1.9, pin_d: 3.2, pin_a: 3.5 }, { above: 5, ratio: 1.0 });
  assert.ok(good.vote > iso.vote && good.vote > thin.vote && good.vote <= 100 && iso.vote >= 0);
  assert.strictEqual(I.scoreOf({ ...base, pin_h: 0 }), null);
  const items = [{ id: 1, event_id: 'a', final4: true, final6: true, play: { book: 'Snai', odd: 2.1 }, odd: 2.1, win_prob: 0.5, league: 'Serie B', commence_time: '2099-01-01T00:00:00Z', score: { vote: 40 } },
    { id: 2, event_id: 'b', final4: true, final6: true, play: { book: 'Snai', odd: 2.1 }, odd: 2.1, win_prob: 0.5, league: 'Serie B', commence_time: '2099-01-01T00:00:00Z', score: { vote: 80 } }];
  assert.deepStrictEqual(I.pickBest(items, { rule: 'consigliate' }), [2, 1]);
  console.log('voto delle stelle: ok');
}
// 💥 Thor in anticipo: quote Over/Under solo per le Valanga in arrivo, nome del mercato provato una volta
{
  const G = require('../services/goals');
  (async () => {
    const now = Date.parse('2026-11-04T12:00:00Z'), calls = [], notes = [];
    const ev = { event_id: 'v1', league: 'Tercera', home: 'A', away: 'B', commence_time: '2026-11-04T13:30:00Z', pin_h: 1.2, pin_d: 7, pin_a: 8, valanga: true };
    const pool = { query: async (sql, p) => {
      if (/SELECT \* FROM goal_watch WHERE valanga/.test(sql)) return { rows: calls.length ? [] : [ev] };
      if (/kind = 'ou_valanga' AND at >=/.test(sql)) return { rows: [{ n: 0 }] };
      if (/quota_remaining FROM italia_requests/.test(sql)) return { rows: [{ quota_remaining: 150 }] };
      if (/kind = 'ou_valanga' AND note LIKE/.test(sql)) return { rows: notes.filter(n => /:0$/.test(n)).map(note => ({ note })) };
      if (/UPDATE italia_requests SET note/.test(sql)) { notes.push(p[0]); return { rows: [] }; }
      if (/COUNT\(\*\) FILTER/.test(sql)) return { rows: [{ closes: 49, today: 3 }] };
      if (/INSERT INTO goal_signals/.test(sql)) return { rowCount: 1, rows: [] };
      if (/INSERT INTO italia_requests/.test(sql)) { calls.push(p); return { rows: [] }; }
      return { rows: [] }; } };
    const c = { key: 'x', ouEnabled: false, myBooks: ['snai'], books: ['snai'], resetDay: 12, fromHour: 9, toHour: 22, closeReserve: 60 };
    const http = { get: async (url, o) => ({ headers: { 'x-quota-remaining': '149' }, data: { odds: [
      { event_id: 'v1', market: o.params.market, line: 3.5, league: 'Tercera', home_team: 'A', away_team: 'B', commence_time: ev.commence_time, bookmakers: [{ key: 'pinnacle', outcomes: { OVER: 1.9, UNDER: 1.9 } }, { key: 'snai', outcomes: { OVER: 2.0, UNDER: 1.8 } }] }] } }) };
    const r = await G.valangaOdds(pool, c, { nowMs: now, http });
    assert.strictEqual(r.thor, 'letta'); assert.strictEqual(r.mercato, 'ou'); assert.strictEqual(r.conQuote, 1); assert.ok(r.nuoviGol >= 1);
    const r2 = await G.valangaOdds(pool, c, { nowMs: now, http }); assert.strictEqual(r2.thor, 'nessuna Valanga in arrivo');
    console.log('Thor in anticipo: ok');
  })().catch(e => { console.error(e); process.exit(1); });
}
// 📋 pagella della squadra
{
  const TM = require('../services/team');
  assert.strictEqual(TM.grade({ measured: 45, avgClvPct: 4, clvCi95: [1, 7], z: -0.5 }), 'green');
  assert.strictEqual(TM.grade({ measured: 45, avgClvPct: 4, clvCi95: [1, 7], z: -2 }), 'yellow');
  assert.strictEqual(TM.grade({ measured: 45, avgClvPct: -1, clvCi95: [-3, 1], z: 0 }), 'red');
  assert.strictEqual(TM.grade({ measured: 20, avgClvPct: 6, clvCi95: [3, 9], z: 1 }), 'yellow');
  assert.strictEqual(TM.grade({ measured: 45, avgClvPct: 7, clvCi95: [5, 9], z: -1, pnlEur: -12 }), 'yellow');   // valore alto ma soldi persi: non e' in forma
  const star = { kind: 'star' }, filt = { kind: 'filter' };
  assert.strictEqual(TM.propose(star, 'green', false), 'on'); assert.strictEqual(TM.propose(star, 'red', true), 'off'); assert.strictEqual(TM.propose(star, 'green', true), null);
  assert.strictEqual(TM.propose(filt, 'green', true), 'off'); assert.strictEqual(TM.propose(filt, 'red', false), 'on');
  const I = require('../services/italia'), ko = '2099-01-01T00:00:00Z', b = { play: { book: 'Snai', odd: 2 }, odd: 2, win_prob: 0.5, league: 'Serie B', commence_time: ko };
  const items = [{ ...b, id: 1, event_id: 'a', final8: true }, { ...b, id: 2, event_id: 'b', final4: true, final6: true }];
  assert.deepStrictEqual(I.pickBest(items, { rule: 'consigliate' }), [2]);
  assert.deepStrictEqual(I.pickBest(items, { rule: 'consigliate', team: { saracinesca: true } }).sort(), [1, 2]);
  assert.deepStrictEqual(I.pickBest(items, { rule: 'consigliate', team: { fascia: false, saracinesca: true } }), [1]);
  console.log('pagella della squadra: ok');
}
// 🌊 Gli Oceani e i freni sulle perdite
{
  const I = require('../services/italia');
  const r = { pin_margin: 4, edge_pct: 2.5, odd: 2.4, league: 'Serie B', play: { book: 'Snai', odd: 2.4 } };
  assert.strictEqual(I.isOceani(r), true);
  assert.strictEqual(I.isOceani({ ...r, pin_margin: 7 }), false);
  assert.strictEqual(I.isOceani({ ...r, odd: 1.8, play: { book: 'Snai', odd: 1.8 } }), false);
  assert.strictEqual(I.isOceani({ ...r, odd: 3.8, play: { book: 'Snai', odd: 3.8 } }), false);
  assert.strictEqual(I.isOceani({ ...r, league: 'Coppa Italia' }), false);
  const c = { start: 100, stop: 60, maxPerDay: 10 }, now = Date.parse('2026-11-05T18:00:00Z');   // giovedi'
  const L = (at, res, p) => ({ at, result: res, pnlEur: p, stake: 2 });
  assert.strictEqual(I.budgetOf({ items: [L('2026-11-05T10:00:00Z', 'lost', -2), L('2026-11-05T11:00:00Z', 'lost', -2)] }, c, now).stopped, false);
  const b3 = I.budgetOf({ items: [L('2026-11-05T10:00:00Z', 'lost', -2), L('2026-11-05T11:00:00Z', 'lost', -2), L('2026-11-05T12:00:00Z', 'lost', -2)] }, c, now);
  assert.strictEqual(b3.dayStop, true); assert.strictEqual(b3.stopped, true);
  const wk = I.budgetOf({ items: [L('2026-11-03T10:00:00Z', 'lost', -8), L('2026-11-04T10:00:00Z', 'lost', -8)] }, c, now);
  assert.strictEqual(wk.weekStop, true);
  assert.strictEqual(I.budgetOf({ items: [L('2026-10-30T10:00:00Z', 'lost', -8), L('2026-10-31T10:00:00Z', 'lost', -8)] }, c, now).weekStop, false);   // settimana scorsa
  const items = [{ id: 1, event_id: 'a', oceani: true, play: { book: 'Snai', odd: 2.4 }, odd: 2.4, league: 'Serie B', commence_time: '2099-01-01T00:00:00Z', score: { vote: 30 } },
    { id: 2, event_id: 'b', final4: true, final6: true, play: { book: 'Snai', odd: 2.1 }, odd: 2.1, win_prob: 0.5, league: 'Serie C', commence_time: '2099-01-01T00:00:00Z', score: { vote: 80 } }];
  assert.deepStrictEqual(I.pickBest(items, { rule: 'consigliate', team: { oceani: true, fascia: false, oceano: false } }), [1]);
  assert.deepStrictEqual(I.pickBest(items, { rule: 'consigliate', team: { oceani: true } }), [1, 2]);   // le Oceani per prime
  console.log('Oceani e freni: ok');
}

(async () => {   // 6 novembre 2026: le ⭐ Justice League prendono la chiusura anche sotto la soglia di vantaggio delle chiusure
  const I = require('../services/italia');
  const now = Date.parse('2026-11-06T20:50:00Z'), ko = '2026-11-06T21:00:00Z';
  const cand = [
    { id: 1, event_id: 'e1', selection: 'home', odd: 3.2, commence_time: ko, strategy: 'I', edge_pct: 2.5, league: 'Primera A', pin_h: 3.6, pin_d: 3.3, pin_a: 2.2 },     // ⭐ con vantaggio 2,5%
    { id: 2, event_id: 'e2', selection: 'home', odd: 1.9, commence_time: ko, strategy: 'I', edge_pct: 2.5, league: 'Ligue 2', pin_h: 2.0, pin_d: 3.0, pin_a: 3.6 },       // non ⭐, sotto soglia
    { id: 3, event_id: 'e3', selection: 'home', odd: 1.9, commence_time: ko, strategy: 'I', edge_pct: 6.0, league: 'Ligue 2', pin_h: 2.0, pin_d: 3.0, pin_a: 3.6 },       // 12 novembre: mai giocata, anche con vantaggio alto non si chiude piu'
    { id: 4, event_id: 'e4', selection: 'away', odd: 2.3, commence_time: ko, strategy: 'I', edge_pct: 3.0, league: 'Ligue 2', pin_h: 3.0, pin_d: 3.2, pin_a: 2.1 }         // Superman (trasferta, mercato sottile): si misura ancora
  ];
  const asked = [];
  const pool = { query: async (sql) => {
    if (/FROM italia_signals\s+WHERE commence_time/.test(sql)) return { rows: cand };
    if (/COUNT\(\*\)::int AS n FROM italia_requests/.test(sql)) return { rows: [{ n: 0 }] };
    if (/quota_remaining FROM italia_requests/.test(sql)) return { rows: [{ quota_remaining: 100 }] };
    return { rows: [], rowCount: 0 };
  } };
  const http = { get: async (url, o) => { asked.push(o.params.event_id); return { data: { odds: [] }, headers: {} }; } };
  await I.captureClosing(pool, { closeWindowMin: 45, closeMinEdge: 4, closeTriggerMin: 15, monthlyCap: 9999, books: [], myBooks: [], key: 'x' }, { nowMs: now, http });
  assert.deepStrictEqual(asked.join(',').split(',').sort(), ['e1', 'e4']);   // una sola richiesta per tutte le partite: solo la ⭐ e Superman, non e2 ne' e3
  console.log('Chiusure delle ⭐: ok');
})().catch(e => { console.error(e); process.exit(1); });

{ // 💎 Top (7 novembre 2026): Justice League con vantaggio dal 3% e margine Pinnacle sotto il 5%
  const I = require('../services/italia');
  const jl = { odd: 2.8, edge_pct: 3.5, league: 'Allsvenskan', pin_h: 2.7, pin_d: 3.5, pin_a: 2.75 };      // margine circa 1,2%
  assert.strictEqual(I.isOceani(jl), true); assert.strictEqual(I.isTop(jl), true);
  assert.strictEqual(I.isTop({ ...jl, edge_pct: 2.5 }), false);                                            // vantaggio sotto il 3%
  assert.strictEqual(I.isTop({ ...jl, pin_h: 2.6, pin_d: 3.3, pin_a: 2.75 }), false);                      // margine 5,1%: liquida ma non Top
  assert.strictEqual(I.isOceani({ ...jl, pin_h: 2.6, pin_d: 3.3, pin_a: 2.75 }), true);
  assert.strictEqual(I.isTop({ ...jl, odd: 1.9 }), false);                                                 // fuori dalla Justice League
  console.log('💎 Top: ok');
}

{ // 📉 mercato contro (8 novembre 2026): se Pinnacle abbassa la nostra scelta di 1 punto o piu' dopo il segnale, non si gioca
  const I = require('../services/italia');
  const first = { id: 1, selection: 'away', pin_h: 2.0, pin_d: 3.6, pin_a: 3.9 };
  const now = { id: 2, selection: 'away', pin_h: 1.85, pin_d: 3.7, pin_a: 4.4 };
  const m = I.marketOf(first, now);
  assert.strictEqual(m.dir, 'contro'); assert.ok(m.mv < -1);
  assert.strictEqual(I.marketOf(first, { ...first, id: 3 }).dir, 'fermo');
  assert.strictEqual(I.marketOf(first, { id: 4, pin_h: 2.1, pin_d: 3.6, pin_a: 3.6 }).dir, 'con');
  assert.strictEqual(I.marketOf(first, first), null);
  const later = Date.now() + 3600000;
  const card = { id: 9, commence_time: new Date(later).toISOString(), league: 'Serie A', odd: 3.4, edge_pct: 3, liquid: true, final4: true, play: { book: 'Goldbet', odd: 3.4 }, min_odd: 3.2, market: m };
  const v = I.verdictOf(card, { best: new Set([9]), nowMs: Date.now() });
  assert.strictEqual(v.play, 'no'); assert.ok(/mercato/i.test(v.text));
  assert.deepStrictEqual(I.pickBest([card], { team: { oceano: true } }), []);
  console.log('📉 Mercato contro: ok');
}

{ // ⚡ Quicksilver (8 novembre 2026): Pinnacle sale di almeno 1 punto sulla nostra scelta prima del segnale
  const I = require('../services/italia');
  const t0 = Date.parse('2026-11-09T12:00:00Z');
  const hist = new Map([['e1', [
    { at: new Date(t0 - 2 * 3600000).toISOString(), pin_h: 2.6, pin_d: 3.4, pin_a: 2.9 },
    { at: new Date(t0).toISOString(), pin_h: 2.4, pin_d: 3.4, pin_a: 3.15 }]]]);
  const sig = { id: 1, event_id: 'e1', selection: 'home', created_at: new Date(t0 + 60000).toISOString(), odd: 2.6, edge_pct: 3, league: 'Eredivisie', pin_h: 2.4, pin_d: 3.4, pin_a: 3.15 };
  assert.ok(I.quickRise(sig, hist) >= 1);
  assert.strictEqual(I.markQuick([sig], hist).get(1).final, true);
  assert.strictEqual(I.markQuick([{ ...sig, selection: 'away' }], hist).size, 0);      // per il 2 Pinnacle e' sceso: non e' Quicksilver
  assert.strictEqual(I.markQuick([sig], new Map()).size, 0);                             // senza storia non si giudica
  console.log('⚡ Quicksilver: ok');
}

{ // 🧪 Prova (10 novembre 2026): liquide dal 2%, quota 2,00-4,00, fuori dalle Justice League (coppe e quote 3,50-4,00)
  const I = require('../services/italia');
  const jl = { odd: 2.8, edge_pct: 3.5, league: 'Allsvenskan', pin_h: 2.7, pin_d: 3.5, pin_a: 2.75 };
  assert.strictEqual(I.isOceani(jl), true); assert.strictEqual(I.isProva(jl), false);                      // le Justice League restano Justice League
  assert.strictEqual(I.isProva({ ...jl, odd: 3.8 }), true);                                                // quota 3,50-4,00
  assert.strictEqual(I.isProva({ ...jl, odd: 4.2 }), false);                                               // oltre 4,00
  assert.strictEqual(I.isProva({ ...jl, league: 'EFL Trophy' }), true);                                    // coppa
  assert.strictEqual(I.isProva({ ...jl, odd: 1.8 }), false);                                              // sotto 2,00
  assert.strictEqual(I.isProva({ ...jl, league: 'EFL Trophy', pin_h: 2.3, pin_d: 3.0, pin_a: 2.4 }), false);  // mercato sottile (margine oltre 6%)
  assert.strictEqual(I.isProva({ ...jl, league: 'EFL Trophy', edge_pct: 1.5 }), false);                    // vantaggio sotto il 2%
  console.log('🧪 Prova: ok');
}

{ // 🧪 Sulla carta (14 novembre 2026): fascia bassa 1,60-2,00 e mercati medi (margine 6-8%), mai nella lista da giocare
  const I = require('../services/italia');
  const [bassa, medi] = I.PAPER.groups;
  const liq = { odd: 1.8, edge_pct: 2.5, league: 'Allsvenskan', pin_h: 1.85, pin_d: 3.7, pin_a: 4.6 };       // margine sotto il 6%
  assert.ok(I.pinMarginPct(liq) < 6);
  assert.strictEqual(I.isPaperGroup(liq, bassa), true); assert.strictEqual(I.isOceani(liq), false);
  assert.strictEqual(I.isPaperGroup({ ...liq, odd: 2.0 }, bassa), false);                                   // 2,00 e' gia' Justice League
  assert.strictEqual(I.isPaperGroup({ ...liq, odd: 1.55 }, bassa), false);                                  // sotto 1,60
  assert.strictEqual(I.isPaperGroup({ ...liq, edge_pct: 1.5 }, bassa), false);                              // vantaggio sotto il 2%
  assert.strictEqual(I.isPaperGroup({ ...liq, league: 'EFL Trophy' }, bassa), false);                       // coppa
  assert.strictEqual(I.isPaperGroup({ ...liq, play: { book: '888sport', odd: 2.1 } }, bassa), false);       // quota sul sito fuori fascia
  assert.strictEqual(I.isPaperGroup(liq, medi), false);                                                     // liquido: non e' "medio"
  const mid = { odd: 2.5, edge_pct: 3, league: 'Liga 2', pin_h: 2.3, pin_d: 3.1, pin_a: 3.1 };
  const mm = I.pinMarginPct(mid); assert.ok(mm >= 6 && mm < 8, 'margine ' + mm);
  assert.strictEqual(I.isPaperGroup(mid, medi), true); assert.strictEqual(I.isPaperGroup(mid, bassa), false);
  assert.strictEqual(I.isPaperGroup({ ...mid, odd: 3.6 }, medi), false);                                    // sopra 3,50
  // prima lettura per partita
  const rows = [{ ...liq, id: 1, event_id: 'e', selection: 'home', created_at: '2026-11-14T10:00:00Z' }, { ...liq, id: 2, event_id: 'e', selection: 'home', created_at: '2026-11-14T12:00:00Z' }];
  const m = I.markPaperGroup(rows, bassa); assert.strictEqual(m.get(1).final, true); assert.strictEqual(m.get(2).final, false);
  // mai nella lista da giocare
  const now = Date.parse('2026-11-14T09:00:00Z');
  const recent = [{ ...liq, id: 9, paper: ['bassa'], play: { book: '888sport', odd: 1.8 }, commence_time: '2026-11-14T15:00:00Z' }];
  assert.deepStrictEqual(I.pickBest(recent, { nowMs: now, team: { oceani: true, prova: true, fascia: false } }), []);
  console.log('🧪 Sulla carta: ok');
}

{ // giorno di ricarica odss (12): una lettura di sondaggio, poi si torna al piano
  const I = require('../services/italia');
  const noon = d => Date.UTC(2026, 10, d, 8, 0);                    // 9:00 ora italiana
  assert.strictEqual(I.resetProbe(noon(12), 12, 0), true);          // il 12, nessuna lettura oggi: sondaggio
  assert.strictEqual(I.resetProbe(noon(12), 12, 1), false);         // il 12 ma ha gia' letto: piano normale
  assert.strictEqual(I.resetProbe(noon(13), 12, 0), false);         // un altro giorno
  assert.strictEqual(I.resetProbe(Date.UTC(2026, 10, 11, 23, 30), 12, 0), true);   // 00:30 ora italiana del 12
  console.log('ricarica odss: ok');
}

{ // 12 novembre 2026: scansioni solo alle ore 9, 12, 15, 18, 21 (ora italiana)
  const I = require('../services/italia');
  assert.deepStrictEqual(I.cfg({}).scanHours, [9, 12, 15, 18, 21]);
  assert.deepStrictEqual(I.cfg({ ITALIA_SCAN_HOURS: '10, 14' }).scanHours, [10, 14]);
  assert.deepStrictEqual(I.cfg({ ITALIA_SCAN_HOURS: '' }).scanHours, []);                 // vuoto = come prima
  console.log('Orari di scansione: ok');
}

{ // Over/Under: si accende solo con OU_ENABLED=true e il mercato odss giusto e' 'ou' (trovato il 4 novembre)
  const I = require('../services/italia');
  assert.strictEqual(I.cfg({}).ouEnabled, false);
  assert.strictEqual(I.cfg({ OU_ENABLED: 'true' }).ouEnabled, true);
  assert.strictEqual(I.cfg({ OU_ENABLED: 'True' }).ouEnabled, true);   // come lo scrive Render
  assert.strictEqual(I.cfg({ OU_ENABLED: ' TRUE ' }).ouEnabled, true);
  assert.strictEqual(I.cfg({ OU_ENABLED: '1' }).ouEnabled, false);   // "1" NON accende: ci vuole "true"
  assert.strictEqual(I.cfg({}).ouMarket, 'ou');
  console.log('Over/Under: accensione ok');
}

{ // 12 novembre 2026: piano con orari fissi e Over/Under (ogni scansione costa una richiesta in piu')
  const I = require('../services/italia');
  const a = I.planScans({ remaining: 495, daysLeft: 30, closesPerDay: 4, hours: [9, 12, 15, 18, 21] });
  assert.strictEqual(a.scansPerDay, 5); assert.strictEqual(a.perDay, 5 + a.closesPerDay); assert.deepStrictEqual(a.hours, [9, 12, 15, 18, 21]);
  const b = I.planScans({ remaining: 495, daysLeft: 30, closesPerDay: 4, hours: [9, 12, 15, 18, 21], perScanExtra: 1 });
  assert.strictEqual(b.perDay, 10 + b.closesPerDay); assert.strictEqual(b.ou, true);
  assert.ok(b.leftAtReset < a.leftAtReset);
  console.log('Piano crediti con orari fissi: ok');
}

{ // 13 novembre 2026: il miglior vantaggio Over/Under per partita/linea/lato (anche negativo), solo linee 1,5 / 2,5 / 3,5
  const G = require('../services/goals');
  const ko = new Date(Date.now() + 5 * 3600000).toISOString();
  const totals = new Map([['e1', { event_id: 'e1', league: 'Test', home: 'A', away: 'B', commence_time: ko, lines: {
    2.5: { pinnacle: { over: 1.90, under: 1.95 }, '888sport_it': { over: 2.00, under: 1.85 }, goldbet: { over: 1.90, under: 1.90 } },
    3.5: { goldbet: { over: 3.0, under: 1.3 } },                                   // senza Pinnacle: nessun prezzo giusto, si salta
    4.5: { pinnacle: { over: 5.0, under: 1.18 }, goldbet: { over: 5.2, under: 1.15 } } } }]]);   // linea fuori elenco
  const r = G.ouEdges(totals, ['888sport_it', 'goldbet']);
  assert.strictEqual(r.length, 2);                                                  // solo la 2,5: over e under
  const over = r.find(x => x.side === 'over'), under = r.find(x => x.side === 'under');
  assert.strictEqual(over.book, '888sport_it'); assert.ok(over.edge_pct > 0);       // 2,00 contro un prezzo giusto di circa 0,51
  assert.strictEqual(under.book, 'goldbet'); assert.ok(under.edge_pct < 0);         // miglior under 1,90: ancora sotto il valore
  assert.strictEqual(G.ouEdges(totals, ['888sport_it'], Date.parse(ko) + 1).length, 0);   // partita gia' iniziata
  console.log('Over/Under: vantaggi salvati ok');
}

// 14 novembre 2026: le statistiche della pagina leggono TUTTI i segnali della strategia, non solo gli ultimi 600
(async () => {
  const seen = [];
  const pool = { query: async (q) => { seen.push(String(q)); return { rows: [] }; } };
  try { await require('../services/italia').getItalia(pool, {}, 'I'); } catch (e) { /* senza database vero: conta solo la richiesta */ }
  const sel = seen.filter(q => /FROM italia_signals WHERE strategy = \$1 ORDER BY commence_time DESC/.test(q));
  assert.ok(sel.length >= 1, 'la lettura dei segnali deve partire');
  assert.ok(sel.every(q => !/LIMIT\s+600/.test(q)), 'nessun tetto di 600 segnali');
  console.log('statistiche su tutti i segnali: ok');
})();
