require('dotenv').config();

const KELLY_FRACTION = parseFloat(process.env.KELLY_FRACTION || '0.25');
const MAX_STAKE_PCT = parseFloat(process.env.MAX_STAKE_PCT || '0.05');
const WEEKLY_STOP_LOSS_PCT = parseFloat(process.env.WEEKLY_STOP_LOSS_PCT || '0.15');

/**
 * Kelly Criterion: f* = (bp - q) / b
 * b = quota - 1 (guadagno netto per unità puntata)
 * p = probabilità stimata di vincita
 * q = 1 - p
 * Usiamo una frazione (default 1/4) per ridurre varianza/rischio di rovina.
 */
function kellyStake(odd, estimatedProbability, bankroll) {
  const b = odd - 1;
  const p = estimatedProbability;
  const q = 1 - p;
  const fullKelly = (b * p - q) / b;

  if (fullKelly <= 0) return 0; // nessun vantaggio, non puntare

  const fractionalKelly = fullKelly * KELLY_FRACTION;
  const cappedFraction = Math.min(fractionalKelly, MAX_STAKE_PCT);

  return Number((cappedFraction * bankroll).toFixed(2));
}

/**
 * Controlla se lo stop-loss settimanale è stato raggiunto.
 * weeklyLosses: somma delle perdite nette (positivo = quanto perso) negli ultimi 7 giorni
 */
function isStopLossTriggered(currentBankroll, initialWeekBankroll, weeklyLosses) {
  const lossThreshold = initialWeekBankroll * WEEKLY_STOP_LOSS_PCT;
  return weeklyLosses >= lossThreshold;
}

module.exports = {
  kellyStake,
  isStopLossTriggered,
  KELLY_FRACTION,
  MAX_STAKE_PCT,
  WEEKLY_STOP_LOSS_PCT
};
