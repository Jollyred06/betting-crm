require('dotenv').config();

const KELLY_FRACTION = parseFloat(process.env.KELLY_FRACTION || '0.25');
const MAX_STAKE_PCT = parseFloat(process.env.MAX_STAKE_PCT || '0.05');
const WEEKLY_STOP_LOSS_PCT = parseFloat(process.env.WEEKLY_STOP_LOSS_PCT || '0.15');
// Molti bookmaker non accettano importi con decimali arbitrari (es. €3.47).
// Arrotondiamo al mezzo euro più vicino, così lo stake è già "spendibile"
// così com'è. La soglia minima varia da bookmaker a bookmaker: usiamo un
// valore prudente e comunque modificabile qui in un solo punto.
const STAKE_ROUNDING = 0.5;
const MIN_STAKE = 2;

/**
 * Arrotonda uno stake al multiplo di STAKE_ROUNDING più vicino (default 0.50€),
 * con un minimo di MIN_STAKE (default 2€) per restare compatibile con la
 * maggior parte dei bookmaker. Se lo stake calcolato è 0 (nessun vantaggio),
 * resta 0: non forziamo mai una puntata dove il modello non ne consiglia una.
 */
function roundStakeForBookmaker(rawStake) {
  if (rawStake <= 0) return 0;
  const rounded = Math.round(rawStake / STAKE_ROUNDING) * STAKE_ROUNDING;
  return Number(Math.max(rounded, MIN_STAKE).toFixed(2));
}

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
  const rawStake = cappedFraction * bankroll;

  return roundStakeForBookmaker(rawStake);
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
  roundStakeForBookmaker,
  KELLY_FRACTION,
  MAX_STAKE_PCT,
  WEEKLY_STOP_LOSS_PCT,
  STAKE_ROUNDING,
  MIN_STAKE
};
