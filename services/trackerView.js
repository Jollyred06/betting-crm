/**
 * Dati per l'app (/app.html): riepilogo, verdetto in parole semplici, segnali, prossime partite, ultimo giro.
 * La logica sta qui (testabile) e la pagina si limita a mostrare.
 */
const { LEAGUES, DEFAULT_COMPETITIONS } = require('./leagues');
const { buildStats, summarize } = require('./weeklyReport');

const TARGET_SETTLED = 300;      // segnali chiusi per una lettura solida (vedi il test: +2% rispetto alla chiusura ~150, +1% ~600)

/** Verdetto onesto in una frase. Mai "funziona" senza intervallo sopra lo zero e campione sufficiente. */
const it2 = x => Number(x).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });   // decimali con la virgola, come nel resto dell'app

function verdict(total) {
  const n = total.settled || 0, clv = total.avgClvPct, ci = total.clvCi95;
  if (!total.signals) return { level: 'wait', title: 'Ancora nessun segnale', text: 'Il tracker è attivo. I segnali compaiono quando ci sono partite e quote che superano la soglia.' };
  if (n < 30) return { level: 'wait', title: 'Troppo presto per dire qualcosa', text: `Hai ${total.signals} segnali, ${n} chiusi. Con così pochi dati il risultato dipende dal caso: servono almeno ${TARGET_SETTLED} segnali chiusi per una lettura solida.` };
  if (!ci) return { level: 'wait', title: 'Dati ancora pochi', text: `${n} segnali chiusi: il valore rispetto alla chiusura non ha ancora un intervallo affidabile.` };
  if (ci[0] > 0 && n < 100) return { level: 'wait', title: 'Promettente, ma ancora pochi dati', text: `Valore medio ${it2(clv)}% con ${n} segnali chiusi: l'intervallo è sopra lo zero, ma con meno di 100 segnali può essere fortuna. Aspetta di averne di più.` };
  if (ci[0] > 0 && n >= 100) return { level: 'good', title: 'Segnale positivo, da confermare', text: `Il valore medio rispetto alla chiusura è ${it2(clv)}% e l'intervallo è sopra lo zero. Non è ancora una prova di guadagno: controlla che regga anche con più dati e nel ROI.` };
  if (ci[1] < 0) return { level: 'bad', title: 'Nessun vantaggio: va peggio della chiusura', text: `Il valore medio rispetto alla chiusura è ${it2(clv)}% con intervallo sotto lo zero: in media il mercato chiude meglio delle quote che abbiamo preso.` };
  return { level: 'neutral', title: 'Nessuna differenza dimostrata', text: `Valore medio ${it2(clv)}%, ma l'intervallo include lo zero: per ora non si distingue dal caso.` };
}

function pick(row) {
  return row.selection === 'home' ? (row.home || 'Casa') : row.selection === 'away' ? (row.away || 'Trasferta') : 'Pareggio';
}

async function getSignals(pool, { status, limit = 60 } = {}) {
  const params = [], where = [`vb.strategy = 'A_sharp'`];
  if (status === 'pending') where.push(`vb.status = 'pending'`);
  else if (status === 'settled') where.push(`vb.status IN ('won','lost')`);
  params.push(Math.min(Number(limit) || 60, 200));
  const { rows } = await pool.query(
    `SELECT vb.id, vb.selection, vb.bookmaker_odd, vb.bookmaker_name, vb.edge_pct, vb.recommended_stake, vb.status, vb.result_score,
            vb.clv_pct, vb.league_code, vb.sharp_source, vb.created_at, vb.n_books, vb.n_near_best, vb.sharp_odd, f.date AS kickoff, th.name AS home, ta.name AS away
     FROM value_bets vb JOIN fixtures f ON f.id = vb.fixture_id
     LEFT JOIN teams th ON th.id = f.home_team_id LEFT JOIN teams ta ON ta.id = f.away_team_id
     WHERE ${where.join(' AND ')} ORDER BY f.date DESC, vb.id DESC LIMIT $1`, params);
  return rows.map(r => ({
    id: r.id, league: r.league_code, leagueName: (LEAGUES[r.league_code] || {}).name || r.league_code,
    home: r.home, away: r.away, pick: pick(r), selection: r.selection, odd: Number(r.bookmaker_odd), bookmaker: r.bookmaker_name,
    edgePct: Number(r.edge_pct), status: r.status, score: r.result_score, clvPct: r.clv_pct === null || r.clv_pct === undefined ? null : Number(r.clv_pct),
    kickoff: r.kickoff, source: r.sharp_source,
    books: r.n_books === null || r.n_books === undefined ? null : Number(r.n_books), near: r.n_near_best === null || r.n_near_best === undefined ? null : Number(r.n_near_best)
  }));
}

