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
CREATE INDEX IF NOT EXISTS idx_odds_fixture ON odds(fixture_id);
CREATE INDEX IF NOT EXISTS idx_valuebets_status ON value_bets(status);
CREATE INDEX IF NOT EXISTS idx_refstats_fixture ON referee_stats(fixture_id);
CREATE INDEX IF NOT EXISTS idx_matchstats_fixture ON match_stats(fixture_id);
CREATE INDEX IF NOT EXISTS idx_closingodds_fixture ON closing_odds(fixture_id);
