/**
 * 🪜 SCALATA e 📈 CASSA KELLY (21 novembre 2026, chiesto da Christian).
 *
 * 22/11/2026 (deciso con Christian): la scalata passa dalla MARTINGALA al D'ALEMBERT CON TETTO. Rimescolando 1.000 volte l'ordine
 * delle stesse 1.750 giocate dello storico, la martingala con freno a 10 e cassa 250 svuotava la cassa nel 44% dei casi (10 perse di
 * fila capitano ~3 volte in 14 anni: lo storico senza freni era fortuna). D'Alembert: puntata = gradino x n, dopo una persa n+1,
 * dopo una vinta n-1 (minimo 1), TETTO 30 (con 0,20 al massimo 6 euro). Cassa 250: finita 1-4 volte su 1.000, utile tipico +776 euro,
 * ATTENZIONE (22/11): con ~42% di vinte la puntata sale piano e resta il 92% del tempo tra i gradini 20 e 30 (al tetto il 26%): in pratica
 * e' una salita fino a 4-6 euro fissi. Se le quote vere fossero piu' basse del 4%: cassa finita 2,4%, dell'8%: 25,6% (da sorvegliare),
 * 5% peggiore +622. Gradino = cassa / 1.250 (0,20 con 250), ricalcolato quando si torna a 1. Quote 2-3,50 (sotto 2 rende meno).
 * Sotto e' la descrizione originale (martingala), tenuta per la storia.
 * Obiettivo dichiarato: "perdere pochi soldi e aumentare il profitto".
 *
 * SCALATA — una giocata al giorno, partenza 0,20 euro, raddoppio dopo ogni persa, FRENO A 10 (perdita massima 204,60 euro),
 * poi si riparte da 0,20. Sullo storico (14 stagioni, cassa 500): +701 euro, 2 anni in perdita su 14, serie peggiore 10.
 * La partita del giorno e' scelta per perdere il meno possibile: solo giocate PAGATE PIU' DEL GIUSTO (almeno +2%) su un sito
 * dove si puo' giocare, quota 2,00-3,50 (sotto 2 il raddoppio non recupera), e tra queste la PIU' PROBABILE, con un piccolo
 * premio se e' anche il favorito (pronostico IA d'accordo: valore +4,6% contro +3,0%), in casa (+6,9% sullo storico),
 * campionato serio e quota ferma. La giocata del giorno si fissa alla prima scansione che la trova e non cambia piu'.
 *
 * CASSA KELLY — la cassa che Christian dichiara (salvata nel database): la puntata di ogni ⭐ = cassa x 1/4 Kelly, massimo 2%.
 */
// 22/11 (Christian: anche 888sport ha il minimo di 1 €): si parte da 1 € e si sale di 0,20 € (STEP = 20% della partenza) fino a 5 € (21 gradini)
// 23/11 (Christian: si parte sempre da 1 €, scegli tu la scala): passi da 0,50 € -> 1; 1,50; 2; 2,50; 3; 3,50; 4; 4,50; 5 € (tetto).
// Sulle 542 partite vere: +241 € (+0,20: +208); quote 4% peggiori +141 €; rimescolate: tipico +112 €, 1 volta su 10 sotto +66 €,
// cassa sotto 100 € 1,1 volte su 100. Serie storta fino al tetto: 22 € persi.
const BASE = 1, STEP = 0.5, STOP = 9, MIN_ODD = 2, MAX_ODD = 4,   // 22/11 sera: da 3,50 a 4 (+12% di partite, stesso guadagno sullo storico)
    MIN_EDGE = 2, SINCE = '2026-11-22T00:00:00Z';
