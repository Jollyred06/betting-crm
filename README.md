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
`/` porta a `/app.html`, l'unica pagina: Home (cosa fare adesso, verdetto, numeri, bankroll di carta, tappe, controlli, prossime partite), Segnali, Strategie (quella in prova con le varianti, piu' le provate e scartate), Bankroll (curva, movimenti, deposito/prelievo/imposta saldo) e Altro (Azioni, Log, Info). La chiave si chiede solo quando serve (salvata nel browser, inviata nell'intestazione, mai nell'indirizzo). Le vecchie pagine /dashboard.html e /tracker.html portano all'app.
Il vecchio stato JSON e' su `/api/status`.

## Affidabilità e controlli
- **Quote complete per segnale** (`quotes`, `n_near_best`): per ogni segnale si salvano tutte le quote dei bookmaker. Dice se la quota migliore era offerta da più bookmaker (ottenibile) o da uno solo (possibile quota fuori linea); compare nei segnali, nelle fotografie delle tappe, nelle strategie e nel CSV. Se le colonne non esistono ancora (schema non rieseguito) il segnale si salva comunque senza.
- **Controllo di sistema** (Altro, Azioni): database, tabelle e colonne, variabili, The Odds API, football-data.org, Telegram, giro giornaliero, Pinnacle. Mai il valore di una chiave.
- **Copia di sicurezza** (Altro, Azioni): file JSON con segnali, bankroll, tappe, log e partite collegate.
- **Giro di riserva**: POST `/api/run-daily-if-missing` (cron-job.org alle 11:30). Se il giro delle 11:00 è già riuscito non fa niente; altrimenti lo esegue e avvisa su Telegram.
- **Chiave nell'intestazione** `x-run-key`; con `ALLOW_KEY_IN_URL=0` la chiave negli indirizzi viene rifiutata.
- **App installabile** (manifest, icone, service worker): Aggiungi a schermata Home.

## Tappe (100, 200, 300 segnali chiusi)
Alla soglia il server salva UNA fotografia dei numeri (sui primi N segnali chiusi, con impronta sha256), mai modificabile dall'app. La regola della decisione e' fissata in `services/milestones.js` (1 ottobre 2026): 100 e 200 sono solo controlli, si decide a 300. Azioni, "Scarica i segnali (CSV)" per mandare i dati in chat all'analisi.

## Avvisi Telegram
Un solo messaggio per giro quando compaiono NUOVI segnali (mai ripetuti), piu' un avviso se il giro fallisce. Variabili su Render: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Nell'app (Azioni): "Trova il mio chat Telegram" e "Invia un messaggio di prova"; i passi sono nella scheda Info.

## Test (senza database ne' rete)
`npm test`

## Limiti noti
- Nel backtest la strategia usava le quote di Bet365; dal vivo Bet365 non c'e': si usa la migliore quota tra i bookmaker europei di The Odds API (variante).
- La chiusura e' la media delle quote di chiusura (football-data.co.uk), perche' Pinnacle da gennaio 2026 non e' piu' nei file.
- Crediti The Odds API (piano gratuito: 500 al mese): 1 per chiamata; i campionati fuori stagione o con chiave non valida non si chiamano (l'elenco e' gratuito). Il log scrive i crediti rimasti.
- Non verificato dal vivo: presenza di Pinnacle su The Odds API per i campionati minori, e i nomi esatti delle squadre di Turchia, Grecia, Belgio e Scozia.
