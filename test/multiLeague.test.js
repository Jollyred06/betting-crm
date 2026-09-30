const assert = require('assert'), fs = require('fs'), path = require('path');
const { createJob, normalizeRows, toCsv, COLUMNS } = require('../services/multiLeague');
const real = fs.readFileSync(path.join(__dirname, '..', 'data', 'history', 'SA_2425.csv'), 'utf8');   // file reale di football-data

const rows = normalizeRows('I1', '2425', real);
assert.strictEqual(rows.length, 380);
assert.strictEqual(rows[0].date, '2024-08-17');
assert.ok(rows.every(r => ['H', 'D', 'A'].includes(r.ftr)));
assert.ok(rows.filter(r => r.ps_h !== '').length > 300 && rows.filter(r => r.b365_o25 !== '').length > 300);
assert.strictEqual(normalizeRows('X', '1', 'Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR\nI1,01/01/2025,A,B,,,\n').length, 0);   // partita non giocata: scartata
assert.ok(rows.filter(r => r.bfe_h !== '').length > 300, 'quote Betfair Exchange non lette');
const csv = toCsv(rows); assert.strictEqual(csv.split('\n').length, 381); assert.strictEqual(csv.split('\n')[0].split(',').length, COLUMNS.length);
console.log('normalizzazione su file reale: ok');

(async () => {
  let n429 = 0; const sleeps = [];
  const http = async url => {
    if (url.includes('/1718/I1')) { const e = new Error('nf'); e.status = 404; throw e; }
    if (url.includes('/1617/I1') && n429++ === 0) { const e = new Error('rate'); e.status = 429; throw e; }
    if (url.includes('/1617/E0')) { const e = new Error('boom'); e.status = 500; throw e; }
    return real;
  };
  const job = createJob({ http, sleep: async ms => { sleeps.push(ms); }, leagues: ['I1', 'E0'], seasons: ['1617', '1718'] });
  await job.run();
  const s = job.status();
  assert.strictEqual(s.finished, true); assert.strictEqual(s.fileElaborati, 4);
  assert.strictEqual(s.fileAssenti, 1);                          // I1 1718: 404
  assert.strictEqual(s.errori.length, 1);                        // E0 1617: 500 dopo 4 tentativi (non blocca il resto)
  assert.ok(sleeps.includes(30000));                             // pausa dopo il 429
  assert.strictEqual(s.partite, 760);                            // I1 1617 (dopo il retry) + E0 1718
  assert.ok(job.csv().startsWith('league,season,date'));
  console.log('flusso (429, 404, errori isolati): ok');
  console.log('TUTTI I TEST multiLeague OK');
})().catch(e => { console.error(e); process.exit(1); });
