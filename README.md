# Betting CRM — tracker (senza soldi veri)

**Stato onesto:** i test (Serie A, Brasile, xG, 19 campionati con 68.000 partite) non hanno trovato nessuna strategia con un
vantaggio dimostrato. Il CRM serve a MISURARE dal vivo la strategia A ("migliore quota contro la probabilita' onesta di Pinnacle"),
non a giustificare puntate con soldi veri. Report: `backtest_serieA_report.md`, `test_19_campionati_report.md`.

## Cosa fa ogni giorno (cron-job.org -> POST /api/run-daily)
1. Chiude in automatico i segnali con risultato disponibile e calcola il valore rispetto alla chiusura (CLV).
2. Per i campionati con partite oggi confronta la quota migliore con la probabilita' di Pinnacle. Campionati: SA, PL, BL1, PD, FL1, DED, PPL, ELC
   (partite da football-data.org) e T1, G1, B1, SC0 (Turchia, Grecia, Belgio, Scozia: partite e quote da The Odds API, prossime 24 ore).
   Attivabili in piu' con la variabile COMPETITIONS: E2, E3, I2, SP2, F2, D2. Un segnale si salva solo se le squadre si riconoscono nello storico:
   i nomi non riconosciuti compaiono nel log ("NOMI SQUADRA NON RICONOSCIUTI") e si aggiungono in services/teamNames.js.
3. Salva i segnali con vantaggio tra 3% e 15% (puntata "di carta" fissa). Nessuna notifica giornaliera.

## Una volta a settimana (cron-job.org -> POST /api/weekly-report?key=...)
Riepilogo: segnali, ROI a puntata fissa, valore medio vs chiusura con intervallo. Prova solo dopo circa 300 segnali chiusi.

## Centro di controllo (l'unico indirizzo da ricordare)
`/` porta a `/app.html`: Home (cosa fare adesso, verdetto, numeri, controlli di salute, prossime partite), Segnali, Azioni (pulsanti: analisi, chiusura risultati, riepilogo, storico; si sbloccano con la chiave, salvata solo nel browser e inviata nell'intestazione, mai nell'indirizzo), Log, Info.
Il vecchio stato JSON e' su `/api/status`.

## Pagina Tracker
`/tracker.html` (link "Tracker" nella dashboard): verdetto in parole semplici, riepilogo, segnali (tutti / in attesa / chiusi), prossime partite per campionato, crediti rimasti e log dell'ultimo giro. Sola lettura: nessuna chiave, nessuna azione che consumi crediti.

## Test (senza database ne' rete)
`npm test`

## Limiti noti
- Nel backtest la strategia usava le quote di Bet365; dal vivo Bet365 non c'e': si usa la migliore quota tra i bookmaker europei di The Odds API (variante).
- La chiusura e' la media delle quote di chiusura (football-data.co.uk), perche' Pinnacle da gennaio 2026 non e' piu' nei file.
- Crediti The Odds API (piano gratuito: 500 al mese): 1 per chiamata; i campionati fuori stagione o con chiave non valida non si chiamano (l'elenco e' gratuito). Il log scrive i crediti rimasti.
- Non verificato dal vivo: presenza di Pinnacle su The Odds API per i campionati minori, e i nomi esatti delle squadre di Turchia, Grecia, Belgio e Scozia.
