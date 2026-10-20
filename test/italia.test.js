// Strategia I (quote italiane): parte pura, senza rete ne' database.
const assert = require('assert');
const it = require('../services/italia');
const { noVigPower } = require('../services/sharpSignals');

const NOW = Date.parse('2026-10-17T10:00:00Z');
const t = h => new Date(NOW + h * 3600000).toISOString();
const upd = new Date(NOW - 5 * 60000).toISOString();
const bk = (key, h, d, a, extra = {}) => ({ key, outcomes: { HOME: h, DRAW: d, AWAY: a }, suspended: [], last_update: upd, ...extra });
const rec = (id, hours, books, extra = {}) => ({ event_id: id, event: 'Casa - Ospite', league: 'Serie A', home_team: 'Casa', away_team: 'Ospite', commence_time: t(hours), market: '1x2', scope: 'match', period: 'full_time', state: 'prematch', bookmakers: books, ...extra });
const c = it.cfg({ ODSS_API_KEY: 'x' });

// 1) segnale normale: Netwin paga il pareggio 3,80 contro un Pinnacle 2,10 / 3,40 / 3,90
const pin = bk('pinnacle', 2.10, 3.40, 3.90);
let s = it.findSignals([rec('e1', 3, [pin, bk('netwin', 2.00, 3.80, 3.60), bk('sisal', 2.05, 3.30, 3.70)])], c, NOW);
assert.strictEqual(s.length, 1, 'un solo segnale (il pareggio)');
assert.strictEqual(s[0].selection, 'draw'); assert.strictEqual(s[0].book, 'netwin'); assert.strictEqual(s[0].odd, 3.8);
const fair = noVigPower({ home: 2.10, draw: 3.40, away: 3.90 }).draw;
assert.ok(Math.abs(s[0].edge_pct - (3.8 * fair - 1) * 100) < 1e-9, 'edge col metodo power del CRM');
assert.strictEqual(s[0].netwin_odd, 3.8);
assert.deepStrictEqual(Object.keys(s[0].quotes).sort(), ['netwin', 'sisal']);

// 2) il primo tempo non conta, anche se ha quote "di valore"
s = it.findSignals([rec('e2', 3, [bk('pinnacle', 2.9, 2.1, 4.2), bk('netwin', 3.4, 2.2, 4.8)], { period: '1st_half' })], c, NOW);
assert.strictEqual(s.length, 0, 'righe del primo tempo ignorate');

// 3) fuori finestra (oltre 6 ore) o troppo vicina (meno di 15 minuti): niente
assert.strictEqual(it.findSignals([rec('e3', 7, [pin, bk('netwin', 2.0, 3.8, 3.6)])], c, NOW).length, 0);
assert.strictEqual(it.findSignals([rec('e4', 0.1, [pin, bk('netwin', 2.0, 3.8, 3.6)])], c, NOW).length, 0);

// 4) quota 5 o piu': esclusa (selezione B)
s = it.findSignals([rec('e5', 2, [bk('pinnacle', 1.6, 4.0, 5.6), bk('netwin', 1.55, 3.9, 6.2)])], c, NOW);
assert.strictEqual(s.length, 0, 'quota alta esclusa');

// 5) quota italiana incoerente (altro mercato o errore): scartata intera
s = it.findSignals([rec('e6', 2, [pin, bk('netwin', 3.1, 3.8, 2.2)])], c, NOW);
assert.strictEqual(s.length, 0, 'riga incoerente scartata');

// 6) edge sopra il 15%: quasi sempre un errore del feed, non si segnala
s = it.findSignals([rec('e7', 2, [pin, bk('netwin', 2.0, 4.4, 3.6)])], c, NOW);
assert.strictEqual(s.length, 0, 'edge esagerato scartato');

// 7) esito sospeso o quota vecchia: non si usa
s = it.findSignals([rec('e8', 2, [pin, bk('netwin', 2.0, 3.8, 3.6, { suspended: ['DRAW'] })])], c, NOW);
assert.strictEqual(s.length, 0, 'esito sospeso');
s = it.findSignals([rec('e9', 2, [pin, bk('netwin', 2.0, 3.8, 3.6, { last_update: new Date(NOW - 3600000).toISOString() })])], c, NOW);
assert.strictEqual(s.length, 0, 'quota vecchia di un\'ora');

