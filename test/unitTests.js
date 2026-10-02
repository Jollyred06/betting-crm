// Test senza database né rete: nomi squadra, quote, selezione segnali, lettura CSV.
const fs = require('fs'), path = require('path'), assert = require('assert');
const history = require('../services/history');
const { resolveHistoryTeam, sameTeam } = require('../services/teamNames');
const { parseBestOdds, findCandidates, selectDailySignals } = require('../services/signals');
const modelV1 = require('../services/modelV1');

// --- CSV e date
assert.strictEqual(history.parseDate('23/08/2025'), '2025-08-23');
assert.strictEqual(history.parseDate('5/1/24'), '2024-01-05');
assert.strictEqual(history.seasonCode('2026-10-04'), '2627');
assert.strictEqual(history.seasonCode('2027-03-01'), '2627');
const dir = path.join(__dirname, '..', 'data', 'history');
let all = [];
for (const f of fs.readdirSync(dir).sort()) all = all.concat(history.rowsToMatches('SA', history.parseCsv(fs.readFileSync(path.join(dir, f), 'utf8'))));
assert.strictEqual(all.length, 1520);
console.log('CSV: 1520 partite lette, date e stagioni ok');

// --- Nomi squadra (i nomi "API" sono quelli che mi aspetto: da confermare col primo log reale)
const csvNames = [...new Set(all.slice(-380).flatMap(m => [m.home, m.away]))];
const cases = [
  ['FC Internazionale Milano', 'Inter'], ['Inter Milan', 'Inter'], ['AC Milan', 'Milan'], ['Milan', 'Milan'],
  ['Juventus FC', 'Juventus'], ['SSC Napoli', 'Napoli'], ['AS Roma', 'Roma'], ['SS Lazio', 'Lazio'],
  ['Atalanta BC', 'Atalanta'], ['ACF Fiorentina', 'Fiorentina'], ['Hellas Verona FC', 'Verona'],
  ['Bologna FC 1909', 'Bologna'], ['Torino FC', 'Torino'], ['Udinese Calcio', 'Udinese'], ['Genoa CFC', 'Genoa'],
  ['Cagliari Calcio', 'Cagliari'], ['US Lecce', 'Lecce'], ['Como 1907', 'Como'], ['US Sassuolo Calcio', 'Sassuolo'],
  ['Parma Calcio 1913', 'Parma'], ['AC Pisa 1909', 'Pisa'], ['US Cremonese', 'Cremonese']];
let bad = 0;
for (const [api, exp] of cases) { const r = resolveHistoryTeam(api, csvNames); if (r !== exp) { bad++; console.log('  NOME NON RISOLTO:', api, '->', r, '(atteso', exp + ')'); } }
assert.strictEqual(bad, 0);
assert.strictEqual(sameTeam('Inter Milan', 'FC Internazionale Milano', csvNames), true);
assert.strictEqual(sameTeam('AC Milan', 'FC Internazionale Milano', csvNames), false);   // il vecchio abbinamento sbagliava qui
assert.strictEqual(sameTeam('Inter Milan', 'AC Milan', csvNames), false);
assert.strictEqual(resolveHistoryTeam('Squadra Sconosciuta', csvNames), null);
console.log(`Nomi squadra: ${cases.length} casi ok (incluso Inter/Milan)`);

// --- Quote migliori
const ev = { home_team: 'Inter Milan', away_team: 'AC Milan', bookmakers: [
  { title: 'A', markets: [{ key: 'h2h', outcomes: [{ name: 'Inter Milan', price: 2.0 }, { name: 'AC Milan', price: 3.5 }, { name: 'Draw', price: 3.3 }] },
                          { key: 'totals', outcomes: [{ name: 'Over', point: 2.5, price: 1.9 }, { name: 'Under', point: 2.5, price: 1.95 }, { name: 'Over', point: 1.5, price: 1.3 }] }] },
  { title: 'B', markets: [{ key: 'h2h', outcomes: [{ name: 'Inter Milan', price: 2.1 }, { name: 'AC Milan', price: 3.4 }, { name: 'Draw', price: 3.2 }] }] }] };
