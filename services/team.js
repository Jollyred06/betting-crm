/**
 * 🦸 LA PAGELLA DELLA SQUADRA (4 novembre 2026): il CRM giudica da solo ogni strategia con regole fissate prima,
 * su TUTTI i risultati che ha (le regole applicate anche all'indietro), e PROPONE chi mettere in campo (tra le ⭐) e chi togliere.
 * Niente cambia da solo: Christian approva con un tocco. Al massimo un cambiamento ogni 7 giorni (i freni).
 *
 *  🟢 in forma:  almeno 40 segnali con chiusura, valore contro la chiusura sicuramente positivo (forchetta sopra lo zero),
 *               vinte non sotto le attese oltre la normale sfortuna (z sopra -1,5) e saldo sulla carta non negativo
 *  🔴 fuori forma: almeno 40 segnali e valore medio negativo, oppure vinte molto sotto le attese (z sotto -2,5)
 *  🟡 da vedere:  tutto il resto (pochi dati o numeri incerti)
 * Quote fino al massimo della lista (3,50) e niente coppe, come le ⭐.
 */
const MIN_N = 40, Z_OK = -1.5, Z_BAD = -2.5, BRAKE_DAYS = 7;

// chi c'e' in squadra: kind 'star' = le sue partite diventano ⭐ quando e' in campo; 'filter' = una regola che toglie partite
const MEMBERS = [
  { key: 'oceani', what: '🏆 formazione titolare: liquide, vantaggio dal 2%, quota 2,00–3,50, appena compare', kind: 'star', on: true },
  { key: 'fascia', what: '✅ consigliate', kind: 'star', on: false },
  { key: 'oceano', what: '💧 liquide (ultime 3 ore)', kind: 'star', on: false },
  { key: 'coro', what: '👥 F2+ con 4+ siti d\'accordo', kind: 'star', on: false },
  { key: 'saracinesca', what: '🔒 7 su 10', kind: 'star', on: false },
  { key: 'liquidi8', what: '💧 F2+ nei mercati con margine sotto l\'8%', kind: 'star', on: false },
  { key: 'flash', what: '💧 liquide prese in anticipo (oltre 3 ore prima)', kind: 'star', on: false },
  { key: 'strange', what: '⚖️ il pareggio (X dal 2%)', kind: 'star', on: false },
  { key: 'quicksilver', what: '⚡ Pinnacle si muove a favore e il sito italiano e\' ancora indietro (liquide, dal 2%, quota 1,60–3,50). Misurata dall\'8 novembre', kind: 'star', on: false },
  { key: 'prova', what: '🧪 Prova (solo simulata): liquide dal 2%, quota 2,00–4,00, fuori dalle Justice League (coppe e quote 3,50–4,00). Dal 10 novembre', kind: 'star', on: true },
  { key: 'wolverine', what: '🧓 la veterana F (2–6%, quote 1,60–3,50) fuori dai mercati liquidi', kind: 'star', on: false },
  { key: 'muro', what: '🏠 niente trasferte nei minori', kind: 'filter', on: true }
];

// ------------------------------------------------------------------------------------------- parte pura (testata)
function grade(st) {
  const n = st.measured || 0, ci = st.clvCi95, z = st.z;
  if (n >= MIN_N && ((st.avgClvPct !== null && st.avgClvPct < 0) || (z !== null && z < Z_BAD))) return 'red';
  // 5 novembre 2026: per essere 🟢 deve anche NON perdere soldi (nei campionati minori il valore contro Pinnacle puo' illudere)
  if (n >= MIN_N && ci && ci[0] > 0 && (z === null || z > Z_OK) && !(st.pnlEur < 0)) return 'green';
  return 'yellow';
}
/** Proposta per un membro: per le strategie, in campo se 🟢 e fuori se 🔴; per i filtri il gruppo misurato e' quello ESCLUSO:
 *  se le escluse vanno bene (🟢) si propone di togliere il filtro, se vanno male (🔴) di tenerlo. */
function propose(m, g, on) {
  if (m.kind === 'star') { if (!on && g === 'green') return 'on'; if (on && g === 'red') return 'off'; return null; }
  if (on && g === 'green') return 'off';
  if (!on && g === 'red') return 'on';
  return null;
}
function zOf(rows) {
  const done = rows.filter(r => r.result === 'won' || r.result === 'lost');
  const won = done.filter(r => r.result === 'won').length, exp = done.reduce((a, r) => a + Number(r.fair_prob || 0), 0);
  const sd = Math.sqrt(done.reduce((a, r) => { const p = Number(r.fair_prob || 0); return a + p * (1 - p); }, 0));
  return { settled: done.length, won, expected: exp, z: sd > 0 ? (won - exp) / sd : null };
}

