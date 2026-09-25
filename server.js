const express = require('express');
require('dotenv').config();

const betsRouter = require('./routes/bets');
const { getRequestCount } = require('./services/apiFootball');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Betting CRM API attivo',
    apiRequestsUsedOggi: getRequestCount()
  });
});

app.use('/api', betsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
});
