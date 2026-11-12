/**
 * 💳 CREDITI DI TUTTE LE PIATTAFORME (1° novembre 2026): quanto e' stato usato e quanto resta, con il ritmo per arrivare alla ricarica.
 *  - odss-api.com (quote italiane, strategia I/T/B): rimaste, usate oggi, budget giornaliero fino alla ricarica (il 12)
 *  - The Odds API (strategia A / Over-Under): rimaste nel mese, dall'ultimo giro
 *  - Highlightly (risultati): richieste di oggi sulle 100 gratuite (tetto del CRM: 80)
 *  - football-data.org (risultati dei campionati principali): letture di oggi
 *  - database Supabase: spazio usato sui 500 MB gratuiti
 * Livello per ognuna: ok / attenzione / problema.
 */
const MB = 1024 * 1024;

async function getCredits(pool, env = process.env, nowMs = Date.now()) {
  const out = [], q = async (sql, p) => (await pool.query(sql, p)).rows;
  const safe = async f => { try { await f(); } catch (e) { /* una fonte che manca non blocca le altre */ } };
  const I = require('./italia');

  await safe(async () => {
    const c = I.cfg(env);
    const rem = (await q(`SELECT quota_remaining FROM italia_requests WHERE quota_remaining IS NOT NULL ORDER BY id DESC LIMIT 1`))[0];
    const today = (await q(`SELECT COUNT(*)::int AS n FROM italia_requests WHERE at >= date_trunc('day', NOW())`))[0].n;
    const week = (await q(`SELECT COUNT(*)::int AS n FROM italia_requests WHERE at >= NOW() - INTERVAL '7 days'`))[0].n;
    const r = rem ? Number(rem.quota_remaining) : null, p = r !== null ? I.odssPace(r, today, c.resetDay, nowMs) : null;
    const plan = r !== null ? await I.planOf(pool, c, r, nowMs) : null;
    const avg = week / 7, enough = plan ? plan.everyMin <= 240 && plan.perDay * p.daysLeft <= r : null;
    out.push({ key: 'odss', name: 'odss-api.com (quote italiane)', remaining: r, unit: 'richieste', usedToday: today, perDay: p && p.perDay, avgPerDay: Math.round(avg * 10) / 10,
      resetAt: p && p.resetAt, daysLeft: p && p.daysLeft, plan,
      level: r === null ? 'info' : r <= plan.reserve ? 'bad' : enough === false ? 'warn' : 'ok',
      text: r === null ? 'Nessuna lettura ancora.' : I.resetProbe(nowMs, c.resetDay, today) ? `Oggi è il giorno della ricarica: il conto (${r}) è quello di ieri. Il primo giro di oggi legge i crediti nuovi.` : `${r} rimaste, ${p.daysLeft} giorni alla ricarica. Piano: ${plan.hours && plan.hours.length ? `scansioni alle ${plan.hours.join(', ')}${plan.ou ? ' (con Over/Under: 2 richieste ciascuna)' : ''}` : `scansione ogni ${plan.everyMin / 60} ore`} (${plan.scansPerDay} al giorno) + circa ${plan.closesPerDay} chiusure = ${plan.perDay} al giorno; ${plan.reserve} tenute da parte per le chiusure; alla ricarica ne restano circa ${plan.leftAtReset}. Oggi ${today}, media 7 giorni ${avg.toFixed(1)}.` });
  });

  await safe(async () => {
    const row = (await q(`SELECT run_at, log_text FROM run_logs WHERE log_text LIKE '%crediti usati nel mese%' ORDER BY run_at DESC LIMIT 1`))[0];
    const m = row && /crediti usati nel mese: (\d+), rimasti: (\d+)/.exec(row.log_text || '');
    let r = m ? Number(m[2]) : null;
    // l'ultimo giro e' di un mese passato: il 1° i crediti si sono ricaricati, il numero vecchio non vale piu'
    const stale = row && new Date(row.run_at).toISOString().slice(0, 7) !== new Date(nowMs).toISOString().slice(0, 7);
    if (stale) r = null;
    // dal 1° novembre i crediti vanno alle Over/Under di Pinnacle: il conto piu' recente arriva da li'
    try {
      const o = (await q(`SELECT remaining, at FROM ou_requests WHERE remaining IS NOT NULL ORDER BY id DESC LIMIT 1`))[0];
      if (o) {
        const today = (await q(`SELECT COUNT(*)::int AS n FROM ou_requests WHERE paid AND at >= date_trunc('day', NOW())`))[0].n;
        const b = require('./ouPinnacle').dailyBudget(Number(o.remaining), today, nowMs);
        out.push({ key: 'oddsapi', name: 'The Odds API (Over/Under di Pinnacle)', remaining: Number(o.remaining), unit: 'crediti', usedToday: today, perDay: b.perDay, lastAt: o.at,
          level: Number(o.remaining) <= 20 ? 'warn' : 'ok', text: `${o.remaining} crediti rimasti (si ricaricano il 1°): oggi ${today} su ${b.perDay} al giorno, 1 credito per campionato letto. Strategia A in archivio.` });
        return;
      }
    } catch (e) { /* tabella non ancora creata */ }
    out.push({ key: 'oddsapi', name: 'The Odds API (strategia A / Over-Under)', remaining: r, unit: 'crediti', lastAt: row ? row.run_at : null,
      level: r === null ? 'info' : r <= 50 ? 'bad' : r <= 120 ? 'warn' : 'ok',
      text: stale ? 'Ricaricati il 1° del mese (500): il nuovo conto compare al primo giro della strategia A.' : r === null ? (env.A_PAUSED === 'true' ? 'In pausa (A_PAUSED): nessun credito usato.' : 'Nessun giro registrato.') : `${r} crediti rimasti questo mese (si ricaricano il 1°).` });
  });

  await safe(async () => {
    if (!env.HIGHLIGHTLY_KEY) { out.push({ key: 'highlightly', name: 'Highlightly (risultati)', level: 'info', text: 'Chiave non impostata.' }); return; }
    const H = require('./highlightly'), used = await H.usedToday(pool);
    out.push({ key: 'highlightly', name: 'Highlightly (risultati)', usedToday: used, cap: H.DAILY_CAP, limit: 100, unit: 'richieste',
      level: used >= H.DAILY_CAP ? 'warn' : 'ok', text: `${used} richieste oggi su 100 gratuite (il CRM si ferma a ${H.DAILY_CAP}).` });
  });

  await safe(async () => {
    const n = (await q(`SELECT COUNT(*)::int AS n FROM results_requests WHERE COALESCE(src, 'af') = 'fd' AND at >= date_trunc('day', NOW())`))[0].n;
    out.push({ key: 'fd', name: 'football-data.org (risultati principali)', usedToday: n, level: 'ok', text: `${n} letture oggi (piano gratuito: 10 al minuto, nessun tetto giornaliero).` });
  });

  await safe(async () => {
    const size = Number((await q(`SELECT pg_database_size(current_database()) AS b`))[0].b), pct = 100 * size / (500 * MB);
    out.push({ key: 'db', name: 'Database Supabase', usedMb: Math.round(size / MB * 10) / 10, limitMb: 500, level: pct > 80 ? 'bad' : pct > 60 ? 'warn' : 'ok',
      text: `${(size / MB).toFixed(1)} MB usati su 500 gratuiti (${pct.toFixed(1)}%).` });
  });

  return { items: out, updatedAt: new Date(nowMs).toISOString() };
}

module.exports = { getCredits };
