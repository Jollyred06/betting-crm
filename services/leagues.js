/**
 * Campionati seguiti dal tracker.
 *  - oddsKey: chiave di The Odds API (quote)
 *  - csv:     codice del file su football-data.co.uk (risultati e quote di chiusura, per chiudere i segnali)
 *  - fd:      true = le partite di oggi arrivano da football-data.org (piano gratuito);
 *             false = football-data.org non lo copre: le partite si prendono direttamente da The Odds API.
 * Per attivarne altri basta aggiungerli alla variabile COMPETITIONS su Render (senza toccare il codice).
 * Se una chiave di The Odds API non e' valida o il campionato e' fuori stagione, il log lo scrive e lo salta.
 */
const LEAGUES = {
  // coperti da football-data.org
  SA:  { name: 'Serie A',        oddsKey: 'soccer_italy_serie_a',          csv: 'I1',  fd: true },
  PL:  { name: 'Premier League', oddsKey: 'soccer_epl',                    csv: 'E0',  fd: true },
  BL1: { name: 'Bundesliga',     oddsKey: 'soccer_germany_bundesliga',     csv: 'D1',  fd: true },
  PD:  { name: 'La Liga',        oddsKey: 'soccer_spain_la_liga',          csv: 'SP1', fd: true },
  FL1: { name: 'Ligue 1',        oddsKey: 'soccer_france_ligue_one',       csv: 'F1',  fd: true },
  DED: { name: 'Eredivisie',     oddsKey: 'soccer_netherlands_eredivisie', csv: 'N1',  fd: true },
  PPL: { name: 'Primeira Liga',  oddsKey: 'soccer_portugal_primeira_liga', csv: 'P1',  fd: true },
  ELC: { name: 'Championship',   oddsKey: 'soccer_efl_champ',              csv: 'E1',  fd: true },
  // NON coperti da football-data.org: partite e quote da The Odds API
  T1:  { name: 'Super Lig (Turchia)',   oddsKey: 'soccer_turkey_super_league', csv: 'T1',  fd: false },
  G1:  { name: 'Super League (Grecia)', oddsKey: 'soccer_greece_super_league', csv: 'G1',  fd: false },
  B1:  { name: 'Jupiler League (Belgio)', oddsKey: 'soccer_belgium_first_div', csv: 'B1',  fd: false },
  SC0: { name: 'Premiership (Scozia)',  oddsKey: 'soccer_spl',                 csv: 'SC0', fd: false },
  // serie minori: non attive di default (aggiungile a COMPETITIONS se Pinnacle risulta presente)
  E2:  { name: 'League One',     oddsKey: 'soccer_england_league1',        csv: 'E2',  fd: false },
  E3:  { name: 'League Two',     oddsKey: 'soccer_england_league2',        csv: 'E3',  fd: false },
  I2:  { name: 'Serie B',        oddsKey: 'soccer_italy_serie_b',          csv: 'I2',  fd: false },
  SP2: { name: 'Segunda Division', oddsKey: 'soccer_spain_segunda_division', csv: 'SP2', fd: false },
  F2:  { name: 'Ligue 2',        oddsKey: 'soccer_france_ligue_two',       csv: 'F2',  fd: false },
  D2:  { name: '2. Bundesliga',  oddsKey: 'soccer_germany_bundesliga2',    csv: 'D2',  fd: false }
};
const DEFAULT_COMPETITIONS = 'SA,PL,BL1,PD,FL1,DED,PPL,ELC,T1,G1,B1,SC0';
module.exports = { LEAGUES, DEFAULT_COMPETITIONS };
