/**
 * 🧠 CERVELLO (13 novembre 2026, tappa 1): divide i segnali I (prima apparizione, partite chiuse) in gruppi
 * (margine di Pinnacle, quota, vantaggio, anticipo, siti d'accordo, coppa, esito, giorno) e per ogni gruppo mostra
 * vinte contro attese, saldo/ROI sulla carta e valore contro la chiusura (CLV) con la forchetta.
 * SOLA LETTURA: non cambia nessuna regola. Serve a vedere dove si vince e dove si perde; le proposte arrivano nelle tappe dopo.
 * Prudenza: sotto MIN_N partite chiuse il gruppo e' "pochi dati" e non si giudica; il verdetto usa la fortuna normale (z) e il CLV.
 * "Fuori campione" = segnali dal 5 novembre in poi (dopo che le regole sono state scelte guardando i dati vecchi).
 */
const MIN_N = 30, Z_EDGE = 1.5, OOS_SINCE = '2026-11-05T00:00:00Z';

const band = (v, cuts, labels) => { if (v === null || v === undefined || !Number.isFinite(v)) return null; for (let i = 0; i < cuts.length; i++) if (v < cuts[i]) return labels[i]; return labels[cuts.length]; };

// dimensioni: ogni funzione restituisce l'etichetta del gruppo per quel segnale (o null se non si puo' dire)
const DIMENSIONS = [
  { key: 'margine', title: 'Margine di Pinnacle', note: 'più è basso, più il mercato è liquido', of: r => band(r.margin, [5, 6, 8, 10], ['sotto 5%', '5–6%', '6–8%', '8–10%', '10% e oltre']) },
  { key: 'quota', title: 'Quota', note: 'quote basse e alte a confronto', of: r => band(r.odd, [1.5, 2, 2.5, 3.5, 5], ['sotto 1,50', '1,50–2,00', '2,00–2,50', '2,50–3,50', '3,50–5,00', '5,00 e oltre']) },
  { key: 'vantaggio', title: 'Vantaggio dichiarato', note: 'vantaggio molto alto spesso è un errore di lettura', of: r => band(r.edge, [4, 8, 12], ['2–4%', '4–8%', '8–12%', 'oltre 12%']) },
  { key: 'anticipo', title: 'Anticipo sul calcio d\'inizio', of: r => band(r.leadH, [3, 12, 48], ['sotto 3 ore', '3–12 ore', '12–48 ore', 'oltre 48 ore']) },
  { key: 'siti', title: 'Siti con valore', note: 'quanti siti italiani offrono valore sullo stesso esito', of: r => r.sites === null ? null : (r.above <= 1 ? 'solo 1 sito' : r.above <= 3 ? '2–3 siti' : '4 o più siti') },
  { key: 'coppa', title: 'Coppa o campionato', of: r => (r.cup ? 'coppa' : 'campionato') },
  { key: 'esito', title: 'Esito', of: r => ({ home: '1 (casa)', draw: 'X (pareggio)', away: '2 (trasferta)' })[r.selection] || null },
  { key: 'giorno', title: 'Giorno della partita', of: r => (r.weekend ? 'sabato e domenica' : 'lunedì–venerdì') }
];

function normal(x) { return x === null || x === undefined ? null : Number(x); }

/** Una riga semplice per il calcolo, dai dati del segnale. Parte pura. */
function featuresOf(r, I) {
  let q = r.quotes; try { if (typeof q === 'string') q = JSON.parse(q); } catch (e) { q = null; }
  const cons = I.consensusOf(Number(r.odd), Number(r.fair_prob), r.selection, q);
  const ct = r.commence_time ? Date.parse(r.commence_time) : NaN, cr = r.created_at ? Date.parse(r.created_at) : NaN;
  const day = Number.isFinite(ct) ? new Date(ct + 3600000).getUTCDay() : null;   // giorno all'ora italiana (circa): 0 domenica, 6 sabato
  return {
    id: r.id, selection: r.selection, odd: Number(r.odd), edge: Number(r.edge_pct), margin: I.pinMarginPct(r),
    leadH: Number.isFinite(ct) && Number.isFinite(cr) ? (ct - cr) / 3600000 : null,
    sites: cons ? cons.sites : null, above: cons ? cons.above : null,
    cup: I.isCup(r.league), weekend: day === 0 || day === 6,
    p: Number(r.fair_prob) || 0, result: r.result, clv: normal(r.clv_pct), created: cr
  };
}

