/**
 * Campionati seguiti dal tracker. Codice football-data.org (fixture di oggi) ->
 * chiave di The Odds API (quote) e codice del file su football-data.co.uk (risultati e quote di chiusura).
 * Sono i campionati coperti dal piano gratuito di football-data.org.
 */
const LEAGUES = {
  SA:  { name: 'Serie A',        oddsKey: 'soccer_italy_serie_a',        csv: 'I1' },
  PL:  { name: 'Premier League', oddsKey: 'soccer_epl',                  csv: 'E0' },
  BL1: { name: 'Bundesliga',     oddsKey: 'soccer_germany_bundesliga',   csv: 'D1' },
  PD:  { name: 'La Liga',        oddsKey: 'soccer_spain_la_liga',        csv: 'SP1' },
  FL1: { name: 'Ligue 1',        oddsKey: 'soccer_france_ligue_one',     csv: 'F1' },
  DED: { name: 'Eredivisie',     oddsKey: 'soccer_netherlands_eredivisie', csv: 'N1' },
  PPL: { name: 'Primeira Liga',  oddsKey: 'soccer_portugal_primeira_liga', csv: 'P1' },
  ELC: { name: 'Championship',   oddsKey: 'soccer_efl_champ',            csv: 'E1' }
};
module.exports = { LEAGUES };