const { odds, bookmakerBySelection } = parseBestOdds(ev);
assert.strictEqual(odds['1X2'].home, 2.1); assert.strictEqual(bookmakerBySelection['1X2'].home, 'B');
assert.strictEqual(odds['1X2'].away, 3.5); assert.strictEqual(odds['OU_2.5'].over, 1.9);
assert.strictEqual(Object.keys(odds).length, 2);   // niente Over/Under 1.5
console.log('Quote migliori: ok (solo 1X2 e Over/Under 2.5)');

// --- Candidati e protezioni
const pred = { home: 0.55, draw: 0.25, away: 0.20, over25: 0.55, under25: 0.45 };
const cand = findCandidates(pred, { '1X2': { home: 2.05, draw: 4.0, away: 6.5 }, 'OU_2.5': { over: 1.95, under: 2.6 } }, 0.03, 0.15);
// home: 0.55*2.05-1=+12.75% ok; draw: 0.25*4.0-1=0% no; away: 0.2*6.5-1=+30% scartato (>15%); over: +7.25% ok; under: 0.45*2.6-1=+17% scartato
assert.deepStrictEqual(cand.map(c => c.selection).sort(), ['home', 'over']);
const kelly = (odd, p) => 2;   // stake fisso 2 per il test
const many = Array.from({ length: 6 }, (_, i) => ({ market: '1X2', selection: 'home', odd: 2, p: 0.5, edge: 0.03 + i * 0.01 }));
let sel = selectDailySignals(many, 100, kelly, { maxSignals: 3, maxExposurePct: 0.10 });
assert.strictEqual(sel.chosen.length, 3); assert.strictEqual(sel.chosen[0].edge, 0.03);   // prima il vantaggio piu' piccolo
sel = selectDailySignals(many, 100, kelly, { maxSignals: 10, maxExposurePct: 0.05 });     // tetto 5 => massimo 2 puntate da 2
assert.strictEqual(sel.chosen.length, 2);
console.log('Candidati e protezioni: ok (soglia 3-15%, max 3 al giorno, tetto di esposizione)');

// --- Simulazione dell'analisi su una giornata reale della 2025/26 (senza database)
const ordered = [...all].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
const rawRows = history.parseCsv(fs.readFileSync(path.join(dir, 'SA_2526.csv'), 'utf8'));
const maxOdds = {};   // quote migliori pre-chiusura dal file, come proxy di quelle di The Odds API
rawRows.forEach(r => { maxOdds[`${history.parseDate(r.Date)}|${r.HomeTeam}|${r.AwayTeam}`] = { '1X2': { home: +r.MaxH, draw: +r.MaxD, away: +r.MaxA }, 'OU_2.5': { over: +r['Max>2.5'], under: +r['Max<2.5'] } }; });
let daysWithMatches = 0, totalCand = 0, totalChosen = 0, maxChosen = 0;
const days = [...new Set(ordered.filter(m => m.date >= '2025-10-01' && m.date <= '2026-05-31').map(m => m.date))];
for (const d of days) {
  const cs = [];
  for (const m of ordered.filter(x => x.date === d)) {
    const ctx = modelV1.buildContext(ordered, m.home, m.away, d);
    if (ctx.recentHome < 10 || ctx.recentAway < 10) continue;
    const o = maxOdds[`${d}|${m.home}|${m.away}`]; if (!o) continue;
    findCandidates(modelV1.predict(ctx), o, 0.03, 0.15).forEach(c => cs.push(c));
  }
  daysWithMatches++; totalCand += cs.length;
  const s = selectDailySignals(cs, 100, (odd, p) => 2, { maxSignals: 3, maxExposurePct: 0.10 });
  totalChosen += s.chosen.length; maxChosen = Math.max(maxChosen, s.chosen.length);
}
console.log(`Simulazione ${daysWithMatches} giornate 2025/26: candidati totali ${totalCand} (media ${(totalCand / daysWithMatches).toFixed(1)} al giorno), segnali salvati ${totalChosen} (media ${(totalChosen / daysWithMatches).toFixed(1)}, massimo ${maxChosen} al giorno)`);
console.log('TUTTI I TEST OK');
