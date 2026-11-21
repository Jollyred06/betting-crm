/**
 * 🏦 CASSE PER SITO (21 novembre 2026, chiesto da Christian). Quanti soldi ci sono adesso su Goldbet, 888sport ed Eurobet.
 * Christian scrive il saldo che vede sul sito (la prima volta, o quando vuole correggere); da li' il CRM aggiorna da solo con
 * le giocate fatte su quel sito: ⭐ e svago (played_bets) e scalata (scalata_picks, al sito indicato). Kelly e scalata NON
 * cambiano: e' solo il conto per sito, con l'avviso se la puntata non ci sta. Ogni saldo scritto resta in archivio.
 */
const T = x => new Date(x).getTime();
const norm = b => { const k = String(b || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return k === '888sportit' ? '888sport' : k; };
const NAMES = { goldbet: 'Goldbet', '888sport': '888sport', eurobet: 'Eurobet', snai: 'Snai', netwin: 'Netwin', sisal: 'Sisal' };
const myBooks = () => [...new Set((process.env.MY_BOOKS || '888sport_it,eurobet,goldbet').split(',').map(s => norm(s.trim())).filter(Boolean))];
const SETTLE_MS = 2 * 3600000;   // una partita si considera chiusa ~2 ore dopo l'inizio

/** Parte pura. bets: { book, stake, odd, result ('won'|'lost'|'void'|null), placedAt, kickoff }; set: { saldo, at }.
 *  Il saldo scritto comprende gia' le giocate fatte prima; dopo: -puntata quando si gioca, +vincita (o +puntata se annullata) a fine partita. */
function balanceOf(set, bets, nowMs = Date.now()) {
  const at = T(set.at); let saldo = Number(set.saldo), open = 0, n = 0, pnl = 0;
  for (const b of bets) {
    const stake = Number(b.stake) || 0, odd = Number(b.odd) || 0, placed = T(b.placedAt), done = b.result === 'won' || b.result === 'lost' || b.result === 'void';
    const settledAt = done ? Math.min(nowMs, T(b.kickoff) + SETTLE_MS) : Infinity;
    const pay = b.result === 'won' ? stake * odd : b.result === 'void' ? stake : 0;
    if (placed > at) { saldo -= stake; n++; if (done) { saldo += pay; pnl += pay - stake; } else open += stake; }
    else if (done && settledAt > at) saldo += pay;                     // giocata prima, chiusa dopo: arriva la vincita
    else if (!done) open += stake;                                      // giocata prima, ancora aperta: soldi in gioco
  }
  return { saldo: Math.round(saldo * 100) / 100, open: Math.round(open * 100) / 100, since: set.at, start: Number(set.saldo), bets: n, pnl: Math.round(pnl * 100) / 100 };
}

async function loadSets(pool) { try { return (await require('./calib').loadState(pool, 'book_cash')) || { books: {}, log: [] }; } catch (e) { return { books: {}, log: [] }; } }

async function betsOf(pool) {
  const out = [];
  try {
    const P = await require('./played').getPlayed(pool);
    for (const x of P.items || []) out.push({ book: norm(x.book), stake: x.stake, odd: x.odd, result: x.result, placedAt: x.at, kickoff: x.commence_time, kind: 'giocata' });
  } catch (e) { /* facoltativo */ }
  try {
    const S = require('./scalata'), rows = (await pool.query(`SELECT id, day, commence_time, book, odd, result FROM scalata_picks ORDER BY commence_time, id`)).rows;
    const C = await S.getScalataCassa(pool), L = S.ladder(rows, { ...(C || {}), keepAll: true });
    for (const x of L.steps || []) out.push({ book: norm(x.book), stake: x.stake, odd: x.odd, result: x.open ? null : x.result, placedAt: T(x.commence_time) - 30 * 60000, kickoff: x.commence_time, kind: 'scalata' });
  } catch (e) { /* facoltativo */ }
  return out;
}

async function getBookCash(pool, { nowMs = Date.now() } = {}) {
  const st = await loadSets(pool), bets = await betsOf(pool);
  const books = myBooks().map(k => {
    const set = st.books[k], mine = bets.filter(b => b.book === k);
    return { key: k, name: NAMES[k] || k, ...(set ? balanceOf(set, mine, nowMs) : { saldo: null, open: mine.filter(b => !b.result).reduce((a, b) => a + Number(b.stake || 0), 0) }) };
  });
  const known = books.filter(b => b.saldo !== null);
  return { books, total: known.length ? Math.round(known.reduce((a, b) => a + b.saldo, 0) * 100) / 100 : null };
}

async function setBookCash(pool, book, saldo) {
  const k = norm(book), v = Number(String(saldo).replace(',', '.'));
  if (!myBooks().includes(k)) { const e = new Error('Sito non tra i tuoi (MY_BOOKS)'); e.status = 400; throw e; }
  if (!(v >= 0) || v > 100000) { const e = new Error('Scrivi il saldo in euro, per esempio 100'); e.status = 400; throw e; }
  const C = require('./calib'); await C.ensureCalib(pool);
  const st = await loadSets(pool), at = new Date().toISOString();
  st.books[k] = { saldo: v, at }; st.log = [...(st.log || []), { book: k, saldo: v, at }].slice(-500);   // archivio: ogni saldo scritto
  await C.saveState(pool, 'book_cash', st);
  return { book: k, saldo: v, at };
}

module.exports = { norm, balanceOf, getBookCash, setBookCash, myBooks };
