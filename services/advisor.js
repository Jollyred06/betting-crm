/**
 * Il Consigliere: legge i risultati di tutte le strategie e scrive pochi consigli in italiano semplice.
 * Gratuito e senza servizi esterni: sono regole statistiche, non un modello che "indovina".
 * Regola d'oro: niente consigli su campioni piccoli (sotto MIN_N segnali misurati scrive "pochi dati").
 * Il metro e' sempre il valore contro la chiusura di Pinnacle (CLV), non le partite vinte.
 */
const MIN_N = 20;          // segnali misurati prima di dare un giudizio su una strategia
const MIN_GROUP = 15;      // segnali misurati prima di confrontare bookmaker o fasce di quota
const BAD_BOOKS = new Set(['LeoVegas (SE)', 'Coolbet', 'GTbets', 'Betsson']);

function summary(values) {
  const v = values.map(Number).filter(Number.isFinite);
  const n = v.length;
  if (!n) return { n: 0, mean: null, lo: null, hi: null, pos: null };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const h = n > 1 ? 1.96 * sd / Math.sqrt(n) : null;
  return { n, mean, lo: h === null ? null : mean - h, hi: h === null ? null : mean + h, pos: 100 * v.filter(x => x > 0).length / n };
}

const f1 = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1).replace('.', ',') + '%';
const f0 = v => Math.round(v) + '%';

/** Giudizio su una strategia: buona solo se tutta la fascia di incertezza sta sopra zero. */
function judge(name, s, extra = '') {
  if (s.n < MIN_N) return { level: 'info', key: name, title: `${name}: pochi dati`, text: `${s.n} segnali misurati su ${MIN_N} necessari per un giudizio. Continua a raccogliere.${extra}` };
  const range = `da ${f1(s.lo)} a ${f1(s.hi)}`;
  if (s.lo > 0) return { level: 'good', key: name, title: `${name} batte il mercato`, text: `Valore contro la chiusura ${f1(s.mean)} (${range}), ${f0(s.pos)} dei segnali sopra la chiusura, su ${s.n} misurati.${extra}` };
  if (s.hi < 0) return { level: 'bad', key: name, title: `${name} non batte il mercato`, text: `Valore contro la chiusura ${f1(s.mean)} (${range}) su ${s.n} segnali: conviene spegnerla o cambiarne le regole.${extra}` };
  return { level: 'info', key: name, title: `${name}: risultato incerto`, text: `Valore contro la chiusura ${f1(s.mean)} (${range}) su ${s.n} segnali: la fascia comprende lo zero, servono altri dati.${extra}` };
}

/** Confronto tra gruppi (bookmaker, fasce di quota): solo gruppi con abbastanza casi. */
function bestWorst(groups) {
  const ok = groups.filter(g => g.s.n >= MIN_GROUP).sort((a, b) => b.s.mean - a.s.mean);
  return ok.length >= 2 ? { best: ok[0], worst: ok[ok.length - 1] } : null;
}

/**
 * Costruisce i consigli a partire dalle righe gia' lette (funzione pura, testabile).
 * a: segnali A chiusi con clv; it: righe italia_signals (strategy I e B).
 */
