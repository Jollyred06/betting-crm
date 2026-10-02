// Verifica: il modello V1 in JavaScript (quello che gira sul server) dà le STESSE
// probabilità della versione Python usata nel backtest, su tutte le 1.520 partite.
const fs = require('fs');
const path = require('path');
const history = require('../services/history');
const { buildContext, predict } = require('../services/modelV1');

const dir = path.join(__dirname, '..', 'data', 'history');
let matches = [];
for (const f of fs.readdirSync(dir).sort()) {
  if (!/^SA_\d{4}\.csv$/.test(f)) continue;
  matches = matches.concat(history.rowsToMatches('SA', history.parseCsv(fs.readFileSync(path.join(dir, f), 'utf8')))
    .map(m => ({ date: m.date, home: m.home, away: m.away, hg: m.hg, ag: m.ag })));
}
matches.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)); // stabile: stesso ordine del backtest

const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'python_v1_reference.json'), 'utf8'));
if (ref.length !== matches.length) { console.log('ERRORE: numero partite diverso', ref.length, matches.length); process.exit(1); }

let maxDiff = 0, worst = null, mismatchNames = 0;
ref.forEach((r, i) => {
  const m = matches[i];
  if (m.date !== r.date || m.home !== r.home || m.away !== r.away) { mismatchNames++; return; }
  const p = predict(buildContext(matches, m.home, m.away, m.date));
  const js = [p.home, p.draw, p.away, p.over25, p.under25, p.hxg, p.axg];
  const py = [...r.p, r.hxg, r.axg];
  js.forEach((v, k) => { const d = Math.abs(v - py[k]); if (d > maxDiff) { maxDiff = d; worst = { i, k, js: v, py: py[k] }; } });
});
console.log(`Partite confrontate: ${ref.length}; ordine/nomi diversi: ${mismatchNames}`);
console.log(`Differenza massima JS vs Python: ${maxDiff.toExponential(2)}`, worst || '');
process.exit(maxDiff < 1e-9 && mismatchNames === 0 ? 0 : 1);