/** Numeri di un gruppo: vinte, attese, z, saldo con puntata fissa, CLV con forchetta, e la parte fuori campione. Parte pura. */
function summarize(rows, oosMs = Date.parse(OOS_SINCE), stake = 10) {
  const done = rows.filter(r => r.result === 'won' || r.result === 'lost');
  const calc = list => {
    const won = list.filter(r => r.result === 'won').length, exp = list.reduce((a, r) => a + r.p, 0);
    const sd = Math.sqrt(list.reduce((a, r) => a + r.p * (1 - r.p), 0));
    const pnl = list.reduce((a, r) => a + (r.result === 'won' ? (r.odd - 1) * stake : -stake), 0);
    return { settled: list.length, won, expected: exp, z: sd > 0 ? (won - exp) / sd : null, roiPct: list.length ? 100 * pnl / (stake * list.length) : null };
  };
  const cl = rows.map(r => r.clv).filter(v => v !== null && Number.isFinite(v));
  const n = cl.length, mean = n ? cl.reduce((a, b) => a + b, 0) / n : null;
  const sd = n > 1 ? Math.sqrt(cl.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  const ci = n >= 5 && sd !== null ? [mean - 1.96 * sd / Math.sqrt(n), mean + 1.96 * sd / Math.sqrt(n)] : null;
  const all = calc(done), oos = calc(done.filter(r => r.created >= oosMs));
  return { ...all, measured: n, avgClvPct: mean, clvCi95: ci, oos: { settled: oos.settled, won: oos.won, expected: oos.expected, roiPct: oos.roiPct }, verdict: verdictOf({ ...all, measured: n, clvCi95: ci, avgClvPct: mean }) };
}

/** Verdetto prudente. Il valore contro la chiusura da solo inganna (nei mercati sottili e' positivo quasi ovunque), quindi:
 *  'forte' = valore sicuramente positivo E vinte non sotto le attese E saldo positivo; 'debole' = valore sicuramente negativo,
 *  oppure vinte molto sotto le attese (z da -1,5) con saldo negativo; 'pochi' sotto MIN_N; altrimenti 'norma'. */
function verdictOf(s) {
  if (!s || s.settled < MIN_N) return 'pochi';
  const clvUp = !!(s.clvCi95 && s.clvCi95[0] > 0), clvDown = !!(s.clvCi95 && s.clvCi95[1] < 0);
  const up = clvUp && s.z !== null && s.z >= 0 && s.roiPct > 0;
  const down = clvDown || (s.z !== null && s.z <= -Z_EDGE && s.roiPct < 0);
  if (up && !down) return 'forte';
  if (down && !up) return 'debole';
  return 'norma';
}

/** Tutta la tabella. Parte pura: riceve i segnali I gia' ridotti alla prima apparizione. */
function buildBrain(rows, I, { nowMs = Date.now() } = {}) {
  const feats = rows.filter(r => r.result !== 'void').map(r => featuresOf(r, I));
  const dims = DIMENSIONS.map(d => {
    const groups = new Map();
    for (const f of feats) { const lab = d.of(f); if (lab === null) continue; if (!groups.has(lab)) groups.set(lab, []); groups.get(lab).push(f); }
    const order = new Map();   // l'ordine delle fasce come dichiarate
    const labels = ['sotto 5%', '5–6%', '6–8%', '8–10%', '10% e oltre', 'sotto 1,50', '1,50–2,00', '2,00–2,50', '2,50–3,50', '3,50–5,00', '5,00 e oltre', '2–4%', '4–8%', '8–12%', 'oltre 12%', 'sotto 3 ore', '3–12 ore', '12–48 ore', 'oltre 48 ore', 'solo 1 sito', '2–3 siti', '4 o più siti', 'campionato', 'coppa', '1 (casa)', 'X (pareggio)', '2 (trasferta)', 'lunedì–venerdì', 'sabato e domenica'];
    labels.forEach((l, i) => order.set(l, i));
    return { key: d.key, title: d.title, note: d.note || null,
      groups: [...groups.entries()].map(([name, list]) => ({ name, ...summarize(list) })).sort((a, b) => (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99)) };
  });
  const total = summarize(feats);
  return { rules: { minN: MIN_N, zEdge: Z_EDGE, oosSince: OOS_SINCE }, total, dimensions: dims, updatedAt: new Date(nowMs).toISOString() };
}

async function getBrain(pool, { nowMs = Date.now() } = {}) {
  const I = require('./italia');
  const all = (await pool.query(`SELECT * FROM italia_signals WHERE strategy = 'I' ORDER BY created_at`)).rows;
  return buildBrain(I.primaryRows(all), I, { nowMs });
}

module.exports = { MIN_N, DIMENSIONS, featuresOf, summarize, verdictOf, buildBrain, getBrain };
