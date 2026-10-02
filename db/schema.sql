-- Schema per betting CRM

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  league_id INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fixtures (
  id INTEGER PRIMARY KEY,
  league_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  date TIMESTAMP NOT NULL,
  home_team_id INTEGER REFERENCES teams(id),
  away_team_id INTEGER REFERENCES teams(id),
  home_goals INTEGER,
  away_goals INTEGER,
  status TEXT, -- NS, FT, ecc.
  is_historical BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS odds (
  id SERIAL PRIMARY KEY,
  fixture_id INTEGER REFERENCES fixtures(id),
  bookmaker TEXT,
  market TEXT, -- '1X2', 'OU_2.5', 'BTTS'
  selection TEXT, -- 'home', 'draw', 'away', 'over', 'under', 'yes', 'no'
  odd_value NUMERIC(6,2) NOT NULL,
  captured_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS value_bets (
  id SERIAL PRIMARY KEY,
  fixture_id INTEGER REFERENCES fixtures(id),
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  bookmaker_odd NUMERIC(6,2) NOT NULL,
  bookmaker_name TEXT, -- quale bookmaker offre la quota migliore usata per il calcolo
  estimated_probability NUMERIC(5,4) NOT NULL, -- 0-1
  implied_probability NUMERIC(5,4) NOT NULL,   -- 1/odd
  edge_pct NUMERIC(6,3) NOT NULL,               -- vantaggio stimato
  recommended_stake NUMERIC(10,2),
  status TEXT DEFAULT 'pending', -- pending, won, lost, void, skipped
  ai_commentary TEXT, -- spiegazione in linguaggio naturale generata via Claude API
  created_at TIMESTAMP DEFAULT NOW()
);

-- Se la tabella esiste già da prima (creata senza bookmaker_name), questa
-- riga aggiunge la colonna senza toccare i dati esistenti. Sicura da
-- rieseguire più volte.
ALTER TABLE value_bets ADD COLUMN IF NOT EXISTS bookmaker_name TEXT;

CREATE TABLE IF NOT EXISTS referee_stats (
  id SERIAL PRIMARY KEY,
  fixture_id INTEGER REFERENCES fixtures(id),
  referee_name TEXT,
  avg_yellow_cards NUMERIC(4,2),
  avg_red_cards NUMERIC(4,2),
  avg_penalties NUMERIC(4,2),
  matches_sampled INTEGER,
  captured_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match_stats (
  id SERIAL PRIMARY KEY,
  fixture_id INTEGER REFERENCES fixtures(id),
  team_id INTEGER REFERENCES teams(id),
  avg_possession_pct NUMERIC(5,2),
  avg_shots_total NUMERIC(4,1),
  avg_shots_on_target NUMERIC(4,1),
  sample_matches INTEGER, -- quante partite recenti compongono la media
  captured_at TIMESTAMP DEFAULT NOW()
);

-- Quote di chiusura (closing line), salvate a fine finestra utile per backtesting futuro
CREATE TABLE IF NOT EXISTS closing_odds (
  id SERIAL PRIMARY KEY,
  fixture_id INTEGER REFERENCES fixtures(id),
  bookmaker TEXT,
  market TEXT,
  selection TEXT,
  odd_value NUMERIC(6,2) NOT NULL,
  captured_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bankroll_log (
  id SERIAL PRIMARY KEY,
  bet_id INTEGER REFERENCES value_bets(id),
  amount NUMERIC(10,2) NOT NULL, -- positivo = deposito/vincita, negativo = puntata/perdita
  balance_after NUMERIC(10,2) NOT NULL,
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fixtures_date ON fixtures(date);
CREATE TABLE IF NOT EXISTS run_logs (
  id SERIAL PRIMARY KEY,
  run_at TIMESTAMP DEFAULT NOW(),
  success BOOLEAN NOT NULL,
  fixtures_found INTEGER,
  value_bets_found INTEGER,
  football_data_requests INTEGER,
  odds_api_requests INTEGER,
  log_text TEXT, -- il dettaglio riga per riga di cosa è successo in quella esecuzione
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_odds_fixture ON odds(fixture_id);
CREATE INDEX IF NOT EXISTS idx_valuebets_status ON value_bets(status);
CREATE INDEX IF NOT EXISTS idx_refstats_fixture ON referee_stats(fixture_id);
CREATE INDEX IF NOT EXISTS idx_matchstats_fixture ON match_stats(fixture_id);
CREATE INDEX IF NOT EXISTS idx_closingodds_fixture ON closing_odds(fixture_id);
CREATE INDEX IF NOT EXISTS idx_runlogs_runat ON run_logs(run_at);

-- Storico partite (risultati + quote di chiusura medie) da football-data.co.uk, per il modello V1
CREATE TABLE IF NOT EXISTS historical_matches (
  id SERIAL PRIMARY KEY,
  league_code TEXT NOT NULL,
  match_date DATE NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_goals INTEGER NOT NULL,
  away_goals INTEGER NOT NULL,
  close_avg_h NUMERIC(6,2),
  close_avg_d NUMERIC(6,2),
  close_avg_a NUMERIC(6,2),
  close_avg_o25 NUMERIC(6,2),
  close_avg_u25 NUMERIC(6,2),
  UNIQUE (league_code, match_date, home_team, away_team)
);
CREATE INDEX IF NOT EXISTS idx_hist_league_date ON historical_matches(league_code, match_date);

-- Quale modello ha generato ogni segnale (v1 = validato col backtest)
ALTER TABLE value_bets ADD COLUMN IF NOT EXISTS model_version TEXT;

-- Download da TheStatsAPI: partite Serie A con xG e quote (per il backtest con xG)
CREATE TABLE IF NOT EXISTS xg_seasons (season_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS xg_matches (
  match_id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  season_rank INTEGER NOT NULL DEFAULT 0,
  utc_date TIMESTAMPTZ,
  home_team TEXT, away_team TEXT,
  home_goals INTEGER, away_goals INTEGER,
  xg_home NUMERIC(6,3), xg_away NUMERIC(6,3), npxg_home NUMERIC(6,3), npxg_away NUMERIC(6,3),
  b365_h NUMERIC(8,3), b365_d NUMERIC(8,3), b365_a NUMERIC(8,3), b365_o25 NUMERIC(8,3), b365_u25 NUMERIC(8,3),
  pin_h NUMERIC(8,3), pin_d NUMERIC(8,3), pin_a NUMERIC(8,3), pin_o25 NUMERIC(8,3), pin_u25 NUMERIC(8,3),
  stats_done BOOLEAN NOT NULL DEFAULT FALSE,
  odds_done BOOLEAN NOT NULL DEFAULT FALSE,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

-- Altri mercati Bet365 (per il backtest con xG): BTTS, Over/Under 1.5 e 3.5, doppia chance, draw no bet
ALTER TABLE xg_matches ADD COLUMN IF NOT EXISTS b365_o15 NUMERIC(8,3);
ALTER TABLE xg_matches ADD COLUMN IF NOT EXISTS b365_u15 NUMERIC(8,3);
ALTER TABLE xg_matches ADD COLUMN IF NOT EXISTS b365_o35 NUMERIC(8,3);
ALTER TABLE xg_matches ADD COLUMN IF NOT EXISTS b365_u35 NUMERIC(8,3);
ALTER TABLE xg_matches ADD COLUMN IF NOT EXISTS b365_btts_y NUMERIC(8,3);
ALTER TABLE xg_matches ADD COLUMN IF NOT EXISTS b365_btts_n NUMERIC(8,3);
ALTER TABLE xg_matches ADD COLUMN IF NOT EXISTS b365_dc_hd NUMERIC(8,3);
ALTER TABLE xg_matches ADD COLUMN IF NOT EXISTS b365_dc_ha NUMERIC(8,3);
ALTER TABLE xg_matches ADD COLUMN IF NOT EXISTS b365_dc_da NUMERIC(8,3);
ALTER TABLE xg_matches ADD COLUMN IF NOT EXISTS b365_dnb_h NUMERIC(8,3);
ALTER TABLE xg_matches ADD COLUMN IF NOT EXISTS b365_dnb_a NUMERIC(8,3);
ALTER TABLE xg_matches ADD COLUMN IF NOT EXISTS odds_v2 BOOLEAN NOT NULL DEFAULT FALSE;

-- Altri campionati (Bundesliga, Brasileirao, Premier, Liga, Ligue 1): il download li trova e li mette in coda da solo
ALTER TABLE xg_matches ADD COLUMN IF NOT EXISTS league_key TEXT NOT NULL DEFAULT 'SA';
ALTER TABLE xg_seasons ADD COLUMN IF NOT EXISTS competition_id TEXT;
ALTER TABLE xg_seasons ADD COLUMN IF NOT EXISTS league_key TEXT NOT NULL DEFAULT 'SA';
ALTER TABLE xg_seasons ADD COLUMN IF NOT EXISTS season_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE xg_seasons ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE xg_seasons ADD COLUMN IF NOT EXISTS done BOOLEAN NOT NULL DEFAULT TRUE;

-- Tracker strategia A: quale strategia ha generato il segnale, riferimento usato, esito automatico e valore vs chiusura
ALTER TABLE value_bets ADD COLUMN IF NOT EXISTS strategy TEXT;
ALTER TABLE value_bets ADD COLUMN IF NOT EXISTS sharp_source TEXT;
ALTER TABLE value_bets ADD COLUMN IF NOT EXISTS league_code TEXT;
ALTER TABLE value_bets ADD COLUMN IF NOT EXISTS result_score TEXT;
ALTER TABLE value_bets ADD COLUMN IF NOT EXISTS closing_fair_prob NUMERIC(6,4);
ALTER TABLE value_bets ADD COLUMN IF NOT EXISTS clv_pct NUMERIC(7,3);
ALTER TABLE value_bets ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP;

-- Prossima partita di ogni campionato seguito tramite The Odds API: serve a non spendere crediti quando non si gioca
CREATE TABLE IF NOT EXISTS league_schedule (
  league_code TEXT PRIMARY KEY,
  next_start TIMESTAMPTZ,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tappe a 100, 200 e 300 segnali chiusi: fotografie dei numeri, salvate una volta sola (con impronta per verificare che non siano state toccate)
CREATE TABLE IF NOT EXISTS milestone_snapshots (
  target INTEGER PRIMARY KEY,
  reached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_signal_id INTEGER,
  snapshot JSONB NOT NULL,
  decision JSONB,
  hash TEXT NOT NULL
);

-- Quote complete al momento del segnale: servono a verificare se la quota migliore era davvero ottenibile
ALTER TABLE value_bets ADD COLUMN IF NOT EXISTS quotes JSONB;
ALTER TABLE value_bets ADD COLUMN IF NOT EXISTS sharp_odd NUMERIC(8,3);
ALTER TABLE value_bets ADD COLUMN IF NOT EXISTS n_books INTEGER;
ALTER TABLE value_bets ADD COLUMN IF NOT EXISTS n_near_best INTEGER;
