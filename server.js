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
app.use('/api', (req, res, next) => { if (req.method !== 'GET') cache.clear(); next(); });
app.use('/api/tracker', cache.middleware(60000));
app.use('/api', betsRouter);
app.use('/api', runRouter);
app.use('/api/admin', adminRouter);
app.use('/api/tracker', trackerRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
  // sicurezza Supabase: chiude l'accesso dall'API pubblica a tutte le tabelle (anche a quelle create dopo, a ogni avvio e ogni 6 ore)
  const { enableRls } = require('./db/secure'), pool = require('./db/pool');
  const run = () => enableRls(pool).then(r => { if (r.attivata && r.attivata.length) console.log('RLS attivata su:', r.attivata.join(', ')); if (r.errore) console.log('RLS non attivata:', r.errore); });
  if (process.env.DATABASE_URL) { run(); setInterval(run, 6 * 3600000).unref(); }
});