// ------------------------------------------------------------------------------------------- database
let ready = false;
async function ensureTeam(pool) {
  if (ready) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS team_state (key TEXT PRIMARY KEY, is_on BOOLEAN NOT NULL, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), note TEXT)`);
  ready = true;
}
/** Chi e' in campo adesso: { key: true/false } (con i valori iniziali per chi non e' mai stato cambiato). */
async function stateOf(pool) {
  await ensureTeam(pool);
  const rows = (await pool.query(`SELECT key, is_on, changed_at, note FROM team_state`)).rows;
  const out = {}, last = rows.reduce((m, r) => (!m || r.changed_at > m ? r.changed_at : m), null);
  for (const m of MEMBERS) { const r = rows.find(x => x.key === m.key); out[m.key] = r ? r.is_on : m.on; }
  return { on: out, lastChange: last, history: rows.sort((a, b) => (a.changed_at < b.changed_at ? 1 : -1)) };
}

async function getTeam(pool, { nowMs = Date.now() } = {}) {
  const I = require('./italia'), R = require('./results');
  const st = await stateOf(pool);
  const all = (await pool.query(`SELECT * FROM italia_signals WHERE strategy = 'I' ORDER BY created_at`)).rows;
  // quote degli altri siti (strategia T, stessa lettura) per il consenso
  const tq = new Map();
  for (const t of (await pool.query(`SELECT event_id, quotes FROM italia_signals WHERE strategy = 'T' AND quotes IS NOT NULL ORDER BY created_at`)).rows) {
    let q = t.quotes; try { if (typeof q === 'string') q = JSON.parse(q); } catch (e) { q = null; }
    if (q) tq.set(t.event_id, { ...(tq.get(t.event_id) || {}), ...q });
  }
  const consOf = r => { let q = r.quotes; try { if (typeof q === 'string') q = JSON.parse(q); } catch (e) { q = null; } return I.consensusOf(Number(r.odd), Number(r.fair_prob), r.selection, { ...(tq.get(r.event_id) || {}), ...(q || {}) }); };
  const maxOdd = I.budgetCfg().maxOdd;
  const base = r => !I.isCup(r.league) && Number(r.odd) <= maxOdd;
  const mk = (f, o) => { const m = f(all, o); return r => !!(m.get(r.id) || {}).final; };
  const f6 = mk(I.markFinal6, { ignoreSince: true }), f4 = mk(I.markFinal4, { ignoreSince: true }), lq = mk(I.markLiquid, { ignoreSince: true });
  const f8 = mk(I.markFinal8, { ignoreSince: true }), f9 = mk(I.markFinal9, { ignoreSince: true });
  const qsMap = I.markQuick(all, await I.pinHistory(pool)), qs = r => !!(qsMap.get(r.id) || {}).final;
  const oc = mk(I.markOceani), fl = mk(I.markLiquidEarly), dr = mk(I.markDraw), fF = (() => { const m = I.markFinal(I.primaryRows(all)); return r => !!(m.get(r.id) || {}).final; })();
  const pv = I.markProva(all);
  const sets = {
    fascia: all.filter(r => base(r) && f6(r) && !I.isAwayThin(r)),
    oceano: all.filter(r => base(r) && lq(r)),
    coro: all.filter(r => base(r) && f4(r) && ((consOf(r) || {}).above || 0) >= 4),
    saracinesca: all.filter(r => base(r) && f8(r)),
    liquidi8: all.filter(r => base(r) && f9(r)),
    oceani: all.filter(r => oc(r)),
    flash: all.filter(r => base(r) && fl(r)),
    strange: all.filter(r => base(r) && dr(r)),
    // solo quello che AGGIUNGE: le F fuori dai mercati liquidi (quelle liquide le gioca gia' Aquaman)
    quicksilver: all.filter(r => qs(r)),
    prova: all.filter(r => I.isProva(r) && !!(pv.get(r.id) || {}).final),
    wolverine: I.primaryRows(all).filter(r => base(r) && fF(r) && !((I.pinMarginPct(r) ?? 99) < 6)),
    muro: all.filter(r => base(r) && f6(r) && I.isAwayThin(r))   // le ESCLUSE dal filtro
  };
  const brakeUntil = st.lastChange ? new Date(Date.parse(st.lastChange) + BRAKE_DAYS * 86400000) : null;
  const members = MEMBERS.map(m => {
    const rows = sets[m.key], s = I.oddsStats(rows), z = zOf(rows), res = R.resultStats(rows);
    const g = grade({ ...s, z: z.z, pnlEur: res.pnlEur }), on = st.on[m.key];
    return { key: m.key, what: m.what, kind: m.kind, on, grade: g, proposal: propose(m, g, on),
      signals: rows.length, measured: s.measured, avgClvPct: s.avgClvPct, clvCi95: s.clvCi95, positivePct: s.positivePct,
      settled: z.settled, won: z.won, expected: z.expected, z: z.z, pnlEur: res.pnlEur };
  });
  return { rules: { minN: MIN_N, zOk: Z_OK, zBad: Z_BAD, brakeDays: BRAKE_DAYS }, members, lastChange: st.lastChange,
    brakeUntil: brakeUntil && brakeUntil.getTime() > nowMs ? brakeUntil.toISOString() : null, history: st.history.slice(0, 10), updatedAt: new Date(nowMs).toISOString() };
}

/** Approvazione di Christian: mette in campo o toglie un membro. Rispetta il freno (un cambiamento ogni 7 giorni). */
async function setMember(pool, key, isOn, { nowMs = Date.now(), note = null } = {}) {
  const m = MEMBERS.find(x => x.key === key);
  if (!m) { const e = new Error('Strategia sconosciuta.'); e.status = 404; throw e; }
  const st = await stateOf(pool);
  if (st.on[key] === !!isOn) return { unchanged: true };
  if (st.lastChange && nowMs - Date.parse(st.lastChange) < BRAKE_DAYS * 86400000) {
    const e = new Error(`Freno: un cambiamento ogni ${BRAKE_DAYS} giorni. Il prossimo dal ${new Date(Date.parse(st.lastChange) + BRAKE_DAYS * 86400000).toLocaleDateString('it-IT')}.`); e.status = 409; throw e;
  }
  await pool.query(`INSERT INTO team_state (key, is_on, changed_at, note) VALUES ($1, $2, NOW(), $3) ON CONFLICT (key) DO UPDATE SET is_on = $2, changed_at = NOW(), note = $3`, [key, !!isOn, note]);
  return { key, on: !!isOn };
}

module.exports = { MEMBERS, MIN_N, grade, propose, zOf, ensureTeam, stateOf, getTeam, setMember };
