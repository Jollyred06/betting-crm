# Betting CRM — tracker di segnali su calcio (modello V1)

**Stato onesto:** il backtest su 4 stagioni di Serie A (vedi `backtest_serieA_report.md`) ha mostrato che il
vecchio modello sbagliava le probabilita' e che quello corretto (V1) e' ben calibrato ma NON batte il mercato.
I segnali servono a MISURARE (tracker), non come prova che convenga puntare soldi veri.

## Cosa fa ogni giorno (cron-job.org -> POST /api/run-daily)
1. Aggiorna lo storico partite dalla stagione in corso (football-data.co.uk).
2. Calcola con V1 le probabilita' 1X2 e Over/Under 2.5 delle partite di oggi (solo leghe validate: Serie A).
3. Le confronta con la quota migliore tra i bookmaker (The Odds API).
4. Protezioni: vantaggio tra 3% e 15%, massimo 3 segnali al giorno, tetto di esposizione 10% del bankroll.
5. Salva i segnali (con `model_version = v1`), scrive il log e notifica.

## Prima messa in funzione
1. Supabase -> SQL Editor: esegui tutto `db/schema.sql` (aggiunge `historical_matches` e `model_version`).
2. POST `/api/admin/import-history?key=LA_TUA_CHIAVE` (una tantum): carica i 4 CSV di `data/history`.
3. GET `/api/admin/history-status?key=LA_TUA_CHIAVE`: controlla che SA abbia ~1520 partite.

## Test (senza database ne' rete)
`npm test` — verifica che il modello JS coincida col backtest Python e che nomi squadra, quote e protezioni funzionino.

## Cose ancora da fare
- Confronto quota vista vs quota di chiusura (indicatore di vantaggio reale) — i dati di chiusura sono gia' in `historical_matches`.
- Altre leghe solo dopo il loro backtest (stesse regole: parametri decisi sullo sviluppo, test finale una volta sola).
