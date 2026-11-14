#!/usr/bin/env node
/**
 * Controllo di salute (14 novembre 2026): legge in sola lettura le pagine pubbliche del CRM e, se qualcosa non va,
 * esce con errore. GitHub Actions in quel caso manda da solo un'email: cosi' un problema (server giu', crediti finiti,
 * scansione ferma) non resta nascosto finche' non apri l'app. Nessuna chiave.
 */
const BASE = process.env.CRM_URL || 'https://betting-crm.onrender.com';
const romeHour = ms => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date(ms)));

/** Parte pura (testata): restituisce l'elenco dei problemi. */
function evaluate({ status, credits, advice, italia } = {}, nowMs = Date.now()) {
  const out = [];
  if (!status || status.status !== 'ok') return ['Il CRM non risponde o non e\' attivo'];
  for (const c of (credits && credits.items) || []) if (c.level === 'bad') out.push(`Crediti: ${c.name}: ${String(c.text || '').slice(0, 160)}`);
  for (const a of ((advice && advice.advice) || []).filter(x => x.level === 'bad').slice(0, 2)) out.push(`Consigliere: ${a.title}`);
  const last = italia && italia.lastRequest;
  const h = romeHour(nowMs);
  if (last && last.at && h >= 12 && h <= 22) {
    const ageH = (nowMs - Date.parse(last.at)) / 3600000;
    if (ageH > 5) out.push(`Nessuna scansione da ${Math.round(ageH)} ore (ultima: ${last.at})`);
  }
  if (last && last.ok === false) out.push(`L'ultima lettura delle quote e' fallita${last.note ? ': ' + String(last.note).slice(0, 120) : ''}`);
  return out;
}

async function get(path, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(BASE + path, { signal: AbortSignal.timeout(60000) }); if (r.ok) return await r.json(); } catch (e) { /* riprova: Render puo' dormire */ }
    await new Promise(r => setTimeout(r, 15000));
  }
  return null;
}

async function main() {
  const status = await get('/api/status');
  if (!status) { console.error('Il CRM non risponde dopo 4 tentativi'); process.exit(1); }
  const [credits, advice, italia] = await Promise.all([get('/api/tracker/credits'), get('/api/tracker/advice'), get('/api/tracker/italia')]);
  const problems = evaluate({ status, credits, advice, italia });
  if (problems.length) { console.error('PROBLEMI:\n- ' + problems.join('\n- ')); process.exit(1); }
  console.log('Tutto ok');
}

module.exports = { evaluate };
if (require.main === module) main();
