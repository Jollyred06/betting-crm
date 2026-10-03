// Protezione crediti di The Odds API: soglia di sicurezza, conteggio per giro, crediti spesi nel giro.
process.env.MIN_CREDITS = '60';
const assert = require('assert');
const path = require.resolve('../services/oddsApi');

function load(responses) {
  delete require.cache[path];
  const api = require('../services/oddsApi');
  const calls = [];
  api.__setClient({ get: async (url) => { calls.push(url); const r = responses.shift(); return { data: r.data || [], headers: r.headers || {} }; } });
  return { api, calls };
}
const h = (used, remaining) => ({ 'x-requests-used': String(used), 'x-requests-remaining': String(remaining) });

(async () => {
  // 1) conteggio e crediti spesi nel solo giro (il contatore globale resta cumulativo)
  let { api, calls } = load([{ headers: h(400, 100) }, { headers: h(401, 99) }, { headers: h(402, 98) }]);
  api.resetRun();
  await api.getOddsForCompetition('SA'); await api.getOddsForCompetition('PL');
  assert.strictEqual(api.getRunRequestCount(), 2);
  assert.strictEqual(api.getRunSpent(), 2);
  assert.strictEqual(api.getRequestCount(), 2);
  api.resetRun(); assert.strictEqual(api.getRunRequestCount(), 0); assert.strictEqual(api.getRunSpent(), 0);
  console.log('conteggio per giro: ok');

  // 2) sotto la soglia la chiamata NON parte
  ({ api, calls } = load([{ headers: h(440, 60) }, { headers: h(441, 59) }]));
  await api.getOddsForCompetition('SA');                 // dopo questa restano 60: soglia raggiunta
  const before = calls.length;
  await assert.rejects(() => api.getOddsForCompetition('PL'), /soglia di sicurezza/);
  assert.strictEqual(calls.length, before, 'nessuna richiesta deve partire sotto la soglia');
  console.log('blocco sotto soglia: ok');

  // 3) l'elenco gratuito dei campionati (/sports) fa partire la protezione gia' dalla prima lega
  ({ api, calls } = load([{ data: [{ key: 'soccer_epl', active: true }], headers: h(445, 55) }]));
  const keys = await api.getActiveSportKeys();
  assert.ok(keys.has('soccer_epl'));
  await assert.rejects(() => api.getOddsForCompetition('PL'), /soglia di sicurezza/);
  assert.strictEqual(calls.length, 1);
  console.log('soglia letta da /sports: ok');

  // 4) crediti ancora sconosciuti (primo avvio): la chiamata passa
  ({ api, calls } = load([{ headers: h(10, 490) }]));
  await api.getOddsForCompetition('SA'); assert.strictEqual(calls.length, 1);
  console.log('primo avvio senza dati sui crediti: ok');

  console.log('TUTTI I TEST creditGuard OK');
})().catch(e => { console.error(e); process.exit(1); });