// 8) bookmaker non scelto (es. stake) non genera segnali
s = it.findSignals([rec('e10', 2, [pin, bk('stake', 2.0, 3.8, 3.6)])], c, NOW);
assert.strictEqual(s.length, 0, 'solo i libri scelti');

// 9) il migliore tra piu' libri italiani, e la quota Netwin a parte
s = it.findSignals([rec('e11', 2, [pin, bk('netwin', 2.0, 3.65, 3.6), bk('888sport_it', 2.0, 3.85, 3.6)])], c, NOW);
assert.strictEqual(s.length, 1); assert.strictEqual(s[0].book, '888sport_it'); assert.strictEqual(s[0].netwin_odd, 3.65);
assert.ok(s[0].netwin_edge_pct < s[0].edge_pct);

// 10) chiusura: solo la riga della partita intera
const close = it.closingPin([rec('e1', 0.3, [bk('pinnacle', 3.0, 2.0, 4.0)], { period: '1st_half' }), rec('e1', 0.3, [bk('pinnacle', 2.05, 3.5, 4.0)])], 'e1');
assert.deepStrictEqual(close, { home: 2.05, draw: 3.5, away: 4.0 });
assert.strictEqual(it.closingPin([], 'e1'), null);

// 11) statistiche: i segnali senza chiusura non contano come zero
const st = it.stats([{ clv_pct: '2.0' }, { clv_pct: null }, { clv_pct: '-1.0' }, { clv_pct: '3.0' }, { clv_pct: '1.0' }, { clv_pct: '0.5' }]);
assert.strictEqual(st.signals, 6); assert.strictEqual(st.measured, 5);
assert.ok(Math.abs(st.avgClvPct - 1.1) < 1e-9); assert.ok(st.clvCi95 && st.clvCi95[0] < 1.1 && st.clvCi95[1] > 1.1);
assert.strictEqual(st.positivePct, 80);

// 11b) stessa partita scritta in due modi: Netwin in una riga, Pinnacle in un'altra
assert.ok(it.sameTeam('Benfica', 'Benfica')); assert.ok(it.sameTeam('Celtic Glasgow', 'Celtic')); assert.ok(it.sameTeam('Lincoln City', 'Lincoln City FC'));
assert.ok(!it.sameTeam('Inter', 'Inter U23'), 'giovanili mai con la prima squadra'); assert.ok(!it.sameTeam('Real Madrid', 'Real Sociedad'));
s = it.findSignals([
  { ...rec('p1', 2, [pin]), home_team: 'Lincoln City', away_team: 'West Ham United' },
  { ...rec('n1', 2, [bk('netwin', 2.0, 3.8, 3.6)]), home_team: 'Lincoln City', away_team: 'West Ham' },
  { ...rec('x1', 2, [bk('sisal', 2.0, 3.9, 3.6)]), home_team: 'Lincoln City', away_team: 'West Ham', period: '1st_half' }
], c, NOW);
assert.strictEqual(s.length, 1); assert.strictEqual(s[0].event_id, 'p1'); assert.strictEqual(s[0].book, 'netwin');
s = it.findSignals([{ ...rec('p2', 2, [pin]), home_team: 'Inter', away_team: 'Roma' }, { ...rec('n2', 2, [bk('netwin', 2.0, 3.8, 3.6)]), home_team: 'Inter U23', away_team: 'Roma U23' }], c, NOW);
assert.strictEqual(s.length, 0, 'U23 non si abbina alla prima squadra');

// 11c) chiave copiata con spazi, a capo o virgolette: viene ripulita
assert.strictEqual(it.cfg({ ODSS_API_KEY: '  "odss_live_abc"\n' }).key, 'odss_live_abc');
assert.strictEqual(it.cfg({ ODSS_API_KEY: ' \n ' }).key, '');

// 11d) amichevoli escluse; fascia di quota consigliata
assert.strictEqual(it.findSignals([{ ...rec('f1', 2, [pin, bk('netwin', 2.0, 3.8, 3.6)]), league: 'Club Friendly Games' }], c, NOW).length, 0, 'amichevole esclusa');
assert.strictEqual(it.findSignals([{ ...rec('f2', 2, [pin, bk('netwin', 2.0, 3.8, 3.6)]), league: 'Amichevoli Internazionali' }], c, NOW).length, 0);
assert.ok(it.inBand(1.6) && it.inBand(2.6) && it.inBand(2.0) && !it.inBand(1.59) && !it.inBand(2.61));
const os = it.oddsStats([{ odd: 2, fair_prob: 0.5, clv_pct: '1' }, { odd: 2.2, fair_prob: 0.4, clv_pct: null }]);
assert.ok(Math.abs(os.expectedWinsOf10 - 4.5) < 1e-9); assert.strictEqual(os.measured, 1);

