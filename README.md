# Betting CRM — tracker (senza soldi veri)

**Stato onesto:** i test (Serie A, Brasile, xG, 19 campionati con 68.000 partite) non hanno trovato nessuna strategia con un
vantaggio dimostrato. Il CRM serve a MISURARE dal vivo la strategia A ("migliore quota contro la probabilita' onesta di Pinnacle"),
non a giustificare puntate con soldi veri. Report: `backtest_serieA_report.md`, `test_19_campionati_report.md`.

## Cosa fa ogni giorno (cron-job.org -> POST /api/run-daily)
1. Chiude in automatico i segnali con risultato disponibile e calcola il valore rispetto alla chiusura (CLV).
2. Per i campionati con partite oggi (SA, PL, BL1, PD, FL1, DED, PPL, ELC) confronta la quota migliore con la probabilita' di Pinnacle.
3. Salva i segnali con vantaggio tra 3% e 15% (puntata "di carta" fissa). Nessuna notifica giornaliera.

## Una volta a settimana (cron-job.org -> POST /api/weekly-report?key=...)
Riepilogo: segnali, ROI a puntata fissa, valore medio vs chiusura con intervallo. Prova solo dopo circa 300 segnali chiusi.

## Test (senza database ne' rete)
`npm test`

## Limiti noti
- Nel backtest la strategia usava le quote di Bet365; dal vivo Bet365 non c'e': si usa la migliore quota tra i bookmaker europei di The Odds API (variante).
- La chiusura e' la media delle quote di chiusura (football-data.co.uk), perche' Pinnacle da gennaio 2026 non e' piu' nei file.
- Crediti The Odds API: 1 per campionato con partite in giornata (piano gratuito: 500 al mese).
