/**
 * IL CRM CHE IMPARA (con prudenza).
 * Ogni volta che si apre, rilegge tutti i segnali misurati (I e B, prima uscita) e stima quanto vale ogni caratteristica
 * di un segnale contro la chiusura di Pinnacle: ore al calcio d'inizio, vantaggio, esito, fascia di quota.
 * Due protezioni contro l'"imparare il caso":
 *   1) restringimento: un gruppo con pochi segnali conta poco (peso n / (n + K)), con tanti conta di piu'
 *   2) prova onesta "a ritroso nel tempo": ogni segnale viene giudicato SOLO con i dati che c'erano prima di lui;
 *      cosi' si misura se le scelte del modello avrebbero fatto meglio di "prendere tutto", senza barare.
 * Il modello NON cambia da solo le regole di F, F2, F3: propone, e diventa una selezione solo quando la prova
 * a ritroso lo dimostra (abbastanza scelte e fascia di incertezza sopra quella di "tutti i segnali").
 */
const K = 20;             // forza del restringimento: con 20 segnali un gruppo pesa per meta'
const DAMP = 0.6;         // le caratteristiche si sovrappongono: la somma degli effetti si smorza
const MIN_TRAIN = 40;     // sotto questi segnali misurati il modello non giudica
const PICK_MARGIN = 0.5;  // il modello "sceglie" un segnale se lo stima almeno 0,5 punti sopra la media

// un solo formattatore per tutto il modulo: crearne uno a ogni segnale consumava centinaia di MB di memoria
const WEEKDAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', weekday: 'short' });
const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
const hours = r => (Date.parse(r.commence_time) - Date.parse(r.created_at)) / 3600000;

const FEATURES = {
  ore: { label: 'Ore al calcio d\'inizio', of: r => { const h = hours(r); return h <= 1.5 ? 'entro 1,5 ore' : h <= 3 ? 'da 1,5 a 3 ore' : 'da 3 a 6 ore'; } },
  vantaggio: { label: 'Vantaggio del segnale', of: r => { const e = num(r.edge_pct); return e < 3 ? '2–3%' : e < 4 ? '3–4%' : e < 6 ? '4–6%' : '6% e oltre'; } },
  esito: { label: 'Esito', of: r => ({ home: 'segno 1', draw: 'pareggio', away: 'segno 2' }[r.selection] || r.selection) },
  giorno: { label: 'Giorno della partita', of: r => { const d = WEEKDAY.format(new Date(r.commence_time)); return d === 'Sat' || d === 'Sun' ? 'weekend' : 'giorni feriali'; } },
  quota: { label: 'Quota', of: r => { const o = num(r.odd); return o < 1.6 ? 'sotto 1,60' : o <= 2.6 ? '1,60–2,60' : o <= 3.5 ? '2,60–3,50' : 'sopra 3,50'; } }
};

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
function band(values) {
  const n = values.length; if (n < 5) return { n, mean: n ? mean(values) : null, lo: null, hi: null, pos: n ? 100 * values.filter(v => v > 0).length / n : null };
  const m = mean(values), sd = Math.sqrt(values.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)), h = 1.96 * sd / Math.sqrt(n);
  return { n, mean: m, lo: m - h, hi: m + h, pos: 100 * values.filter(v => v > 0).length / n };
}

/** Allena il modello su segnali misurati. */
function fit(train) {
  const mu = mean(train.map(r => num(r.clv_pct)));
  const effects = {};
  for (const [f, def] of Object.entries(FEATURES)) {
    const groups = {};
    for (const r of train) (groups[def.of(r)] = groups[def.of(r)] || []).push(num(r.clv_pct));
    effects[f] = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, { n: v.length, raw: mean(v) - mu, shrunk: v.length / (v.length + K) * (mean(v) - mu) }]));
  }
  return { mu, effects, n: train.length };
}

function predict(model, r) {
  let s = 0;
  for (const [f, def] of Object.entries(FEATURES)) { const e = model.effects[f][def.of(r)]; if (e) s += e.shrunk; }
  return model.mu + DAMP * s;
}

