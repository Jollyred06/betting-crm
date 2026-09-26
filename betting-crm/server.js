const express = require('express');
require('dotenv').config();

const betsRouter = require('./routes/bets');
const runRouter = require('./routes/run');
const footballData = require('./services/footballData');
const oddsApi = require('./services/oddsApi');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Betting CRM API attivo',
    footballDataRequestsUsed: footballData.getRequestCount(),
    oddsApiRequestsUsed: oddsApi.getRequestCount()
  });
});

app.use('/api', betsRouter);
app.use('/api', runRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
});