const PICK = { home: '1', draw: 'X', away: '2' };
// puntata minima per sito (21/11, verificati da Christian): sotto 1 euro si puo' giocare solo su 888sport
const BOOK_MIN = { eurobet: 1, goldbet: 1, '888sport_it': 1 };   // 22/11: anche 888sport da 1 €
const minOf = k => (BOOK_MIN[k] === undefined ? 1 : BOOK_MIN[k]);
const T = x => new Date(x).getTime();
const ROME_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayOf = t => ROME_DAY.format(new Date(t));
let ready = false;
async function ensure(pool) {
  if (ready) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS scalata_picks (id SERIAL PRIMARY KEY, day TEXT NOT NULL UNIQUE, event_id TEXT NOT NULL, selection TEXT NOT NULL,
    league TEXT, home TEXT, away TEXT, commence_time TIMESTAMPTZ, prob NUMERIC(8,5), book TEXT, odd NUMERIC(8,3), edge_pct NUMERIC(8,3), score NUMERIC(8,3), reasons JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), result TEXT, result_score TEXT, settled_at TIMESTAMPTZ)`);
  // 21/11: le quote di tutti i miei siti, per giocare dove la puntata minima lo permette (Eurobet 1 euro, Goldbet 0,10)
  await pool.query(`ALTER TABLE scalata_picks ADD COLUMN IF NOT EXISTS quotes JSONB`);
  // 21/11 sera: piu' giocate nello stesso giorno, una dopo l'altra (non piu' una al giorno); 'manual' = esito segnato da Christian
  await pool.query(`ALTER TABLE scalata_picks DROP CONSTRAINT IF EXISTS scalata_picks_day_key`);
  await pool.query(`ALTER TABLE scalata_picks ADD COLUMN IF NOT EXISTS manual BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS scalata_picks_ev_sel ON scalata_picks (event_id, selection)`);
  // 22/11: la quota a cui Christian ha giocato davvero (puo' essere diversa da quella proposta): il saldo si calcola con questa
  await pool.query(`ALTER TABLE scalata_picks ADD COLUMN IF NOT EXISTS played_odd NUMERIC(8,3)`);
  await pool.query(`ALTER TABLE scalata_picks ADD COLUMN IF NOT EXISTS played_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE scalata_picks ADD COLUMN IF NOT EXISTS auto_skip BOOLEAN NOT NULL DEFAULT FALSE`);
  ready = true;
}

/** Punteggio della scalata: probabilita' prima di tutto (meno serie storte), poi i premi. */
function ladderScore(x) {
  const fav = x.isFav ? 2 : 0;
  return 100 * x.prob + fav + (x.isHome ? 1 : 0) + (x.isMajor ? 1 : 0) + (x.movedPts !== null && x.movedPts !== undefined && Math.abs(x.movedPts) < 2 ? 1 : 0) + Math.min(x.edgePct, 8) / 4;
}
/** Parte pura: le candidate di una lettura (riusa le candidate delle Migliori, che hanno gia' fiducia, valore e quadro).
 *  stake (21/11): la puntata del gradino; si tengono solo i siti che la accettano, e quota e valore sono quelli del sito migliore
 *  tra questi (ai gradini 1-3, sotto 1 euro, solo 888sport). */
function pickScalata(cands, stake = 0) {
  const out = [];
  for (const x of cands || []) {
    let odd = x.odd, book = x.book;
    if (stake > 0) { const ok = Object.entries(x.quotes || {}).filter(([k]) => minOf(k) <= stake + 1e-9).sort((a, b) => b[1] - a[1]); if (!ok.length) continue; [book, odd] = ok[0]; }
    const edgePct = (odd * x.prob - 1) * 100;
    if (odd < MIN_ODD || odd > MAX_ODD || edgePct < MIN_EDGE) continue;
    const y = { ...x, book, odd, edgePct }; out.push({ ...y, score: ladderScore(y) });
  }
  return out.sort((a, b) => b.score - a.score);
}
function reasonsOf(x) {
  const r = [`vince il ${Math.round(100 * x.prob)}%`, `paga +${x.edgePct.toFixed(1).replace('.', ',')}% più del giusto`];
  if (x.isFav) r.push('🤝 favorita (IA d\'accordo)'); if (x.isHome) r.push('in casa'); if (x.isMajor) r.push('campionato serio');
  if (x.movedPts !== null && x.movedPts !== undefined && Math.abs(x.movedPts) < 2) r.push('quota ferma');
  return r;
}

/** Dopo ogni scansione: se per un giorno non c'e' ancora la giocata, si fissa la migliore candidata di quel giorno. */
let lastRead = null;   // l'ultima lettura delle quote (per scegliere subito la prossima dopo un esito segnato a mano)
async function record(pool, merged, books, nowMs = Date.now()) {
  if (nowMs < T(SINCE)) return 0;
  if (merged && merged.length) lastRead = { merged, books, at: nowMs };
  await ensure(pool);
  const M = require('./migliori');
  const ids = [...new Set((merged || []).map(r => r.event_id))], firstPin = new Map();
  if (ids.length) for (const f of (await pool.query(`SELECT DISTINCT ON (event_id) event_id, pin_h, pin_d, pin_a FROM pin_history WHERE event_id = ANY($1) ORDER BY event_id, at`, [ids]).catch(() => ({ rows: [] }))).rows) firstPin.set(f.event_id, f);
  // candidate: tutte le giocate di valore (le Migliori chiedono almeno il 50%, la scalata no: quota 2-3,50 = 29-50%)
  const cands = M.pickMigliori(merged, books, nowMs, firstPin, { minProb: 0.25 });
  // la scalata va in ordine: finche' la giocata precedente non ha il risultato non si sceglie la prossima (la puntata dipende da li')
  // Piu' giocate nello stesso giorno (21/11 sera): appena la precedente ha l'esito (automatico o segnato a mano) si sceglie la
  // prossima, tra le partite che iniziano da 30 minuti a 12 ore da adesso, mai una gia' usata.
  const all = (await pool.query(`SELECT id, day, event_id, selection, commence_time, odd, played_odd, result FROM scalata_picks ORDER BY commence_time, id`)).rows;
  if (all.some(r => !['won', 'lost', 'skip'].includes(r.result))) return 0;
  const C = await getScalataCassa(pool), stake = ladder(all, C || {}).nextStake, used = new Set(all.map(r => r.event_id));
  // 22/11: mai una partita che e' gia' nelle ⭐ (Kelly): ogni partita in un solo metodo
  let stars = new Set(); try { const I = require('./italia'); stars = new Set((await require('./sigstore').rows(pool, { strategy: 'I' })).filter(r => I.isOceani(r)).map(r => r.event_id)); } catch (e) { /* facoltativo */ }
  const x = pickScalata(cands, stake).find(c => !used.has(c.event_id) && !stars.has(c.event_id) && T(c.commence_time) >= nowMs + 30 * 60000 && T(c.commence_time) <= nowMs + 12 * 3600000);
  if (!x) return 0;
  const r = await pool.query(`INSERT INTO scalata_picks (day, event_id, selection, league, home, away, commence_time, prob, book, odd, edge_pct, score, reasons, quotes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (event_id, selection) DO NOTHING`,
    [dayOf(x.commence_time), x.event_id, x.selection, x.league, x.home, x.away, x.commence_time, x.prob, x.book, x.odd, x.edgePct, x.score, JSON.stringify(reasonsOf(x)), JSON.stringify(x.quotes || {})]);
  return r.rowCount;
}
/**
 * 22/11 (Christian: "spesso non riesco a guardarle"): UN'ORA dopo l'inizio, la partita della scalata che non hai segnato con
 * "Ho giocato a quota" diventa da sola NON GIOCATA (non conta: stesso gradino) e si passa alla prossima. Prima il risultato
 * arrivava lo stesso e contava come giocata. Se l'avevi giocata, scrivi la quota fino a fine giornata: torna in gioco.
 */
const AUTO_SKIP_MS = 3600000;
async function autoSkip(pool, nowMs = Date.now()) {
  await ensure(pool);
  const r = await pool.query(`UPDATE scalata_picks SET result = 'skip', auto_skip = TRUE, settled_at = NOW()
    WHERE result IS NULL AND played_odd IS NULL AND commence_time < to_timestamp($1::double precision / 1000) RETURNING id`, [nowMs - AUTO_SKIP_MS]);
  if (r.rowCount && lastRead && nowMs - lastRead.at < 3 * 3600000) { try { await record(pool, lastRead.merged, lastRead.books, nowMs); } catch (e) { /* alla prossima scansione */ } }
  return r.rowCount;
}
/** 22/11: "l'ho giocata a 1,96": quota vera della giocata (serve al saldo della scalata). */
async function setPlayed(pool, id, odd) {
  const o = Number(String(odd).replace(',', '.'));
  if (!(o > 1 && o < 50)) { const e = new Error('Scrivi la quota a cui hai giocato, per esempio 1,96'); e.status = 400; throw e; }
  await ensure(pool);
  // se era stata segnata da sola come non giocata, torna in gioco (il risultato lo prende dai risultati automatici o lo segni tu)
  const r = await pool.query(`UPDATE scalata_picks SET played_odd = $2, played_at = NOW(), result = CASE WHEN auto_skip THEN NULL ELSE result END,
    result_score = CASE WHEN auto_skip THEN NULL ELSE result_score END, settled_at = CASE WHEN auto_skip THEN NULL ELSE settled_at END, auto_skip = FALSE WHERE id = $1 RETURNING id`, [Number(id), o]);
  if (!r.rowCount) { const e = new Error('Giocata della scalata non trovata'); e.status = 404; throw e; }
  return { played_odd: o };
}
/** Esito segnato a mano da Christian (per non aspettare i risultati automatici): vale subito per il calcolo della scalata. */
async function setResult(pool, id, result, score = null) {
  // 'skip' (21/11): non giocata -> non conta nella scalata (stesso gradino, stessa puntata) e se ne propone un'altra
  if (!['won', 'lost', 'skip'].includes(result)) throw new Error('Esito non valido (vinta, persa o non giocata)');
  await ensure(pool);
  // vinta o persa segnata a mano = giocata (alla quota proposta se non hai scritto la tua)
  const r = await pool.query(`UPDATE scalata_picks SET result = $2, result_score = $3, manual = TRUE, auto_skip = FALSE, settled_at = NOW(),
    played_odd = CASE WHEN $2 IN ('won', 'lost') THEN COALESCE(played_odd, odd) ELSE played_odd END WHERE id = $1 RETURNING id`, [Number(id), result, score]);
  if (!r.rowCount) throw new Error('Giocata della scalata non trovata');
  // la prossima subito, con le quote dell'ultima scansione (se non piu' vecchie di 3 ore); altrimenti alla scansione successiva
  if (lastRead && Date.now() - lastRead.at < 3 * 3600000) { try { await record(pool, lastRead.merged, lastRead.books); } catch (e) { /* alla prossima scansione */ } }
  return true;
}
async function settle(pool) {
  await ensure(pool);
  const M = require('./migliori');
  await autoSkip(pool);
  // 22/11: si chiudono da sole solo le giocate segnate come giocate (le altre diventano "non giocate" un'ora dopo l'inizio)
  const rows = (await pool.query(`SELECT s.id, s.selection, g.result_score FROM scalata_picks s JOIN goal_watch g ON g.event_id = s.event_id WHERE s.result IS NULL AND s.played_odd IS NOT NULL AND g.result_score ~ '^[0-9]+-[0-9]+$'`)).rows;
  for (const r of rows) await pool.query(`UPDATE scalata_picks SET result = $2, result_score = $3, settled_at = NOW() WHERE id = $1`, [r.id, M.resultOf(r.selection, r.result_score), r.result_score]);
  return rows.length;
}

/** Parte pura: la scalata giocata per giocata (dal 22/11 D'Alembert con tetto 30) e la puntata di adesso. */
/** cassa (21/11 sera, deciso con Christian): la partenza di ogni giro = cassa della scalata / 1.250, arrotondata in giu' a 0,10
 *  (minimo 0,10). Cassa della scalata = quella dichiarata - i ritiri + il saldo della scalata. Senza cassa: partenza fissa 0,20. */
// partenza = cassa / 250 (con 250 € -> 1 €, con 500 € -> 2 €), mai sotto 1 € (minimo dei siti); tetto = 5 volte la partenza (2% della cassa)
const baseFor = c => Math.max(1, Math.floor(c / 250 * 10 + 1e-9) / 10);
const stakeAt = (base, k) => Math.round(base * (1 + STEP * (k - 1)) * 100) / 100;
function ladder(rows, { base = BASE, stop = STOP, cassa = null, withdrawn = 0, lastLevel = 0, keepAll = false } = {}) {
  // 22/11: D'Alembert con tetto. k = numero di gradini (1..stop); stake = gradino x k
  const adaptive = Number(cassa) > 0, bankAt = p => Number(cassa) - Number(withdrawn || 0) + p;
  if (adaptive) base = baseFor(bankAt(0));
  const key = r => `${r.commence_time ? new Date(r.commence_time).toISOString() : r.day}|${String(r.id || 0).padStart(9, '0')}`;
  const list = [...rows].sort((a, b) => key(a).localeCompare(key(b))); let k = 1, lost = 0, pnl = 0, staked = 0, stops = 0, cycles = 0, maxK = 1, waiting = false;
  const steps = [];
  for (const r of list) {
    if (r.result === 'skip') continue;   // non giocata: non conta
    const stake = stakeAt(base, k), odd = Number(r.played_odd) > 1 ? Number(r.played_odd) : Number(r.odd), res = r.result;   // 22/11: la quota giocata davvero
    if (res !== 'won' && res !== 'lost') { steps.push({ ...r, step: k, stake, open: true }); waiting = true; continue; }
    staked += stake;
    if (res === 'won') { const win = stake * (odd - 1); pnl += win; lost = Math.max(0, lost - win); steps.push({ ...r, step: k, stake, pnl: win });
      k = Math.max(1, k - 1); if (k === 1) { steps[steps.length - 1].cycleEnd = 'vinta'; cycles++; lost = 0; if (adaptive) base = baseFor(bankAt(pnl)); } }
    else { pnl -= stake; lost += stake; steps.push({ ...r, step: k, stake, pnl: -stake }); if (k >= stop) { steps[steps.length - 1].cycleEnd = 'tetto'; stops++; } k = Math.min(stop, k + 1); maxK = Math.max(maxK, k); }
  }
  const cassaNow = adaptive ? bankAt(pnl) : null;
  return { method: 'dalembert', base, stop, maxStake: stakeAt(base, stop), maxLoss: Array.from({ length: stop }, (_, i) => stakeAt(base, i + 1)).reduce((a, b) => a + b, 0), step: k, nextStake: stakeAt(base, k), lostInCycle: lost, pnl, staked, cycles, stops, maxStep: maxK, waiting,
    cassa: adaptive ? Number(cassa) : null, withdrawn: Number(withdrawn || 0), cassaNow,
    // ritiro del capitale: appena la cassa della scalata raddoppia, si ritira la cassa iniziale (una volta)
    // 21/11 sera: dopo il primo ritiro, ogni volta che la cassa raddoppia ancora (rispetto a dopo l'ultimo ritiro) si ritira meta' del guadagno
    withdrawAlert: !adaptive ? 0 : !Number(withdrawn) ? (cassaNow >= 2 * Number(cassa) ? Number(cassa) : 0)
      : (Number(lastLevel) > 0 && cassaNow >= 2 * Number(lastLevel) ? Math.floor((cassaNow - Number(lastLevel)) / 2) : 0),
    firstWithdraw: adaptive && !Number(withdrawn), lastLevel: Number(lastLevel) || null,
    steps: keepAll ? steps : steps.slice(-15).reverse() };   // keepAll: tutti i gradini, in ordine (per le casse dei siti)
}
async function getScalata(pool, { nowMs = Date.now() } = {}) {
  await ensure(pool);
  try { await autoSkip(pool, nowMs); } catch (e) { /* facoltativo */ }
  const BN = require('./italia').BOOK_NAMES || {};
  const rows = (await pool.query(`SELECT id, day, event_id, selection, league, home, away, commence_time, prob, book, odd, edge_pct, reasons, quotes, result, result_score, manual, played_odd, played_at, auto_skip FROM scalata_picks ORDER BY commence_time, id`)).rows
    .map(r => ({ ...r, prob: Number(r.prob), odd: Number(r.odd), edgePct: Number(r.edge_pct), pick: PICK[r.selection], bookKey: r.book, book: BN[r.book] || r.book,
      quotes: Object.entries(r.quotes || {}).map(([k, q]) => ({ key: k, book: BN[k] || k, odd: Number(q), edgePct: (Number(q) * Number(r.prob) - 1) * 100 })).sort((a, b) => b.odd - a.odd) }));
  const C = await getScalataCassa(pool), L = ladder(rows, C || {}), next = rows.find(r => !['won', 'lost', 'skip'].includes(r.result));   // la giocata in corso (una alla volta)
  // 22/11: le partite segnate da sole come non giocate oggi (per scrivere la quota se invece l'avevi giocata)
  const dayR = ms => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }), today = dayR(nowMs);
  const autoSkipped = rows.filter(r => r.auto_skip && r.result === 'skip' && dayR(T(r.commence_time)) === today).map(r => ({ id: r.id, home: r.home, away: r.away, pick: r.pick, odd: r.odd, commence_time: r.commence_time }));
  return { since: SINCE, rules: { base: BASE, stop: STOP, minOdd: MIN_ODD, maxOdd: MAX_ODD, minEdge: MIN_EDGE }, ...L, next: next || null, autoSkipped, autoSkipMin: AUTO_SKIP_MS / 60000 };
}

/** 🪜 la cassa della scalata (dichiarata da Christian) e i ritiri. */
async function getScalataCassa(pool) { try { const v = await require('./calib').loadState(pool, 'scalata_cassa'); return v && Number(v.cassa) > 0 ? { cassa: Number(v.cassa), withdrawn: Number(v.withdrawn || 0), lastLevel: Number(v.lastLevel || 0) } : null; } catch (e) { return null; } }
/** Ritiro fatto (21/11): somma il ritirato e fissa il livello da cui misurare il prossimo raddoppio. */
async function withdrawScalata(pool, amount) {
  const a = Number(amount); if (!(a > 0)) throw new Error('Importo del ritiro non valido');
  const cur = await getScalataCassa(pool); if (!cur) throw new Error('Prima scrivi la cassa della scalata');
  const rows = (await pool.query(`SELECT id, day, commence_time, odd, played_odd, result FROM scalata_picks ORDER BY commence_time, id`)).rows;
  const now = ladder(rows, cur).cassaNow, withdrawn = cur.withdrawn + a, lastLevel = now - a;
  await require('./calib').saveState(pool, 'scalata_cassa', { cassa: cur.cassa, withdrawn, lastLevel, at: new Date().toISOString() });
  return { cassa: cur.cassa, withdrawn, lastLevel };
}
async function setScalataCassa(pool, { cassa, withdrawn } = {}) {
  const C = require('./calib'); await C.ensureCalib(pool); const cur = (await getScalataCassa(pool)) || { cassa: 0, withdrawn: 0 };
  const next = { cassa: cassa === undefined || cassa === null ? cur.cassa : Number(cassa), withdrawn: withdrawn === undefined || withdrawn === null ? cur.withdrawn : Number(withdrawn) };
  if (!(next.cassa >= 10 && next.cassa <= 1e6) || !(next.withdrawn >= 0)) throw new Error('Cassa non valida (da 10 a 1.000.000 euro)');
  await C.saveState(pool, 'scalata_cassa', { ...next, lastLevel: cur.lastLevel || 0, at: new Date().toISOString() }); return next;
}
/** 📈 la cassa per Kelly, dichiarata da Christian (null = usa il saldo del budget). */
async function getKellyCassa(pool) { try { const v = await require('./calib').loadState(pool, 'kelly_cassa'); return v && Number(v.value) > 0 ? Number(v.value) : null; } catch (e) { return null; } }
/** 21/11 sera: la cassa Kelly si aggiorna da sola = quella scritta + il saldo delle giocate vere (Svago escluso) segnate dopo. */
function kellyNowOf(declared, at, items) {
  const t0 = Date.parse(at || 0) || 0; let pnl = 0, n = 0;
  for (const x of items || []) { if (x.list === 'svago' || !(x.result === 'won' || x.result === 'lost' || x.result === 'void')) continue; if (Date.parse(x.at) < t0) continue; pnl += Number(x.pnlEur) || 0; n++; }
  return { value: declared, now: declared + pnl, pnl, n };
}
async function getKelly(pool) {
  try { const v = await require('./calib').loadState(pool, 'kelly_cassa'); if (!(v && Number(v.value) > 0)) return null;
    const P = await require('./played').getPlayed(pool).catch(() => null); return { ...kellyNowOf(Number(v.value), v.at, P && P.items), at: v.at }; } catch (e) { return null; }
}
async function setKellyCassa(pool, value) {
  const v = Number(value); if (!(v >= 10 && v <= 1e6)) throw new Error('Cassa non valida (da 10 a 1.000.000 euro)');
  await require('./calib').ensureCalib(pool); await require('./calib').saveState(pool, 'kelly_cassa', { value: v, at: new Date().toISOString() }); return v;
}

module.exports = { autoSkip, setPlayed, kellyNowOf, getKelly, withdrawScalata, baseFor, getScalataCassa, setScalataCassa, BOOK_MIN, minOf, ladderScore, pickScalata, reasonsOf, record, settle, setResult, ladder, getScalata, getKellyCassa, setKellyCassa, BASE, STEP, STOP, SINCE, stakeAt };
