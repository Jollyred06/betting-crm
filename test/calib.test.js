// Storico e taratura: lettura dei CSV, calibrazione, correzione con la lega, scarico in sottofondo. Senza rete e senza database vero.
const assert = require('assert'), Module = require('module'), origLoad = Module._load;
Module._load = function (request) {
  if (request === 'dotenv') return { config() {} };
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async () => {} }) };
  if (request === 'pg') return { Pool: function () { return { query: async () => ({ rows: [] }) }; } };
  return origLoad.apply(this, arguments);
};
const C = require('../services/calib');
(async () => {
  const csv = 'Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,PSCH,PSCD,PSCA,PSH,PSD,PSA\nE0,15/08/2025,A,B,1,1,2.0,3.5,4.0,2.1,3.4,3.9\nE0,16/08/2025,C,D,2,0,,,,1.8,3.8,4.6\nE0,17/08/2025,E,F,0,0,,,,,,\nE0,18/08/2025,G,H,,,2,3,4,2,3,4\n';
  const H = require('../services/history'), rows = C.rowsToPin('E0', H.parseCsv(csv));
  assert.strictEqual(rows.length, 2, 'senza quote Pinnacle o senza risultato la riga si salta');
  assert.deepStrictEqual([rows[0].ph, rows[0].pd, rows[0].pa], [2, 3.5, 4], 'chiusura quando c\'e\'');
  assert.deepStrictEqual([rows[1].ph, rows[1].pd, rows[1].pa], [1.8, 3.8, 4.6], 'altrimenti le quote prima della chiusura');
  // file "new": colonne Home/Away/HG/AG
  const n = C.rowsToPin('SWE', H.parseCsv('Country,League,Season,Date,Time,Home,Away,HG,AG,Res,PSCH,PSCD,PSCA\nSweden,Allsvenskan,2025,05/04/2025,15:00,X,Y,2,1,H,1.9,3.6,4.2\n'), true);
  assert.strictEqual(n.length, 1); assert.strictEqual(n[0].hg, 2);
  // taratura: 1000 partite, favorita al 50% che vince solo il 45% in una lega, e il 50% nelle altre
  const mk = (lg, win, tot) => Array.from({ length: tot }, (_, i) => ({ league: lg, hg: i < win ? 1 : 0, ag: i < win ? 0 : 1, ph: 2, pd: 100, pa: 2 }));
  const cal = C.calibrate([...mk('A', 90, 200), ...mk('B', 100, 200), ...mk('B', 100, 200)]);
  assert.strictEqual(cal.n, 600);
  const base = C.adjust(cal, 'ZZ', 'home', 0.49);
  assert.ok(Math.abs(base.shift) < 0.02, 'lega sconosciuta: vale il generale');
  const a = C.adjust(cal, 'A', 'home', 0.49), b = C.adjust(cal, 'B', 'home', 0.49);
  assert.ok(a.p < b.p, 'la lega dove la favorita rende meno scende');
  assert.ok(a.n === 200 && C.adjust(null, 'A', 'home', 0.49).p === 0.49);
  const rep = C.report(C.calibrate([...mk('A', 60, 400), ...mk('B', 200, 400)]));
  assert.ok(rep.general.length > 0 && rep.odd.some(x => x.league === 'A'), 'la lega anomala viene segnalata');
  // scarico: tutte le leghe con file, errori contati senza fermarsi
  const state = { inserted: 0, last: null }, pool = { query: async (sql, p) => {
    if (/CREATE/.test(sql)) return { rows: [] };
    if (/INSERT INTO hist_pin/.test(sql)) { state.inserted += p.length / 9; return { rowCount: 1 }; }
    if (/calib_state/.test(sql) && /INSERT/.test(sql)) { state.last = p[0]; return { rowCount: 1 }; }
    if (/FROM calib_state/.test(sql)) return { rows: state.last ? [{ val: state.last }] : [] };
    return { rows: [] }; } };
  let calls = 0; const http = { get: async url => { calls++; if (/2122|2223/.test(url)) throw new Error('404'); return { data: csv.replace(/E0,/g, 'E0,') }; } };
  const out = await C.refreshHistory(pool, { nowMs: Date.parse('2026-11-14T12:00:00Z'), http });
  assert.ok(calls > 20 && out.errori > 0 && out.partite > 0 && state.inserted === out.partite);
  const cur = await C.refreshHistory(pool, { nowMs: Date.parse('2026-11-14T12:00:00Z'), http, current: true });
  assert.ok(cur.files > 0 && cur.files < out.files, 'aggiornamento giornaliero: solo la stagione in corso');
  assert.deepStrictEqual(C.urlsFor('PL', Date.parse('2026-11-14T12:00:00Z'), 2).map(u => u.url.match(/mmz4281\/(\d+)/)[1]), ['2627', '2526']);
  console.log('storico e taratura: ok');
})().catch(e => { console.error(e); process.exit(1); });
