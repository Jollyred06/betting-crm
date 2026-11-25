const express = require('express');
const path = require('path');
require('dotenv').config();

const betsRouter = require('./routes/bets');
const runRouter = require('./routes/run');
const adminRouter = require('./routes/admin');
const trackerRouter = require('./routes/tracker');
const footballData = require('./services/footballData');
const oddsApi = require('./services/oddsApi');

const app = express();
const hardening = require('./services/hardening');
app.disable('x-powered-by'); app.set('trust proxy', 1);
hardening.installProcessGuards();
app.use(hardening.securityHeaders);
app.use('/api', hardening.writeLimiter());
const cache = require('./services/cache');
app.use(express.json());
// l'app compressa (prima della cartella public, che resta per tutto il resto)
app.get('/app.html', cache.staticGzip(path.join(__dirname, 'public', 'app.html')));
app.use(express.static(path.join(__dirname, 'public')));

// Rotta leggera per svegliare il server su Render (usata da cron-job.org alle 10:55)
app.get('/health', (req, res) => res.status(200).send('ok'));

// Le vecchie pagine non esistono piu': tutto e' nell'app. I vecchi preferiti portano li'.
app.get(['/dashboard.html', '/tracker.html'], (req, res) => res.redirect('/app.html'));

// L'unico indirizzo da ricordare: la home porta al centro di controllo.
app.get('/', (req, res) => res.redirect('/app.html'));

app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Betting CRM API attivo',
    footballDataRequestsUsed: footballData.getRequestCount(),
    oddsApiRequestsUsed: oddsApi.getRequestCount()
  });
});

// ogni salvataggio butta la copia pronta dei numeri, cosi' l'app mostra subito il dato nuovo
// un salvataggio cambia i numeri: via la copia pronta subito, e a risposta inviata le pagine principali si ripreparano da sole
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || /auth-check/.test(req.path)) return next();
  // 1° novembre 2026: una giocata, una non giocata o un risultato cambiano solo segnali e giocate. Si butta solo quello e si
  // riprepara solo quello, piu' tardi: prima si ricalcolava TUTTO subito e il server restava occupato per secondi (tocchi lenti).
  if (/^\/tracker\/(played|skipped|italia\/\d+\/(result|keep))/.test(req.path)) {
    // 24/11: anche il saldo per sito, la cassa Kelly e la scalata dipendono dalle giocate (prima restavano vecchi fino a 5 minuti)
    const re = /^\/api\/tracker\/(italia|played|archive|books|casse-siti|kelly|scalata)/;
    cache.clearMatching(re);
    res.on('finish', () => { cache.clearMatching(re); cache.warm({ port: PORT, delayMs: 2500, paths: ['/api/tracker/italia', '/api/tracker/played'] }); });
    return next();
  }
  // 11 novembre 2026: i giri automatici (controllo ogni 30 minuti, giro giornaliero, controllo di sistema) NON buttano piu' la copia pronta:
  // ogni volta si ricalcolavano 16 pagine (8,6 MB letti da Supabase) anche quando non era cambiato niente (48 volte al giorno: sforato il limite di banda).
  // Se i giri trovano davvero qualcosa di nuovo, lo dicono loro (routes/run.js) e la copia si butta solo allora.
  if (/^\/(capture-closing|run-daily|run-daily-if-missing|system-check)/.test(req.path)) return next();
  cache.clear(); res.on('finish', () => cache.clearAndWarm({ port: PORT }));   // (anche /team: cambia la lista delle ⭐)
  next();
});
app.use('/api/tracker', cache.middleware(5 * 60000));
app.use('/api', betsRouter);
app.use('/api', runRouter);
app.use('/api/admin', adminRouter);
app.use('/api/tracker', trackerRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
  // 11 novembre 2026: NIENTE ripreparazione all'avvio. Render gratuito si addormenta e si risveglia a ogni controllo (ogni 30 minuti):
  // ogni risveglio rileggeva 8,6 MB da Supabase per niente (limite di banda sforato). Le pagine si preparano quando qualcuno le apre.
  // (dopo un salvataggio dall'app la ripreparazione resta, perche' c'e' qualcuno davanti)
  // sicurezza Supabase: chiude l'accesso dall'API pubblica a tutte le tabelle (anche a quelle create dopo, a ogni avvio e ogni 6 ore)
  const { enableRls } = require('./db/secure'), pool = require('./db/pool');
  const run = () => enableRls(pool).then(r => { if (r.attivata && r.attivata.length) console.log('RLS attivata su:', r.attivata.join(', ')); if (r.errore) console.log('RLS non attivata:', r.errore); });
  if (process.env.DATABASE_URL) { run(); setInterval(run, 6 * 3600000).unref(); }
  // 19/11/2026: il cron di GitHub "ogni 10 minuti" in pratica parte ogni 6-8 ore, quindi Render dormiva quasi sempre e l'app
  // si apriva in 40-50 s. Ora il server bussa da solo al proprio indirizzo pubblico ogni 10 minuti (/health non tocca Supabase).
  // Un solo servizio gratuito acceso tutto il mese: 720-744 ore, dentro le 750 di Render. Si spegne con KEEP_AWAKE=false.
  // 24/11: il server ora resta sveglio (sotto), quindi si riavvia solo dopo una pubblicazione: prepara subito le pagine principali,
  // cosi' la prima apertura dopo un aggiornamento non aspetta 10 secondi. Una volta per avvio, non a ogni risveglio.
  if (process.env.DATABASE_URL && process.env.WARM_ON_BOOT !== 'false') require('./services/cache').warm({ port: PORT, delayMs: 4000, paths: ['/api/tracker/italia', '/api/tracker/scalata', '/api/tracker/played', '/api/tracker/learning', '/api/tracker/books', '/api/tracker/team', '/api/tracker/brain', '/api/tracker/guess', '/api/tracker/strategies', '/api/tracker/training'] });   // 25/11: anche Analisi
  const self = process.env.RENDER_EXTERNAL_URL;
  if (self && process.env.KEEP_AWAKE !== 'false') setInterval(() => { try { require(self.startsWith('https') ? 'https' : 'http').get(`${self}/health`, r => r.resume()).on('error', () => {}); } catch (e) { /* mai fermare il server per un ping */ } }, 10 * 60000);
});
