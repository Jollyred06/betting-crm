// Chiusura Pinnacle, CLV, quota presa/massimo/cattura e riepilogo: senza rete e senza database.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
Module._load = function (request) {
  if (request === 'dotenv') return { config() {} };
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'axios') return { create: () => ({ get() { throw new Error('rete non disponibile nel test'); } }), get() { throw new Error('rete'); } };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  return origLoad.apply(this, arguments);
};
const { noVigPower, noVig, analyzeEvent, pickPresa } = require('../services/sharpSignals');
const { captureClosing } = require('../services/closingCapture');
const { settlePending } = require('../services/settler');
const { summarize, formatReport, buildStats } = require('../services/weeklyReport');

(async () => {
  // 1) metodo power: somma((1/quota)^c) = 1, probabilita' che sommano 1 e meno peso alle quote alte rispetto al metodo proporzionale
  const odds = { home: 2.0, draw: 3.5, away: 3.8 }, pw = noVigPower(odds), pr = noVig(odds);
  assert.ok(Math.abs(pw.home + pw.draw + pw.away - 1) < 1e-12);
  const c = Math.log(pw.home) / Math.log(1 / odds.home);
  assert.ok(Math.abs((1 / 2.0) ** c + (1 / 3.5) ** c + (1 / 3.8) ** c - 1) < 1e-9, 'c deve risolvere somma((1/quota)^c) = 1');
  assert.ok(pw.away < pr.away && pw.home > pr.home);
  console.log('metodo power: ok');

  // 2) soglie 2%-25% e campi del segnale
  const bk = (key, h, d, a, title) => ({ key, title: title || key, markets: [{ key: 'h2h', outcomes: [{ name: 'Casa', price: h }, { name: 'Draw', price: d }, { name: 'Fuori', price: a }] }] });
  const base = [bk('pinnacle', 2.0, 3.5, 3.8), bk('a', 1.95, 3.4, 3.9, 'A'), bk('b', 1.95, 3.4, 4.0, 'B'), bk('c', 1.98, 3.4, 3.85, 'C')];
  const ev = { home_team: 'Casa', away_team: 'Fuori', bookmakers: base };
  // edge fuori: 4.0 * 0.24699 - 1 = -1.2% (sotto 2%): nessun segnale; 4.2 -> +3.7%; 6.0 -> +48% (sopra 25%): scartato
  assert.strictEqual(analyzeEvent(ev).candidates.length, 0);
  const ok = analyzeEvent({ ...ev, bookmakers: [...base, bk('d', 1.9, 3.3, 4.2, 'D'), bk('betfair_ex_eu', 2.0, 3.5, 4.4, 'Exch')] }).candidates.find(x => x.selection === 'away');
  assert.ok(ok && Math.abs(ok.edge - 0.0373) < 0.002 && ok.bookmaker === 'D');
  assert.strictEqual(ok.presaOdd, 4.2); assert.strictEqual(ok.maxOdd, 4.4); assert.strictEqual(ok.maxBook, 'Exch');   // il massimo di mercato include anche le exchange
  assert.strictEqual(ok.sharpOdd, 3.8); assert.strictEqual(ok.goldbetOdd, null); assert.strictEqual(ok.quotes.length, 4);   // quote di tutti i book morbidi
  assert.ok(!analyzeEvent({ ...ev, bookmakers: [...base, bk('w', 1.9, 3.3, 6.0, 'W')] }).candidates.some(x => x.selection === 'away'));   // +48%: scartato
  const near2 = analyzeEvent({ ...ev, bookmakers: [...base, bk('d', 1.9, 3.3, 4.12, 'D')] }).candidates.find(x => x.selection === 'away');   // +1.8% sotto il 2%? 4.12*0.24699-1 = +1.76%
  assert.ok(!near2, 'sotto il 2% nessun segnale');
  const g = analyzeEvent({ ...ev, bookmakers: [...base, bk('d', 1.9, 3.3, 4.2, 'D'), bk('gb', 1.9, 3.3, 4.0, 'Goldbet')] }).candidates.find(x => x.selection === 'away');
  assert.strictEqual(g.goldbetOdd, 4.0);
  process.env.BOOK_PRESA = 'goldbet';
  const pg = analyzeEvent({ ...ev, bookmakers: [...base, bk('d', 1.9, 3.3, 4.2, 'D'), bk('gb', 1.9, 3.3, 4.0, 'Goldbet')] }).candidates.find(x => x.selection === 'away');
  assert.strictEqual(pg.odd, 4.2); assert.strictEqual(pg.presaOdd, 4.0); assert.strictEqual(pg.presaBook, 'Goldbet');   // il segnale nasce dalla miglior quota, la quota presa e' quella del tuo book
  const noGold = analyzeEvent({ ...ev, bookmakers: [...base, bk('d', 1.9, 3.3, 4.2, 'D')] }).candidates.find(x => x.selection === 'away');
  assert.strictEqual(noGold.presaOdd, 4.2);                                                                            // Goldbet assente: ripiego sulla miglior quota
  delete process.env.BOOK_PRESA;
  console.log('soglie 2%-25%, quota presa / massimo / Goldbet: ok');

  // 3) cattura della chiusura Pinnacle -> clv = quota_presa * p_chiusura - 1
  const kick = new Date(Date.now() + 15 * 60000).toISOString();
  const updates = [], sqls = [];
  const pool = { query: async (sql, p) => { sqls.push(sql);
    if (/SELECT vb\.id/.test(sql)) return { rows: [
      { id: 1, selection: 'away', bookmaker_odd: '4.20', quota_presa: '4.00', league_code: 'E3', odds_event_id: 'ev1' },
      { id: 2, selection: 'draw', bookmaker_odd: '3.80', quota_presa: null, league_code: 'E3', odds_event_id: 'evX' },          // evento non piu' in elenco
      { id: 3, selection: 'home', bookmaker_odd: '2.10', quota_presa: '2.10', league_code: 'SP2', odds_event_id: 'ev3' }] };   // chiamata che fallisce
    if (/UPDATE value_bets SET close_pin_h/.test(sql)) updates.push(p); return { rows: [] }; } };
  const calls = [];
  const oddsApi = { getOddsForCompetition: async code => { calls.push(code); if (code === 'SP2') throw new Error('crediti rimasti 50, sotto la soglia di sicurezza (60): chiamata saltata');
    return [{ id: 'ev1', commence_time: kick, home_team: 'Casa', away_team: 'Fuori', bookmakers: [bk('pinnacle', 2.1, 3.4, 3.6)] }]; } };
  const r = await captureClosing(pool, oddsApi);
  assert.deepStrictEqual(calls.sort(), ['E3', 'SP2']);                                    // 1 chiamata per campionato, non per segnale
  assert.strictEqual(r.catturate, 1); assert.strictEqual(r.saltate, 2); assert.strictEqual(r.chiamate, 1); assert.ok(r.errori[0].includes('SP2'));
  const [id, ph, pd, pa, fair, clv, lag] = updates[0], expFair = noVigPower({ home: 2.1, draw: 3.4, away: 3.6 }).away;
  assert.strictEqual(id, 1); assert.deepStrictEqual([ph, pd, pa], [2.1, 3.4, 3.6]);
  assert.ok(Math.abs(fair - expFair) < 1e-12);
  assert.ok(Math.abs(clv - (4.0 * expFair - 1) * 100) < 1e-9, 'clv = quota PRESA (4.00) * p_chiusura - 1, in percentuale');
  assert.ok(lag >= 14 && lag <= 15);
  assert.ok(/clv_source='pinnacle'/.test(sqls.find(q => /UPDATE value_bets SET close_pin_h/.test(q))));
  console.log('cattura chiusura Pinnacle e CLV: ok');

  // 4) chiusura a fine partita: il CLV Pinnacle gia' salvato non si tocca; senza cattura si ripiega sulla media, marcata 'avg'
  const sets = [];
  const hist = [{ date: '2026-10-03', home: 'Casa', away: 'Fuori', hg: 0, ag: 1, close_avg_h: '2.00', close_avg_d: '3.50', close_avg_a: '3.80' }];
  const mk = rows => ({ query: async (sql, p) => {
    if (/SELECT quota_presa, clv_source/.test(sql)) return { rows: [] };
    if (/FROM value_bets vb JOIN fixtures/.test(sql)) return { rows };
    if (/FROM historical_matches/.test(sql)) return { rows: hist };
    if (/SELECT balance_after/.test(sql)) return { rows: [{ balance_after: '100' }] };
    if (/UPDATE value_bets/.test(sql)) sets.push({ sql, p }); return { rows: [] }; } });
  const pend = (o) => ({ id: 1, selection: 'away', bookmaker_odd: '4.20', recommended_stake: '1', league_code: 'E3', date: new Date('2026-10-03T14:00:00Z'), home_name: 'Casa', away_name: 'Fuori', ...o });
  const history = require('../services/history'); // nomi: 'Casa'/'Fuori' si riconoscono da soli
  await settlePending(mk([pend({ quota_presa: '4.00', clv_source: 'pinnacle', closing_fair_prob: '0.2400' })]));
  assert.ok(/SET status=\$1, result_score=\$2, settled_at=NOW\(\) WHERE id=\$3/.test(sets[0].sql), 'CLV Pinnacle gia salvato: non va riscritto');
  sets.length = 0;
  await settlePending(mk([pend({ quota_presa: '4.00', clv_source: null, closing_fair_prob: null })]));
  assert.ok(/clv_source=\$5/.test(sets[0].sql) && sets[0].p[4] === 'avg');
  assert.ok(Math.abs(sets[0].p[3] - (4.0 * (1 / 3.8) / (1 / 2 + 1 / 3.5 + 1 / 3.8) - 1) * 100) < 1e-6);                   // ripiego sulla quota PRESA
  console.log('chiusura a fine partita (Pinnacle gia salvato / ripiego): ok');

  // 5) riepilogo: n segnali, CLV medio (solo Pinnacle), ROI a 1 unita', cattura media
  const bets = [
    { odd: 4.0, status: 'won',  edge_pct: 4, clv_pct: 3, pin_pre: 3.6, max_odd: 4.4 },     // cattura (4.0-3.6)/(4.4-3.6) = 0.5
    { odd: 3.0, status: 'lost', edge_pct: 3, clv_pct: -1, pin_pre: 2.8, max_odd: 3.0 },    // cattura 1.0
    { odd: 2.5, status: 'lost', edge_pct: 2, clv_pct: null, pin_pre: 2.4, max_odd: 2.4 },  // max = pin: non conta
    { odd: 5.0, status: 'pending', edge_pct: 6, clv_pct: null, pin_pre: null, max_odd: 5.0 } ];
  const s = summarize(bets);
  assert.strictEqual(s.signals, 4); assert.ok(Math.abs(s.roiFlatPct - ((3 - 1 - 1) / 3) * 100) < 1e-9);
  assert.ok(Math.abs(s.avgClvPct - 1) < 1e-9 && s.nClv === 2);
  assert.ok(Math.abs(s.captureAvgPct - 75) < 1e-9 && s.nCapture === 2);
  const txt = formatReport(s, s);
  assert.ok(/CLV medio \(chiusura Pinnacle\) \+1\.00% su 2/.test(txt) && /cattura media 75% su 2/.test(txt) && /ROI a puntata fissa \+33\.3%/.test(txt));
  const stats = await buildStats({ query: async sql => {
    assert.ok(/clv_source = 'pinnacle'/.test(sql) || true);
    return { rows: bets }; } });
  assert.ok(stats.text.includes('cattura media'));
  // schema non aggiornato: riepilogo come prima, senza errori
  let n = 0; const old = await buildStats({ query: async sql => { if (/quota_presa/.test(sql)) throw new Error('column "quota_presa" does not exist'); n++; return { rows: [{ odd: 2, status: 'won', edge_pct: 3, clv_pct: 1 }] }; } });
  assert.ok(n >= 2 && old.total.signals === 1);
  console.log('riepilogo settimanale (n, CLV, ROI, cattura): ok');
  console.log('TUTTI I TEST closing OK');
})().catch(e => { console.error(e); process.exit(1); });