function buildAdvice({ a = [], it = [], final = [], final2 = [], final3 = [] } = {}) {
  const out = [];
  const iRows = it.filter(r => (r.strategy || 'I') === 'I'), bRows = it.filter(r => r.strategy === 'B');
  const clv = rows => rows.map(r => r.clv_pct).filter(v => v !== null && v !== undefined && v !== '');

  const sI = summary(clv(iRows)), sB = summary(clv(bRows)), sA = summary(clv(a)), sF = summary(clv(final));
  const nw = summary(iRows.map(r => r.netwin_clv_pct).filter(v => v !== null && v !== undefined && v !== ''));

  // 1) La cosa piu' importante: si puo' giocare? Decide la selezione F (regole fissate prima), se ha abbastanza dati.
  if (sF.n >= MIN_N && sF.lo > 0) out.push({ level: 'good', key: 'azione', title: 'Si può valutare di giocare i segnali ✅ F, con puntate piccole', text: `La selezione F batte la chiusura (${f1(sF.mean)} su ${sF.n}, ${f0(sF.pos)} sopra). Gioca solo i segnali con ✅ F, a puntata fissa piccola, e solo se la quota sul sito è almeno quella minima.` });
  else if (sF.n >= MIN_N && sF.hi < 0) out.push({ level: 'bad', key: 'azione', title: 'Non giocare: la selezione F non regge', text: `Selezione F ${f1(sF.mean)} su ${sF.n} segnali. Rivediamo le condizioni prima di rischiare.` });
  else if (sI.n >= MIN_N && sI.lo > 0) out.push({ level: 'good', key: 'azione', title: 'Si può valutare di giocare, con puntate piccole', text: `I segnali sui bookmaker italiani battono la chiusura (${f1(sI.mean)} su ${sI.n}). Parti con puntate fisse piccole e gioca solo se la quota sul sito è almeno quella minima.` });
  else if (sI.n >= MIN_N && sI.hi < 0) out.push({ level: 'bad', key: 'azione', title: 'Non giocare soldi veri', text: `I segnali sui bookmaker italiani non battono la chiusura (${f1(sI.mean)} su ${sI.n}). Cambiamo regole prima di rischiare.` });
  else if (sI.n >= MIN_N) out.push({ level: 'info', key: 'azione', title: 'Per ora non giocare soldi veri', text: `I bookmaker italiani sono in positivo (${f1(sI.mean)} su ${sI.n} segnali) ma il risultato è ancora incerto. Servono più dati: il CRM raccoglie da solo, tu non devi fare niente.` });
  else out.push({ level: 'info', key: 'azione', title: 'Per ora non giocare soldi veri', text: `La prova sui bookmaker italiani è ancora in corso: ${sI.n} segnali misurati su ${MIN_N}. Il CRM raccoglie da solo, tu non devi fare niente.` });

  // 2) Le strategie
  out.push(judge('Selezione F (finale candidata)', sF, ' Regole fissate il 17 ottobre, misurate solo sui segnali successivi.'));
  out.push(judge('Selezione F2 (seconda candidata)', summary(clv(final2)), ' Entro 3 ore, vantaggio 4–8%: regole fissate il 18 ottobre.'));
  out.push(judge('Selezione F3 (favoriti con valore)', summary(clv(final3)), ' Quote 1,30–1,60: si vince 6–7 volte su 10. Regole fissate il 18 ottobre sera.'));
  out.push(judge('Strategia I (libri italiani)', sI));
  out.push(judge('Strategia B (selezione B, libri esteri)', sB, ' È la prova delle regole B su partite nuove.'));
  if (sA.n) out.push(judge('Strategia A (test di ottobre)', sA, ' Libri esteri: misura il metodo, non si gioca dall\'Italia.'));

  // 3) Bookmaker italiani: dove aprire il conto
  const books = [...new Set(iRows.map(r => r.book))].map(b => ({ name: b, s: summary(clv(iRows.filter(r => r.book === b))) }));
  const bw = bestWorst(books);
  if (bw) out.push({ level: bw.best.s.mean > 0 ? 'good' : 'info', key: 'libri', title: `Bookmaker migliore: ${bw.best.name}`, text: `${bw.best.name} ${f1(bw.best.s.mean)} su ${bw.best.s.n} segnali; il peggiore è ${bw.worst.name} (${f1(bw.worst.s.mean)} su ${bw.worst.s.n}).` });

  // 4) Netwin da solo: tolto dal Consigliere (non si gioca su Netwin; il dato resta nel backup)

  // 5) Fascia di quota consigliata (1,60-2,60)
  const band = r => Number(r.odd) >= 1.6 && Number(r.odd) <= 2.6;
  const inB = summary(clv(iRows.filter(band))), outB = summary(clv(iRows.filter(r => !band(r))));
  if (inB.n >= MIN_GROUP && outB.n >= MIN_GROUP) {
    const better = inB.mean >= outB.mean;
    out.push({ level: better ? 'good' : 'info', key: 'fascia', title: better ? 'Tieni la fascia ⭐ 1,60–2,60' : 'La fascia ⭐ non fa meglio', text: `Quote 1,60–2,60: ${f1(inB.mean)} su ${inB.n}; le altre: ${f1(outB.mean)} su ${outB.n}.${better ? ' Vinci più spesso a parità di valore.' : ''}` });
  }

  // 6) Esiti (1, X, 2)
  const sels = ['home', 'draw', 'away'].map(k => ({ name: { home: 'Segno 1', draw: 'Pareggio', away: 'Segno 2' }[k], s: summary(clv(iRows.filter(r => r.selection === k))) }));
  const sw = bestWorst(sels);
  if (sw && sw.best.s.mean - sw.worst.s.mean > 2) out.push({ level: 'info', key: 'esiti', title: `Meglio ${sw.best.name.toLowerCase()}`, text: `${sw.best.name} ${f1(sw.best.s.mean)} su ${sw.best.s.n}; ${sw.worst.name.toLowerCase()} ${f1(sw.worst.s.mean)} su ${sw.worst.s.n}.` });

  return out;
}

async function getAdvice(pool) {
  let a = [], it = [];
  try {
    a = (await pool.query(`SELECT clv_pct, COALESCE(presa_book, bookmaker_name) AS book FROM value_bets WHERE strategy = 'A_sharp' AND status IN ('won','lost') AND clv_pct IS NOT NULL`)).rows;
  } catch (e) { /* tabella o colonne mancanti: niente consigli su A */ }
  try {
    it = (await pool.query(`SELECT id, created_at, commence_time, close_captured_at, edge_pct, strategy, book, odd, selection, clv_pct, netwin_clv_pct FROM italia_signals`)).rows;
  } catch (e) { /* strategia I non ancora attiva */ }
  // nomi leggibili dei libri della I (stessi dell'app) e selezione F
  const { BOOK_NAMES: names, markFinal, markFinal2, markFinal3 } = require('./italia');
  const iOnly = it.filter(r => (r.strategy || 'I') === 'I'), fin = markFinal(iOnly), fin2 = markFinal2(iOnly);
  const final = iOnly.filter(r => fin.get(r.id) && fin.get(r.id).final);
  const final2 = iOnly.filter(r => fin2.get(r.id) && fin2.get(r.id).final);
  const fin3 = markFinal3(iOnly), final3 = iOnly.filter(r => fin3.get(r.id) && fin3.get(r.id).final);
  it = it.map(r => ({ ...r, book: names[r.book] || r.book }));
  return { advice: buildAdvice({ a, it, final, final2, final3 }), minN: MIN_N, updatedAt: new Date().toISOString() };
}

module.exports = { buildAdvice, getAdvice, summary, MIN_N, MIN_GROUP, BAD_BOOKS };