// 11e) strategia B: libri esteri della selezione B, edge 2-5%, stessa richiesta
const cB = it.cfgFor(c, 'B');
assert.deepStrictEqual(cB.books, it.DEFAULT_B_BOOKS); assert.strictEqual(cB.maxEdge, 5); assert.ok(!cB.books.includes('betsson') && !cB.books.includes('leovegas_se'));
s = it.findSignals([rec('b1', 2, [pin, bk('onexbet', 2.0, 3.65, 3.6), bk('netwin', 2.0, 3.8, 3.6)])], cB, NOW);
assert.strictEqual(s.length, 1); assert.strictEqual(s[0].book, 'onexbet');   // la quota Netwin non conta per B
assert.ok(s[0].edge_pct >= 2 && s[0].edge_pct <= 5);
assert.strictEqual(it.findSignals([rec('b2', 2, [pin, bk('onexbet', 2.0, 3.8, 3.6)])], cB, NOW).length, 0, 'B: edge sopra il 5% escluso');
assert.strictEqual(it.findSignals([rec('b3', 2, [pin, bk('betsson', 2.0, 3.65, 3.6)])], cB, NOW).length, 0, 'B: Betsson escluso');

assert.strictEqual(it.findSignals([{ ...rec('y1', 2, [pin, bk('netwin', 2.0, 3.8, 3.6)]), league: 'U21 Liga MX' }], c, NOW).length, 0, 'campionato giovanile escluso');
assert.strictEqual(it.findSignals([{ ...rec('y2', 2, [pin, bk('netwin', 2.0, 3.8, 3.6)]), league: 'Serie C, Gruppo B' }], c, NOW).length, 1, 'la B del girone non e\' una squadra B');

// 11f) selezione F: regole fissate il 17/10, solo segnali successivi; bookmaker escluso con lo storico negativo PRIMA del segnale
{
  const T = h => new Date(Date.parse('2026-10-18T10:00:00Z') + h * 3600000).toISOString();
  const r = (id, h, book, edge, odd, clv, closedH) => ({ id, created_at: T(h), book, edge_pct: String(edge), odd: String(odd), clv_pct: clv === null ? null : String(clv), close_captured_at: closedH === undefined ? null : T(closedH) });
  const base = [r(1, 0, 'netwin', 3, 2.0, null), r(2, 0, 'snai', 8, 2.0, null), r(3, 0, 'snai', 3, 4.2, null), r(4, 0, 'snai', 3, 1.5, null),
    { ...r(5, 0, 'goldbet', 3, 2.0, null), created_at: '2026-10-16T10:00:00Z' }];
  const m = it.markFinal(base);
  assert.strictEqual(m.get(1).final, true);
  assert.ok(!m.get(2).final && /vantaggio/.test(m.get(2).reasons[0]));
  assert.ok(!m.get(3).final && !m.get(4).final, 'quota fuori 1,60-3,50');
  assert.ok(!m.get(5).final && /prima delle regole/.test(m.get(5).reasons[0]));
  // 15 chiusure negative di Netwin prima del segnale 100: escluso; il segnale 99, precedente alle chiusure, resta valido
  const hist = Array.from({ length: 15 }, (_, i) => r(200 + i, -10, 'netwin', 3, 2.0, -3, 1));
  const m2 = it.markFinal([...hist, r(99, 0.5, 'netwin', 3, 2.0, null), r(100, 2, 'netwin', 3, 2.0, null)]);
  assert.strictEqual(m2.get(99).final, true); assert.ok(!m2.get(100).final && /bookmaker/.test(m2.get(100).reasons.join()));
}

assert.ok(Math.abs(it.expectedEur([{ clv_pct: '3' }, { clv_pct: '-1' }, { clv_pct: null }]) - 0.04) < 1e-9, 'guadagno atteso 2 € x (3% - 1%)');

