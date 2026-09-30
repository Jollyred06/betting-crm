/**
 * Dati per la pagina /tracker.html: riepilogo, verdetto in parole semplici, segnali, prossime partite, ultimo giro.
 * La logica sta qui (testabile) e la pagina si limita a mostrare.
 */
const { LEAGUES, DEFAULT_COMPETITIONS } = require('./leagues');
const { buildStats } = require('./weeklyReport');

const TARGET_SETTLED = 300;      // segnali chiusi per una lettura solida (vedi il test: +2% rispetto alla chiusura ~150, +1% ~600)

/** Verdetto onesto in una frase. Mai "funziona" senza intervallo sopra lo zero e campione sufficiente. */
function verdict(total) {
  const n = total.settled || 0, clv = total.avgClvPct, ci = total.clvCi95;
  if (!total.signals) return { level: 'wait', title: 'Ancora nessun segnale', text: 'Il tracker e\' attivo. I segnali compaiono quando ci sono partite e quote che superano la soglia.' };
  if (n < 30) return { level: 'wait', title: 'Troppo presto per dire qualcosa', text: `Hai ${total.signals} segnali, ${n} chiusi. Con cosi' pochi dati il risultato dipende dal caso: servono almeno ${TARGET_SETTLED} segnali chiusi per una lettura solida.` };
  if (!ci) return { level: 'wait', title: 'Dati ancora pochi', text: `${n} segnali chiusi: il valore rispetto alla chiusura non ha ancora un intervallo affidabile.` };
  if (ci[0] > 0 && n < 100) return { level: 'wait', title: 'Promettente, ma ancora pochi dati', text: `Valore medio ${clv.toFixed(2)}% con ${n} segnali chiusi: l'intervallo e' sopra lo zero, ma con meno di 100 segnali puo' essere fortuna. Aspetta di averne di piu'.` };
  if (ci[0] > 0 && n >= 100) return { level: 'good', title: 'Segnale positivo, da confermare', text: `Il valore medio rispetto alla chiusura e' ${clv.toFixed(2)}% e l'intervallo e' sopra lo zero. Non e' ancora una prova di guadagno: controlla che regga anche con piu' dati e nel ROI.` };
  if (ci[1] < 0) return { level: 'bad', title: 'Nessun vantaggio: va peggio della chiusura', text: `Il valore medio rispetto alla chiusura e' ${clv.toFixed(2)}% con intervallo sotto lo zero: in media il mercato chiude meglio delle quote che abbiamo preso.` };
  return { level: 'neutral', title: 'Nessuna differenza dimostrata', text: `Valore medio ${clv.toFixed(2)}%, ma l'intervallo include lo zero: per ora non si distingue dal caso.` };
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
            vb.clv_pct, vb.league_code, vb.sharp_source, vb.created_at, f.date AS kickoff, th.name AS home, ta.name AS away
     FROM value_bets vb JOIN fixtures f ON f.id = vb.fixture_id
     LEFT JOIN teams th ON th.id = f.home_team_id LEFT JOIN teams ta ON ta.id = f.away_team_id
     WHERE ${where.join(' AND ')} ORDER BY f.date DESC, vb.id DESC LIMIT $1`, params);
  return rows.map(r => ({
    id: r.id, league: r.league_code, leagueName: (LEAGUES[r.league_code] || {}).name || r.league_code,
    home: r.home, away: r.away, pick: pick(r), selection: r.selection, odd: Number(r.bookmaker_odd), bookmaker: r.bookmaker_name,
    edgePct: Number(r.edge_pct), status: r.status, score: r.result_score, clvPct: r.clv_pct === null || r.clv_pct === undefined ? null : Number(r.clv_pct),
    kickoff: r.kickoff, source: r.sharp_source
  }));
}

function parseRun(row) {
  if (!row) return null;
  const text = row.log_text || '';
  const m = /crediti usati nel mese: (\d+), rimasti: (\d+)/.exec(text);
  const lines = text.split('\n').filter(Boolean).map(l => ({
    text: l,
    kind: /^SEGNALE/.test(l) ? 'signal' : /NOMI SQUADRA NON RICONOSCIUTI/.test(l) ? 'warn' : /nessun credito speso/.test(l) ? 'saving' : /non disponibili|non riuscit|errore/i.test(l) ? 'warn' : 'info'
  }));
  return { at: row.run_at, success: row.success, error: row.error_message, signals: row.value_bets_found, oddsRequests: row.odds_api_requests,
    credits: m ? { used: Number(m[1]), remaining: Number(m[2]) } : null, lines };
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


const hoursLabel = h => (h < 1 ? "meno di un'ora" : h < 48 ? `${Math.round(h)} ore` : `${Math.round(h / 24)} giorni`);

/**
 * Controlli di salute in italiano semplice + "cosa fare adesso": se tutto e' a posto dice di non fare niente.
 * Ogni controllo: level ok | warn | bad.
 */
async function getHealth(pool, now = new Date()) {
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
    if (!run.success) push('bad', 'Ultimo giro fallito', run.error || 'errore sconosciuto');
    else if (hours > 26) push('bad', 'Il giro automatico non parte', `L'ultimo giro e' di ${hoursLabel(hours)} fa: il job delle 11:00 su cron-job.org potrebbe essere fermo. Controllalo.`);
    else push('ok', 'Giro automatico', `Ultimo giro ${hoursLabel(hours)} fa.`);
    if (run.credits) {
      const r = run.credits.remaining;
      push(r < 50 ? 'bad' : r < 120 ? 'warn' : 'ok', 'Crediti delle quote', `Ne restano ${r} su 500 questo mese.` + (r < 120 ? ' Stanno finendo: togli qualche campionato dalla variabile COMPETITIONS su Render.' : ''));
    }
    const names = run.lines.find(l => /NOMI SQUADRA NON RICONOSCIUTI/.test(l.text));
    if (names) push('warn', 'Nomi di squadra non riconosciuti', `${names.text.replace(/^NOMI SQUADRA NON RICONOSCIUTI \([^)]*\):\s*/, '')} — mandameli in chat e li aggiungo: finche' non si riconoscono, quelle partite non producono segnali.`);
  }
  try {
    const old = (await pool.query(`SELECT COUNT(*)::int AS n FROM value_bets vb JOIN fixtures f ON f.id = vb.fixture_id
      WHERE vb.strategy = 'A_sharp' AND vb.status = 'pending' AND f.date < NOW() - INTERVAL '4 days'`)).rows[0];
    if (old && old.n > 0) push('warn', 'Segnali senza risultato', `${old.n} segnali aspettano il risultato da piu' di 4 giorni: di solito e' un nome di squadra che non si abbina allo storico. Premi "Chiudi i risultati ora" in Azioni; se resta cosi', scrivimelo in chat.`);
  } catch (e) { /* tabella non ancora pronta */ }
  try { await pool.query(`SELECT 1 FROM league_schedule LIMIT 1`); }
  catch (e) { push('warn', 'Risparmio crediti non attivo', 'Manca la tabella league_schedule: riesegui tutto db/schema.sql su Supabase (SQL Editor).'); }
  if (!items.some(i => i.level !== 'ok')) push('ok', 'Tutto il resto', 'Nessun problema rilevato.');

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

module.exports = { getOverview, getSignals, getHealth, getRuns, getConfig, verdict, pick, parseRun, TARGET_SETTLED };