function parseRun(row) {
  if (!row) return null;
  const text = row.log_text || '';
  const m = /crediti usati nel mese: (\d+), rimasti: (\d+)/.exec(text);
  const lines = text.split('\n').filter(Boolean).map(l => ({
    text: l,
    kind: /^SEGNALE/.test(l) ? 'signal' : /^CONTROLLO/.test(l) ? 'info' : /NOMI SQUADRA NON RICONOSCIUTI/.test(l) ? 'warn' : /nessun credito speso/.test(l) ? 'saving' : /non disponibili|non riuscit|errore/i.test(l) ? 'warn' : 'info'
  }));
  return { at: row.run_at, success: row.success, error: row.error_message, signals: row.value_bets_found, oddsRequests: row.odds_api_requests,
    credits: m ? { used: Number(m[1]), remaining: Number(m[2]) } : null, lines };
}

function medianOf(quotes) {
  const q = typeof quotes === 'string' ? (() => { try { return JSON.parse(quotes); } catch (e) { return null; } })() : quotes;
  if (!Array.isArray(q) || !q.length) return '';
  const o = q.map(x => Number(x.odd)).sort((a, b) => a - b), m = Math.floor(o.length / 2);
  return Math.round((o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2) * 1000) / 1000;
}

/** Tutti i segnali in CSV (per mandarli in chat all'analisi di ogni tappa). */
async function signalsCsv(pool) {
  const { rows } = await pool.query(
    `SELECT vb.id, vb.created_at, f.date AS kickoff, vb.league_code, vb.selection, vb.bookmaker_odd, vb.bookmaker_name, vb.edge_pct,
            vb.estimated_probability, vb.sharp_source, vb.status, vb.result_score, vb.closing_fair_prob, vb.clv_pct, vb.settled_at, vb.model_version, vb.quotes, vb.sharp_odd, vb.n_books, vb.n_near_best,
            th.name AS home, ta.name AS away
     FROM value_bets vb JOIN fixtures f ON f.id = vb.fixture_id
     LEFT JOIN teams th ON th.id = f.home_team_id LEFT JOIN teams ta ON ta.id = f.away_team_id
     WHERE vb.strategy = 'A_sharp' ORDER BY vb.id`);
  const cols = ['id', 'creato', 'partita_inizio', 'campionato', 'campionato_nome', 'casa', 'trasferta', 'scelta', 'puntato_su', 'quota', 'bookmaker', 'vantaggio_pct',
    'prob_pinnacle', 'riferimento', 'stato', 'risultato', 'prob_chiusura', 'valore_vs_chiusura_pct', 'chiuso_il', 'modello', 'n_bookmaker', 'n_vicini_alla_migliore', 'quota_pinnacle', 'quota_mediana', 'quote_json'];
  const esc = x => { const s = x === null || x === undefined ? '' : x instanceof Date ? x.toISOString() : String(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const line = r => [r.id, r.created_at, r.kickoff, r.league_code, (LEAGUES[r.league_code] || {}).name || r.league_code, r.home, r.away, r.selection, pick(r), r.bookmaker_odd, r.bookmaker_name,
    r.edge_pct, r.estimated_probability, r.sharp_source, r.status, r.result_score, r.closing_fair_prob, r.clv_pct, r.settled_at, r.model_version,
    r.n_books, r.n_near_best, r.sharp_odd, medianOf(r.quotes), r.quotes ? JSON.stringify(r.quotes) : ''].map(esc).join(',');
  return [cols.join(','), ...rows.map(line)].join('\n');
}

async function getOverview(pool) {
  const stats = await buildStats(pool);
  const [run, sched] = await Promise.all([
    pool.query(`SELECT run_at, success, value_bets_found, odds_api_requests, log_text, error_message FROM run_logs ORDER BY run_at DESC LIMIT 1`),
    pool.query(`SELECT league_code, next_start, checked_at FROM league_schedule ORDER BY next_start NULLS LAST`).catch(() => ({ rows: [] }))
  ]);
  return {
    total: stats.total, week: stats.week, strong: stats.strong, verdict: verdict(stats.total),
    progress: { settled: stats.total.settled, target: TARGET_SETTLED, pct: Math.min(100, Math.round((stats.total.settled / TARGET_SETTLED) * 100)) },
    lastRun: parseRun(run.rows[0]),
    schedule: sched.rows.map(r => ({ league: r.league_code, name: (LEAGUES[r.league_code] || {}).name || r.league_code, nextStart: r.next_start, checkedAt: r.checked_at })),
    tracked: Object.keys(LEAGUES).length
  };
}


const { romeParts } = require('./runState');
const hoursLabel = h => (h < 1 ? "meno di un'ora" : h < 1.5 ? "circa un'ora" : h < 48 ? `${Math.round(h)} ore` : `${Math.round(h / 24)} giorni`);

/**
 * Controlli di salute in italiano semplice + "cosa fare adesso": se tutto è a posto dice di non fare niente.
 * Ogni controllo: level ok | warn | bad.
 */
async function getHealth(pool, now = new Date(), env = process.env) {
  const items = [];
  const push = (level, title, text) => items.push({ level, title, text });
  let runRow = null;
  try {
    runRow = (await pool.query(`SELECT run_at, success, value_bets_found, odds_api_requests, log_text, error_message FROM run_logs ORDER BY run_at DESC LIMIT 1`)).rows[0];
  } catch (e) { push('bad', 'Database', `Non riesco a leggere il database: ${e.message}`); }
  const run = parseRun(runRow);
  if (!run) {
    push('warn', 'Nessun giro registrato', 'Il tracker non ha ancora girato. Vai su Azioni e premi "Esegui analisi ora", oppure controlla il job delle 11:00 su cron-job.org.');
  } else {
    const hours = (now - new Date(run.at)) / 3600000;
    const n = romeParts(now), l = romeParts(run.at);
    const missedToday = n.mins >= 11 * 60 + 20 && !(l.ymd === n.ymd && l.mins >= 10 * 60 + 50);     // dopo le 11:20 deve esserci un giro di oggi, partito verso le 11:00
    if (!run.success) push('bad', 'Ultimo giro fallito', run.error || 'errore sconosciuto');
    else if (missedToday && hours <= 26) push('bad', 'Il giro di oggi non è partito', 'Alle 11:00 non risulta nessun giro. Apri la cronologia del job su cron-job.org: di solito è il server gratuito di Render ancora addormentato. Rimedio: aggiungi un job "sveglia" alle 10:55.');
    else if (hours > 26) push('bad', 'Il giro automatico non parte', `L'ultimo giro è di ${hoursLabel(hours)} fa: il job delle 11:00 su cron-job.org potrebbe essere fermo. Controllalo.`);
    else push('ok', 'Giro automatico', `Ultimo giro ${hoursLabel(hours)} fa.`);
    if (run.credits) {
      const r = run.credits.remaining;
      push(r < 50 ? 'bad' : r < 120 ? 'warn' : 'ok', 'Crediti delle quote', `Ne restano ${r} su 500 questo mese.` + (r < 120 ? ' Stanno finendo: togli qualche campionato dalla variabile COMPETITIONS su Render.' : ''));
    }
    const names = run.lines.find(l => /NOMI SQUADRA NON RICONOSCIUTI/.test(l.text));
    if (names) push('warn', 'Nomi di squadra non riconosciuti', `${names.text.replace(/^NOMI SQUADRA NON RICONOSCIUTI \([^)]*\):\s*/, '')} — mandameli in chat e li aggiungo: finché non si riconoscono, quelle partite non producono segnali.`);
  }
  try {
    const old = (await pool.query(`SELECT COUNT(*)::int AS n FROM value_bets vb JOIN fixtures f ON f.id = vb.fixture_id
      WHERE vb.strategy = 'A_sharp' AND vb.status = 'pending' AND f.date < NOW() - INTERVAL '4 days'`)).rows[0];
    if (old && old.n > 0) push('warn', 'Segnali senza risultato', `${old.n} segnali aspettano il risultato da più di 4 giorni: di solito è un nome di squadra che non si abbina allo storico. Premi "Chiudi i risultati ora" in Azioni; se resta così, scrivimelo in chat.`);
  } catch (e) { /* tabella non ancora pronta */ }
  try { await pool.query(`SELECT 1 FROM league_schedule LIMIT 1`); }
  catch (e) { push('warn', 'Risparmio crediti non attivo', 'Manca la tabella league_schedule: riesegui tutto db/schema.sql su Supabase (SQL Editor).'); }
  const tg = !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
  push('info', 'Avvisi sul telefono', tg ? 'Telegram collegato: ricevi un messaggio quando compare un nuovo segnale.' : 'Telegram non collegato: i segnali si vedono solo aprendo l\'app. Come collegarlo: scheda Info.');
  if (!items.some(i => i.level === 'bad' || i.level === 'warn')) push('ok', 'Tutto il resto', 'Nessun problema rilevato.');

  const bad = items.find(i => i.level === 'bad'), warn = items.find(i => i.level === 'warn');
  const todo = bad ? { level: 'bad', title: bad.title, text: bad.text }
    : warn ? { level: 'warn', title: warn.title, text: warn.text }
    : { level: 'ok', title: 'Tutto in ordine', text: 'Non devi fare niente: il tracker gira da solo ogni giorno e il riepilogo arriva il lunedi.' };
  return { items, todo };
}

async function getRuns(pool, limit = 14) {
  const { rows } = await pool.query(`SELECT run_at, success, value_bets_found, odds_api_requests, log_text, error_message FROM run_logs ORDER BY run_at DESC LIMIT $1`, [Math.min(Number(limit) || 14, 60)]);
  return rows.map(parseRun);
}

function getConfig(env = process.env) {
  const active = (env.COMPETITIONS || DEFAULT_COMPETITIONS).split(',').map(s => s.trim()).filter(c => LEAGUES[c]);
  return {
    competitions: active.map(c => ({ code: c, name: LEAGUES[c].name, source: LEAGUES[c].fd ? 'football-data.org' : 'The Odds API' })),
    minEdgePct: parseFloat(env.MIN_EDGE || '0.03') * 100, maxEdgePct: 15, maxDailySignals: parseInt(env.MAX_DAILY_SIGNALS || '40', 10), stake: parseFloat(env.TRACK_STAKE || '2'),
    notify: { telegram: !!env.TELEGRAM_BOT_TOKEN, email: !!env.EMAIL_USER, whatsapp: !!(env.WHATSAPP_PHONE && env.WHATSAPP_APIKEY) }
  };
}


// ---------------------------------------------------------------------------------------------- bankroll di carta
/** Saldo, curva e movimenti del bankroll di carta (ogni segnale chiuso muove la puntata fissa; deposito e prelievo manuali). */
async function getBankroll(pool, env = process.env) {
  const start = parseFloat(env.INITIAL_BANKROLL || '100');
  const { rows } = await pool.query(`SELECT id, bet_id, amount, balance_after, note, created_at FROM bankroll_log ORDER BY created_at ASC, id ASC`);
  const num = x => Number(x);
  const balance = rows.length ? num(rows[rows.length - 1].balance_after) : start;
  const first = rows[0];
  let series = [{ t: first ? first.created_at : null, b: first ? num(first.balance_after) - num(first.amount) : start }, ...rows.map(r => ({ t: r.created_at, b: num(r.balance_after) }))];
  if (series.length > 150) { const step = Math.ceil(series.length / 150); series = series.filter((_, i) => i % step === 0 || i === series.length - 1); }
  let peak = series[0].b, drawdown = 0;
  for (const p of series) { peak = Math.max(peak, p.b); if (peak > 0) drawdown = Math.max(drawdown, (peak - p.b) / peak * 100); }
  const signals = rows.filter(r => r.bet_id !== null && r.bet_id !== undefined), manual = rows.filter(r => r.bet_id === null || r.bet_id === undefined);
  const sum = a => Math.round(a.reduce((t, r) => t + num(r.amount), 0) * 100) / 100;
  return {
    balance, start: series[0].b, signalsProfit: sum(signals), signalsCount: signals.length, netManual: sum(manual), peak: Math.round(peak * 100) / 100, drawdownPct: Math.round(drawdown * 10) / 10,
    series, movements: rows.slice(-15).reverse().map(r => ({ at: r.created_at, amount: num(r.amount), balance: num(r.balance_after), note: r.note, manual: r.bet_id === null || r.bet_id === undefined }))
  };
}

// ---------------------------------------------------------------------------------------------- strategie
const STRATEGY_INFO = {
  A_sharp: { letter: 'A', title: 'Migliore quota contro Pinnacle', text: 'Per ogni partita confronta la migliore quota tra i bookmaker con la probabilità "onesta" di Pinnacle e segnala dove la quota è più alta del dovuto.' }
};
// Provate sul passato e scartate (vedi i report dei test): nessuna ha battuto il mercato in modo dimostrabile.
const DISCARDED = [
  { name: 'Previsioni sui soli gol (Serie A)', result: 'Ben calibrate dopo la correzione, ma peggio del mercato.' },
  { name: 'Brasileirão', result: 'Risultato dentro il rumore: nessun vantaggio dimostrato.' },
  { name: 'Serie A con xG', result: 'L\'xG migliora le previsioni di pochissimo, ma il mercato resta più preciso.' },
  { name: 'Sempre la favorita (19 campionati)', result: '−4,1% su 27.000 partite.' },
  { name: 'Quota Bet365 contro Pinnacle, soglia 3% (19 campionati)', result: 'Sviluppo +3,8%, test −1,3%, con fasce enormi: non dimostrato. È la base della strategia A, ora misurata dal vivo.' },
  { name: 'Machine learning (19 campionati)', result: 'Non batte le quote di Pinnacle.' },
  { name: 'Valore delle rose e assenze (Transfermarkt)', result: 'Nessun guadagno nel test finale.' }
];
const MINOR = new Set(['E2', 'E3', 'I2', 'SP2', 'F2', 'D2']);

function sumRow(rows) {
  const s = summarize(rows.map(r => ({ odd: r.odd, status: r.status, edge_pct: r.edge_pct, clv_pct: r.clv_pct })));
  return { signals: s.signals, settled: s.settled, pending: s.pending, avgClvPct: s.avgClvPct, roiFlatPct: s.roiFlatPct, hitRatePct: s.hitRatePct };
}

async function getStrategies(pool) {
  const { rows } = await pool.query(`SELECT strategy, bookmaker_odd AS odd, status, edge_pct, clv_pct, league_code, selection, n_near_best FROM value_bets WHERE strategy IS NOT NULL`);
  const keys = [...new Set([...Object.keys(STRATEGY_INFO), ...rows.map(r => r.strategy)])];
  return {
    strategies: keys.map(k => {
      const mine = rows.filter(r => r.strategy === k), info = STRATEGY_INFO[k] || { letter: '?', title: k, text: '' }, p = f => mine.filter(f);
      return {
        key: k, letter: info.letter, title: info.title, text: info.text, status: 'In prova dal vivo, senza soldi veri',
        total: { ...sumRow(mine), clvCi95: summarize(mine.map(r => ({ odd: r.odd, status: r.status, edge_pct: r.edge_pct, clv_pct: r.clv_pct }))).clvCi95 },
        variants: [
          { group: 'Per vantaggio', rows: [{ name: 'Da 2% a 3%', ...sumRow(p(r => Number(r.edge_pct) < 3)) }, { name: '3% o più', ...sumRow(p(r => Number(r.edge_pct) >= 3)) }] },
          { group: 'Per campionato', rows: [{ name: 'Maggiori', ...sumRow(p(r => !MINOR.has(r.league_code))) }, { name: 'Serie minori', ...sumRow(p(r => MINOR.has(r.league_code))) }] },
          { group: 'Per esito', rows: [{ name: 'Casa', ...sumRow(p(r => r.selection === 'home')) }, { name: 'Pareggio', ...sumRow(p(r => r.selection === 'draw')) }, { name: 'Trasferta', ...sumRow(p(r => r.selection === 'away')) }] },
          { group: 'Per quota', rows: [{ name: 'Sotto 4', ...sumRow(p(r => Number(r.odd) < 4)) }, { name: '4 o più', ...sumRow(p(r => Number(r.odd) >= 4)) }] },
          { group: 'Quota offerta da', rows: [{ name: 'Più bookmaker', ...sumRow(p(r => Number(r.n_near_best) >= 2)) }, { name: 'Un solo bookmaker', ...sumRow(p(r => Number(r.n_near_best) === 1)) }] }
        ]
      };
    }),
    discarded: DISCARDED
  };
}

module.exports = { getBankroll, getStrategies, getOverview, getSignals, signalsCsv, getHealth, getRuns, getConfig, verdict, pick, parseRun, TARGET_SETTLED };