/** Prova a ritroso: ogni segnale I giudicato con i soli segnali la cui partita era gia' iniziata (chiusura nota). */
function walkForward(measured) {
  const ordered = [...measured].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  // allenamento = partite gia' iniziate prima del segnale: in ordine di calcio d'inizio sono sempre "le prime k",
  // quindi il modello per ogni k si calcola una volta sola (molto piu' veloce con tanti segnali)
  const byKick = [...measured].sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time));
  const kicks = byKick.map(x => Date.parse(x.commence_time)), memo = new Map();
  const firstK = t => { let lo = 0, hi = kicks.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (kicks[mid] < t) lo = mid + 1; else hi = mid; } return lo; };
  const judged = [];
  for (const r of ordered) {
    if ((r.strategy || 'I') !== 'I') continue;
    const k = firstK(Date.parse(r.created_at));
    if (k < MIN_TRAIN) continue;
    if (!memo.has(k)) memo.set(k, fit(byKick.slice(0, k)));
    const m = memo.get(k);
    judged.push({ id: r.id, clv: num(r.clv_pct), pred: predict(m, r), pick: predict(m, r) >= m.mu + PICK_MARGIN });
  }
  const all = band(judged.map(j => j.clv)), picked = band(judged.filter(j => j.pick).map(j => j.clv)), skipped = band(judged.filter(j => !j.pick).map(j => j.clv));
  // il modello "ha dimostrato" qualcosa solo se le sue scelte battono chiaramente quelle scartate
  const proven = picked.n >= 30 && skipped.n >= 30 && picked.lo !== null && skipped.hi !== null && picked.lo > skipped.mean && picked.mean - skipped.mean >= 1;
  return { judged: judged.length, all, picked, skipped, proven };
}

/** Le probabilita' sono giuste? Partite vinte contro vinte attese (probabilita' di Pinnacle), in totale e per fascia. */
function calibration(rows) {
  const done = rows.filter(r => (r.result === 'won' || r.result === 'lost') && num(r.fair_prob) > 0);
  const grp = list => { const won = list.filter(r => r.result === 'won').length, exp = list.reduce((a, r) => a + num(r.fair_prob), 0);
    return { n: list.length, won, expected: exp, sd: Math.sqrt(list.reduce((a, r) => a + num(r.fair_prob) * (1 - num(r.fair_prob)), 0)) }; };
  const buckets = [['sotto il 35%', 0, 0.35], ['35–50%', 0.35, 0.5], ['50% e oltre', 0.5, 1.01]]
    .map(([label, lo, hi]) => ({ label, ...grp(done.filter(r => num(r.fair_prob) >= lo && num(r.fair_prob) < hi)) }));
  const total = grp(done);
  // "in linea" se la differenza tra vinte e attese sta entro 2 deviazioni (normale fortuna)
  return { ...total, ok: total.n >= 20 ? Math.abs(total.won - total.expected) <= 2 * total.sd : null, buckets };
}

/** Riepilogo per l'app: cosa ha imparato, come se la cava, e la stima per i segnali in arrivo. */
function buildLearning(rows, nowMs = Date.now()) {
  const measured = rows.filter(r => num(r.clv_pct) !== null);
  if (measured.length < MIN_TRAIN) return { ready: false, measured: measured.length, minTrain: MIN_TRAIN };
  const model = fit(measured);
  const learned = Object.entries(FEATURES).map(([f, def]) => ({
    key: f, label: def.label,
    levels: Object.entries(model.effects[f]).map(([k, e]) => ({ level: k, n: e.n, effect: e.shrunk, raw: e.raw })).sort((a, b) => b.effect - a.effect)
  }));
  const wf = walkForward(measured);
  const upcoming = rows.filter(r => (r.strategy || 'I') === 'I' && Date.parse(r.commence_time) > nowMs)
    .map(r => ({ id: r.id, pred: predict(model, r), pick: predict(model, r) >= model.mu + PICK_MARGIN }));
  return { ready: true, measured: measured.length, mu: model.mu, margin: PICK_MARGIN, learned, test: wf, upcoming, calibration: calibration(rows), updatedAt: new Date(nowMs).toISOString() };
}

async function getLearning(pool, nowMs = Date.now()) {
  const I = require('./italia');
  const { rows } = await pool.query(`SELECT id, event_id, phase, strategy, created_at, commence_time, selection, odd, edge_pct, clv_pct, fair_prob, result FROM italia_signals`);
  return buildLearning(I.primaryRows(rows), nowMs);
}

module.exports = { calibration, K, DAMP, MIN_TRAIN, PICK_MARGIN, FEATURES, fit, predict, walkForward, buildLearning, getLearning, band };
