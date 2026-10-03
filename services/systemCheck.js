/**
 * "Controllo di sistema": un solo pulsante che verifica database, tabelle, chiavi, servizi esterni, Telegram e giro giornaliero,
 * e dice in italiano cosa non va. Non mostra mai il valore di una chiave: solo se c'e'.
 * Le chiamate esterne usate sono gratuite (elenco campionati di The Odds API, getMe di Telegram) o una richiesta a football-data.org.
 */
const view = require('./trackerView');
const { getKeyUsage } = require('./auth');

const TABLES = ['value_bets', 'fixtures', 'teams', 'historical_matches', 'bankroll_log', 'run_logs', 'league_schedule', 'milestone_snapshots'];
const COLUMNS = ['strategy', 'league_code', 'clv_pct', 'settled_at', 'result_score', 'quotes', 'n_near_best', 'quota_presa', 'quota_max', 'odds_event_id', 'close_pin_h', 'clv_source'];
const RUN_TITLES = ['Giro automatico', 'Il giro di oggi non è partito', 'Il giro automatico non parte', 'Ultimo giro fallito', 'Nessun giro registrato'];

function defaultHttp() { const axios = require('axios'); return { get: (url, opts) => axios.get(url, { timeout: 15000, ...opts }) }; }
const why = e => (e && e.response && e.response.status ? `HTTP ${e.response.status}` : e && e.message) || 'errore';

async function runSystemCheck(pool, { env = process.env, http = defaultHttp(), now = new Date() } = {}) {
  const items = [], push = (level, title, text) => items.push({ level, title, text });

  // database e tabelle
  let dbOk = false;
  try { await pool.query('SELECT 1'); dbOk = true; push('ok', 'Database', 'Collegato.'); }
  catch (e) { push('bad', 'Database', `Non risponde (${why(e)}). Controlla DATABASE_URL su Render e lo stato di Supabase.`); }
  if (dbOk) {
    try {
      const missing = [];
      for (const t of TABLES) { const r = await pool.query(`SELECT to_regclass($1) AS t`, ['public.' + t]); if (!r.rows[0] || !r.rows[0].t) missing.push(t); }
      if (missing.length) push('bad', 'Tabelle mancanti', `Mancano: ${missing.join(', ')}. Su Supabase, SQL Editor, esegui tutto db/schema.sql.`);
      else {
        const c = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'value_bets'`);
        const have = new Set(c.rows.map(r => r.column_name)), lack = COLUMNS.filter(x => !have.has(x));
        if (lack.length) push('warn', 'Colonne mancanti', `Nella tabella dei segnali mancano: ${lack.join(', ')}. Esegui di nuovo tutto db/schema.sql: finché non lo fai, le quote complete e la quota di chiusura Pinnacle non vengono salvate.`);
        else push('ok', 'Tabelle e colonne', 'Tutte presenti.');
      }
    } catch (e) { push('warn', 'Tabelle', `Non riesco a controllarle (${why(e)}).`); }
  }

  // variabili su Render (solo se ci sono, mai il valore)
  const need = ['ODDS_API_KEY', 'FOOTBALL_DATA_KEY', 'RUN_SECRET_KEY'], absent = need.filter(k => !env[k]);
  if (absent.length) push('bad', 'Variabili su Render', `Mancano: ${absent.join(', ')}. Aggiungile in Environment.`);
  else push('ok', 'Variabili su Render', 'Le chiavi necessarie ci sono.');

  // servizi esterni
  if (env.ODDS_API_KEY) {
    try {
      const r = await http.get('https://api.the-odds-api.com/v4/sports', { params: { apiKey: env.ODDS_API_KEY } });
      const rem = r.headers && r.headers['x-requests-remaining'];
      push('ok', 'The Odds API (quote)', `Risponde, ${Array.isArray(r.data) ? r.data.length : '?'} campionati in stagione.` + (rem !== undefined ? ` Crediti rimasti: ${rem}.` : ''));
      if (rem !== undefined && Number(rem) < 60) push('warn', 'Crediti delle quote', `Ne restano ${rem}: stanno finendo.`);
    } catch (e) { push('bad', 'The Odds API (quote)', `Non risponde (${why(e)}). ${e && e.response && e.response.status === 401 ? 'La chiave non è valida.' : ''}`.trim()); }
  }
  if (env.FOOTBALL_DATA_KEY) {
    try { await http.get('https://api.football-data.org/v4/competitions/SA', { headers: { 'X-Auth-Token': env.FOOTBALL_DATA_KEY } }); push('ok', 'football-data.org (partite)', 'Risponde.'); }
    catch (e) { push('bad', 'football-data.org (partite)', `Non risponde (${why(e)}). ${e && e.response && [401, 403].includes(e.response.status) ? 'Controlla la chiave.' : ''}`.trim()); }
  }
  if (env.TELEGRAM_BOT_TOKEN) {
    try {
      await http.get(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`);
      push(env.TELEGRAM_CHAT_ID ? 'ok' : 'warn', 'Telegram', env.TELEGRAM_CHAT_ID ? 'Il bot risponde e il chat è impostato.' : 'Il bot risponde ma manca TELEGRAM_CHAT_ID: usa "Trova il mio chat Telegram" in Azioni.');
    } catch (e) { push('bad', 'Telegram', `Il bot non risponde (${why(e)}). Controlla TELEGRAM_BOT_TOKEN.`); }
  } else push('info', 'Telegram', 'Non collegato: gli avvisi sul telefono sono spenti (facoltativo).');

  // giro giornaliero e Pinnacle (dall'ultimo giro, senza spendere crediti)
  if (dbOk) {
    try {
      const h = await view.getHealth(pool, now, env);
      h.items.filter(i => RUN_TITLES.includes(i.title)).forEach(i => items.push(i));
      const run = (await view.getRuns(pool, 1))[0];
      if (run) {
        let pin = 0, ex = 0;
        for (const l of run.lines) { const m = /con riferimento: (\d+) Pinnacle, (\d+) solo exchange/.exec(l.text); if (m) { pin += Number(m[1]); ex += Number(m[2]); } }
        if (pin + ex) push(pin ? 'ok' : 'warn', 'Pinnacle', `Nell'ultimo giro: ${pin} partite con Pinnacle, ${ex} solo con l'exchange.`);
      }
    } catch (e) { /* le altre verifiche restano valide */ }
  }

  // chiave nell'indirizzo
  const u = getKeyUsage();
  if (u.lastQueryAt && u.queryAllowed) push('info', 'Chiave negli indirizzi', 'Qualche job la usa ancora nell\'indirizzo (resta nelle cronologie). Più sicuro: mettila nell\'intestazione x-run-key, vedi Info.');
  else if (!u.queryAllowed) push('ok', 'Chiave negli indirizzi', 'Disattivata: vale solo la chiave nell\'intestazione.');

  const count = l => items.filter(i => i.level === l).length;
  return { at: now.toISOString(), items, summary: { ok: count('ok'), warn: count('warn'), bad: count('bad') } };
}

module.exports = { runSystemCheck, TABLES };
