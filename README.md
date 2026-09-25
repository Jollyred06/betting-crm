# Betting CRM — Value Betting su Calcio

Sistema per identificare value bets (quote del bookmaker più favorevoli della probabilità reale stimata) e gestire il bankroll in modo controllato. **Non garantisce vincite**: è uno strumento di analisi, non una macchina infallibile.

## Setup (0€ per iniziare)

1. **Database gratuito**: crea un progetto su [Supabase](https://supabase.com) (Postgres free tier). Copia la connection string.
2. **API quote**: registrati su [RapidAPI - API.Football](https://rapidapi.com/api-sports/api/api-football), piano gratuito (100 richieste/giorno). Copia la chiave.
3. Copia `.env.example` in `.env` e compila `DATABASE_URL` e `API_FOOTBALL_KEY`.
4. Su Replit: crea un nuovo Repl Node.js, carica questi file, imposta le variabili in "Secrets".
5. Esegui lo schema del database:
   ```
   psql $DATABASE_URL -f db/schema.sql
   ```
6. Installa le dipendenze e avvia:
   ```
   npm install
   npm start
   ```

## Import storico (una tantum)

```
npm run import:historical
```
Va rilanciato più giorni di seguito se il limite giornaliero (100 richieste) viene raggiunto a metà — lo script si ferma da solo e riprende dove serve.

## Endpoint disponibili

- `GET /api/value-bets` — lista scommesse con edge positivo
- `GET /api/bankroll` — saldo attuale e storico movimenti
- `POST /api/value-bets/:id/settle` — registra esito (`won`/`lost`/`void`) e aggiorna bankroll

## Mercati e dati coperti (aggiornato)

**Mercati analizzati** (in `services/valueEngine.js`, modello a gol attesi/Poisson):
1X2, Doppia Chance (1X/X2/12), Over/Under 1.5, Over/Under 2.5, BTTS.

**Dati raccolti per partita** (~40 richieste/giorno su 3 partite, ben sotto il limite di 100):
- Fixtures, quote (multi-bookmaker dalla stessa chiamata `/odds`), statistiche squadra, infortuni/squalifiche, classifica, H2H
- Statistiche arbitro (`referee_stats`) — le medie cartellini/rigori si costruiscono nel tempo incrociando lo storico delle partite dello stesso arbitro salvate in DB, non da un endpoint diretto
- Statistiche possesso/tiri (`match_stats`)
- Quote di chiusura (`closing_odds`) — salvate per costruire uno storico utile al backtesting futuro

**Nota sul volume dati**: il set è stato tenuto volutamente limitato a variabili con segnale reale (non tutte quelle disponibili), per evitare overfitting del modello.

## Prossimi passi consigliati

1. **Backtesting**: prima di puntare soldi veri, usa i dati storici importati per simulare la strategia sugli ultimi 12 mesi e vedere il ROI teorico.
2. **Paper trading**: 2-3 settimane di tracking senza soldi reali, per validare che il win-rate osservato sia coerente con quanto stimato.
3. **Fetch giornaliero automatico**: aggiungere un cron (node-cron è già nelle dipendenze) che recupera fixtures/quote ogni mattina.
4. **Frontend/dashboard**: se serve una UI visuale invece del solo JSON.

## Nota onesta

Il modello di stima probabilità in `services/valueEngine.js` è volutamente semplice (forma + medie gol). Il valore reale di questo sistema dipende da quanto affini la stima nel tempo confrontandola con i risultati reali — è un lavoro continuo, non un interruttore "vinci sempre".
