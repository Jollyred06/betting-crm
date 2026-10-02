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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

app.use('/api', betsRouter);
app.use('/api', runRouter);
app.use('/api/admin', adminRouter);
app.use('/api/tracker', trackerRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
});
