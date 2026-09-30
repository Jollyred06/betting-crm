// Test con un mini-dataset inventato nello stesso formato di Transfermarkt (stelle, assenze, valori che cambiano nel tempo).
const assert = require('assert'), { Readable } = require('stream');
const { build, toCsv, valueAt, createJob } = require('../services/tmFeatures');

const A = Array.from({ length: 11 }, (_, i) => 101 + i), B = Array.from({ length: 11 }, (_, i) => 201 + i);
// valori: il giocatore 101 (stella di A) vale 50M dal 2017; tutti gli altri 1M; il 112 (riserva di A) 2M
let val = 'player_id,date,datetime,dateweek,market_value_in_eur,current_club_id,player_club_domestic_competition_id\n';
for (const p of [...A, ...B, 112]) val += `${p},2017-01-01,x,x,${p === 101 ? 50000000 : (p === 112 ? 2000000 : 1000000)},1,IT1\n`;
val += `101,2018-01-01,x,x,60000000,1,IT1\n`;                                    // la stella sale a 60M nel 2018
// 14 partite tra club 1 (A) e 2 (B) a settimane alterne, piu' una in un campionato non seguito
let games = 'game_id,competition_id,season,round,date,home_club_id,away_club_id,home_club_goals,away_club_goals,home_club_name,away_club_name\n';
let lin = 'game_lineups_id,date,game_id,player_id,club_id,player_name,type,position,number,team_captain\n';
const start = Date.parse('2017-09-01T00:00:00Z');
for (let g = 1; g <= 14; g++) {
  const d = new Date(start + (g - 1) * 7 * 86400000).toISOString().slice(0, 10), home = g % 2 ? 1 : 2, away = g % 2 ? 2 : 1;
  games += `${g},IT1,2017,x,${d},${home},${away},${g % 3},1,${home === 1 ? 'Club A' : 'Club B'},${home === 1 ? 'Club B' : 'Club A'}\n`;
  const aXI = g === 14 ? [...A.slice(1), 112] : A;                            // nell'ultima partita la stella (101) NON gioca: al suo posto il 112
  for (const p of aXI) lin += `L,${d},${g},${p},1,n,starting_lineup,x,1,False\n`;
  for (const p of B) lin += `L,${d},${g},${p},2,n,starting_lineup,x,1,False\n`;
  lin += `L,${d},${g},999,1,n,substitutes,x,1,False\n`;                         // panchina: ignorata
}
games += `99,ZZ9,2017,x,2017-10-01,1,2,1,0,Club A,Club B\n`;                  // campionato non seguito: ignorato
games += `98,IT1,2017,x,2017-10-08,1,2,,,Club A,Club B\n`;                    // partita non giocata: ignorata
games += `50,IT1,2015,x,2015-10-08,1,2,1,0,Club A,Club B\n`;                  // troppo vecchia: ignorata

const files = { 'player_valuations.csv.gz': val, 'games.csv.gz': games, 'game_lineups.csv.gz': lin };
const open = async name => Readable.from([files[name]]);

(async () => {
  const { rows, info } = await build({ open });
  assert.strictEqual(rows.length, 14); assert.strictEqual(info.games, 14);
  assert.deepStrictEqual(info.competitions, { IT1: 14 });
  const r1 = rows[0], r14 = rows[13];
  // partita 1: nessuna storia -> valore XI = 50 + 10*1 = 60M (la stella vale 50M nel 2017), assenze non calcolabili
  assert.strictEqual(r1.h_xi_value, 60); assert.strictEqual(r1.h_squad_value, 0); assert.strictEqual(r1.h_absent_share, '');
  assert.strictEqual(rows[1].h_xi_value, 11);                                   // partita 2, Club B in casa: 11 giocatori da 1M
  assert.ok(rows[4].h_absent_share === 0 || Math.abs(rows[4].h_absent_share) < 1e-12);   // stessa formazione: nessuna assenza
  assert.ok(rows[4].h_squad_value > 50);                                         // rosa: 61M circa (la stella + altri)
  // partita 14: Club A (trasferta, g pari) senza la stella. Il 101 vale 50M (valutazione 2017; quella da 60M e' del 2018, dopo la partita)
  assert.strictEqual(r14.away_club_name, 'Club A');
  assert.strictEqual(r14.a_xi_value, 10 + 2);                                    // 10 titolari da 1M + il 112 da 2M
  assert.ok(Math.abs(r14.a_absent_share - 50 / 60) < 1e-9, r14.a_absent_share);  // manca il 83% del valore dei titolari abituali (50 su 60)
  assert.strictEqual(r14.h_absent_share, 0);                                     // Club B invariato
  assert.strictEqual(r14.h_starters, 11);
  // nessun uso del futuro: la valutazione a 60M del 2018 non compare mai
  assert.ok(rows.every(r => r.h_xi_value === '' || r.h_xi_value <= 61));
  assert.strictEqual(valueAt(new Map([['1', { d: [10, 20], v: [5, 7] }]]), '1', 15), 5);
  assert.strictEqual(valueAt(new Map([['1', { d: [10, 20], v: [5, 7] }]]), '1', 5), null);
  const csv = toCsv(rows); assert.strictEqual(csv.split('\n').length, 15);
  console.log('valore rose e assenze (mini-dataset): ok');

  // il lavoro in background segnala gli errori (file assente) senza bloccarsi
  const job = createJob({ open: async () => { const e = new Error('HTTP 404'); throw e; } });
  await job.run();
  assert.strictEqual(job.status().fase, 'errore'); assert.ok(job.status().errore.includes('404'));
  const ok = createJob({ open }); await ok.run();
  assert.strictEqual(ok.status().finished, true); assert.ok(ok.csv().startsWith('game_id,date'));
  console.log('lavoro in background (errore e successo): ok');
  console.log('TUTTI I TEST tmFeatures OK');
})().catch(e => { console.error(e); process.exit(1); });
