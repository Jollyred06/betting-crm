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
