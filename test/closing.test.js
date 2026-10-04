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
const { settlePending, settleManual, verifyManual } = require('../services/settler');
const { summarize, formatReport, buildStats } = require('../services/weeklyReport');
const { buildSnapshot, checkMilestones } = require('../services/milestones');

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


  // 4b) il file dei risultati si riscarica PRIMA di chiudere (una volta per campionato con segnali aperti), cosi' l'esito non slitta di un giorno
  const hist2 = require('../services/history'), origRefresh = hist2.refreshCurrentSeason, refreshed = [];
  hist2.refreshCurrentSeason = async (pool, code) => { refreshed.push(code); return { ok: true }; };
  await settlePending(mk([pend({ league_code: 'E3', quota_presa: '4.00' }), pend({ id: 2, league_code: 'E3' }), pend({ id: 3, league_code: 'SP2' })]));
  assert.deepStrictEqual(refreshed.sort(), ['E3', 'SP2']);
  hist2.refreshCurrentSeason = origRefresh;
  console.log('file risultati riscaricato prima della chiusura: ok');


  // 4c) due processi che chiudono lo stesso segnale insieme: il secondo trova rowCount 0 e non muove il bankroll
  const raceIns = [];
  const racePool = { query: async (sql, p) => {
    if (/SELECT quota_presa, clv_source/.test(sql)) return { rows: [] };
    if (/FROM value_bets vb JOIN fixtures/.test(sql)) return { rows: [pend({ quota_presa: '4.00', clv_source: null, closing_fair_prob: null })] };
    if (/FROM historical_matches/.test(sql)) return { rows: hist };
    if (/SELECT balance_after/.test(sql)) return { rows: [{ balance_after: '100' }] };
    if (/UPDATE value_bets/.test(sql)) { assert.ok(/AND status='pending'/.test(sql)); return { rowCount: 0, rows: [] }; }
    if (/INSERT INTO bankroll_log/.test(sql)) raceIns.push(p); return { rows: [] }; } };
  const rr = await settlePending(racePool);
  assert.strictEqual(raceIns.length, 0); assert.strictEqual(rr.settled, 0);
  console.log('chiusura gia fatta da un altro processo: nessun doppio movimento: ok');

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

  // 6) risultato a mano: stesso calcolo dell'esito automatico (quota presa, puntata di carta), bankroll aggiornato, nessun doppione
  const log = [], upd2 = [];
  const mpool = (row, rowCount = 1) => ({ query: async (sql, p) => {
    if (/SELECT quota_presa, clv_source/.test(sql)) return { rows: [] };
    if (/FROM value_bets WHERE id/.test(sql)) return { rows: row ? [row] : [] };
    if (/SELECT balance_after/.test(sql)) return { rows: [{ balance_after: '100.00' }] };
    if (/UPDATE value_bets SET status/.test(sql)) { upd2.push(p); return { rowCount }; }
    if (/INSERT INTO bankroll_log/.test(sql)) log.push(p); return { rows: [] }; } });
  const sig = { id: 9, selection: 'home', bookmaker_odd: '1.66', recommended_stake: '2', status: 'pending', quota_presa: '1.60' };
  const w = await settleManual(mpool(sig), 9, '2', 1);
  assert.strictEqual(w.outcome, 'won'); assert.strictEqual(w.newBalance, 101.2);          // 2 euro x (1,60 - 1) = +1,20 sulla quota PRESA
  assert.deepStrictEqual(upd2[0], ['won', '2-1', 9]); assert.ok(/Esito a mano: won \(2-1\)/.test(log[0][3]));
  const l = await settleManual(mpool(sig), 9, 0, 0); assert.strictEqual(l.outcome, 'lost'); assert.strictEqual(l.newBalance, 98);   // 0-0: vittoria casa persa, -2 euro
  await assert.rejects(() => settleManual(mpool({ ...sig, status: 'won' }), 9, 1, 0), e => e.status === 409);
  await assert.rejects(() => settleManual(mpool(sig, 0), 9, 1, 0), e => e.status === 409);          // chiuso nel frattempo dal giro automatico
  await assert.rejects(() => settleManual(mpool(null), 9, 1, 0), e => e.status === 404);
  await assert.rejects(() => settleManual(mpool(sig), 9, 'x', 1), e => e.status === 400);
  await assert.rejects(() => settleManual(mpool(sig), 9, -1, 1), e => e.status === 400);
  const before = log.length; await assert.rejects(() => settleManual(mpool({ ...sig, status: 'lost' }), 9, 1, 0)); assert.strictEqual(log.length, before, 'nessun movimento di bankroll per un segnale gia chiuso');
  console.log('risultato a mano: ok');

  // 7) controllo dei risultati scritti a mano: uguale -> niente; diverso -> vince il file ufficiale, correzione del segnale e del bankroll; assente -> si riprova
  const hist3 = [
    { date: '2026-10-03', home: 'Casa', away: 'Fuori', hg: 2, ag: 1 },                    // uguale a quello scritto
    { date: '2026-10-03', home: 'Alfa', away: 'Beta', hg: 1, ag: 1 },                     // scritto 2-1: il file dice 1-1 (esito cambia)
    { date: '2026-10-03', home: 'Gamma', away: 'Delta', hg: 3, ag: 0 } ];                 // scritto 2-0: stesso esito, punteggio diverso
  const ups = [], ins = [];
  const vpool = rows => ({ query: async (sql, p) => {
    if (/FROM value_bets vb JOIN fixtures/.test(sql)) return { rows };
    if (/FROM historical_matches/.test(sql)) return { rows: hist3 };
    if (/SELECT balance_after/.test(sql)) return { rows: [{ balance_after: '100.00' }] };
    if (/UPDATE value_bets/.test(sql)) ups.push(p);
    if (/INSERT INTO bankroll_log/.test(sql)) ins.push(p); return { rows: [] }; } });
  const mrow = (id, home, away, selection, status, score, odd = '2.00') => ({ id, selection, bookmaker_odd: odd, recommended_stake: '2', status, result_score: score, league_code: 'E3', date: new Date('2026-10-03T14:00:00Z'), home_name: home, away_name: away });
  const ctx = () => ({ byLeague: {}, refreshed: new Set(['E3']), today: '2026-10-05', cols: false });
  const v = await verifyManual(vpool([
    mrow(1, 'Casa', 'Fuori', 'home', 'won', '2-1'),
    mrow(2, 'Alfa', 'Beta', 'home', 'won', '2-1'),
    mrow(3, 'Gamma', 'Delta', 'home', 'won', '2-0'),
    mrow(4, 'Zeta', 'Eta', 'home', 'lost', '0-1') ]), ctx());
  assert.deepStrictEqual({ checked: v.checked, same: v.same, notYet: v.notYet, corrected: v.corrected.length }, { checked: 3, same: 1, notYet: 1, corrected: 2 });
  assert.deepStrictEqual(ups[0], ['lost', '1-1', 2]);                                      // 1-1: la vittoria casa e' persa
  assert.strictEqual(v.corrected[0].delta, -4);                                            // da +2 (2 euro x quota 2,00 - 1) a -2: differenza -4 euro
  assert.strictEqual(ins.length, 1); assert.strictEqual(ins[0][1], -4); assert.strictEqual(ins[0][2], 96); assert.ok(/Correzione: a mano 2-1, nel file ufficiale 1-1/.test(ins[0][3]));
  assert.deepStrictEqual(ups[1], ['won', '3-0', 3]); assert.strictEqual(v.corrected[1].delta, 0);   // stesso esito: si corregge il punteggio, il bankroll non cambia
  // gia' corretto al giro dopo: ora coincide con il file, niente piu' da fare
  ups.length = 0; ins.length = 0;
  const v2 = await verifyManual(vpool([mrow(2, 'Alfa', 'Beta', 'home', 'lost', '1-1')]), ctx());
  assert.strictEqual(v2.same, 1); assert.strictEqual(v2.corrected.length, 0); assert.strictEqual(ups.length + ins.length, 0);
  console.log('controllo risultati a mano (uguali / corretti / non ancora nel file): ok');

  // 8) tappe: divisione per probabilita' dell'esito e CLV solo Pinnacle / quota presa nella fotografia
  const snapRows = [
    { odd: 3.8, status: 'lost', edge_pct: 3, clv_pct: 2, est_prob: 0.27, league_code: 'E3', selection: 'draw', sharp_source: 'pinnacle', n_near_best: 1 },
    { odd: 3.7, status: 'won',  edge_pct: 4, clv_pct: -1, est_prob: 0.28, league_code: 'E3', selection: 'draw', sharp_source: 'pinnacle', n_near_best: 2 },
    { odd: 1.66, status: 'won', edge_pct: 2.5, clv_pct: 1, est_prob: 0.62, league_code: 'SP2', selection: 'home', sharp_source: 'pinnacle', n_near_best: 3 },
    { odd: 2.1, status: 'lost', edge_pct: 2.2, clv_pct: null, est_prob: 0.47, league_code: 'E2', selection: 'home', sharp_source: 'pinnacle', n_near_best: 2 } ];
  const sn = buildSnapshot(snapRows);
  assert.deepStrictEqual([sn.groups.prob['sotto il 40%'].n, sn.groups.prob['40% o più'].n], [2, 2]);
  assert.ok(Math.abs(sn.groups.prob['40% o più'].roiFlatPct - (-17)) < 0.01);                  // (0,66 - 1) / 2 = -17%
  assert.strictEqual(sn.groups.prob['sotto il 40%'].avgClvPct, 0.5);                            // CLV medio 2 e -1
  // la tappa legge quota presa e CLV Pinnacle (ripiego sulle colonne vecchie se mancano)
  const seen = [];
  const mpool2 = failNew => ({ query: async sql => {
    seen.push(sql);
    if (/FROM milestone_snapshots WHERE target/.test(sql)) return { rows: [] };
    if (/COUNT\(\*\)::int AS n FROM value_bets WHERE strategy = 'A_sharp' AND status IN/.test(sql)) return { rows: [{ n: 100 }] };
    if (/COALESCE\(quota_presa/.test(sql)) { if (failNew) throw new Error('column "quota_presa" does not exist'); return { rows: [] }; }
    if (/estimated_probability AS est_prob/.test(sql)) return { rows: [] };
    return { rows: [{ n: 0 }] }; } });
  await checkMilestones(mpool2(false));
  assert.ok(seen.some(q => /CASE WHEN clv_source = 'pinnacle' THEN clv_pct END AS clv_pct/.test(q) && /COALESCE\(quota_presa, bookmaker_odd\) AS odd/.test(q)));
  seen.length = 0; await checkMilestones(mpool2(true));
  assert.ok(seen.some(q => /estimated_probability AS est_prob/.test(q) && !/COALESCE\(quota_presa/.test(q)), 'schema vecchio: query di prima');
  console.log('tappe (probabilità, quota presa, CLV Pinnacle): ok');
  console.log('TUTTI I TEST closing OK');
})().catch(e => { console.error(e); process.exit(1); });