// 12) senza chiave non fa niente (nessuna rete, nessun database)
(async () => {
  const r = await it.tick({ query: () => { throw new Error('non deve toccare il database'); } }, { env: {} });
  assert.strictEqual(r.attiva, false);

  // 13) ora italiana e testo dell'avviso
  assert.strictEqual(it.romeHour(Date.parse('2026-10-17T07:30:00Z')), 9);
  assert.strictEqual(it.romeHour(Date.parse('2026-12-17T07:30:00Z')), 8);
  const txt = it.signalText({ ...it.findSignals([rec('e11', 2, [pin, bk('netwin', 2.0, 3.65, 3.6), bk('888sport_it', 2.0, 3.85, 3.6)])], c, NOW)[0] });
  assert.ok(/X \(pareggio\)/.test(txt) && /888sport/.test(txt) && /Netwin: 3,65/.test(txt) && /almeno <b>3,\d\d<\/b>/.test(txt), txt);
  // quota minima: prezzo giusto + 2%, arrotondato per eccesso
  assert.strictEqual(it.minOdd(0.5, 2), 2.04); assert.strictEqual(it.minOdd(0.25, 2), 4.08);
  // --- selezione F2: entro 3 ore, vantaggio 4-8%, quota 1,60-3,50, solo dopo il 18/10 07:30Z
{
  const base = { book: 'snai', created_at: '2026-10-18T10:00:00Z', commence_time: '2026-10-18T12:30:00Z', edge_pct: 5, odd: 2.2 };
  const rows = [{ id: 1, ...base }, { id: 2, ...base, commence_time: '2026-10-18T14:00:00Z' }, { id: 3, ...base, edge_pct: 3 }, { id: 4, ...base, edge_pct: 9 },
    { id: 5, ...base, odd: 4 }, { id: 6, ...base, created_at: '2026-10-18T07:00:00Z', commence_time: '2026-10-18T09:00:00Z' }];
  const m = it.markFinal2(rows);
  assert.strictEqual(m.get(1).final, true);
  assert.ok(/3 ore/.test(m.get(2).reasons[0])); assert.ok(!m.get(3).final && !m.get(4).final); assert.ok(!m.get(5).final);
  assert.ok(/prima delle regole/.test(m.get(6).reasons[0]));
}
// --- selezione F3: favoriti con valore, quota 1,30-1,60, vantaggio 2-8%, solo dopo il 18/10 18:45Z
{
  const base = { book: 'snai', created_at: '2026-10-18T19:00:00Z', commence_time: '2026-10-18T23:00:00Z', edge_pct: 3, odd: 1.45 };
  const m = it.markFinal3([{ id: 1, ...base }, { id: 2, ...base, odd: 1.6 }, { id: 3, ...base, odd: 1.25 }, { id: 4, ...base, edge_pct: 1.5 }, { id: 5, ...base, created_at: '2026-10-18T18:00:00Z' }]);
  assert.strictEqual(m.get(1).final, true); assert.ok(!m.get(2).final && !m.get(3).final && !m.get(4).final);
  assert.ok(/prima delle regole/.test(m.get(5).reasons[0]));
}
// --- prima uscita e rilettura vicino al calcio d'inizio
{
  const r = (id, ev, phase, extra = {}) => ({ id, event_id: ev, selection: 'draw', strategy: 'I', phase, created_at: '2026-10-20T10:00:00Z', commence_time: '2026-10-20T18:00:00Z', ...extra });
  const rows = [r(1, 'a', 'far'), r(2, 'a', 'near'), r(3, 'b', 'near'), r(4, 'c', 'far')];
  assert.deepStrictEqual(it.primaryRows(rows).map(x => x.id), [1, 3, 4]);   // la rilettura di 'a' non conta due volte
  assert.deepStrictEqual(it.latestRows(rows).map(x => x.id), [2, 3, 4]);    // nell'app si vede la quota piu' recente
  assert.strictEqual(it.phaseOf({ created_at: '2026-10-20T16:00:00Z', commence_time: '2026-10-20T18:00:00Z' }), 'near');
  assert.strictEqual(it.phaseOf({ created_at: '2026-10-20T12:00:00Z', commence_time: '2026-10-20T18:00:00Z' }), 'far');
}
console.log('italia.test.js: tutti i controlli passati');
})().catch(e => { console.error(e); process.exit(1); });
