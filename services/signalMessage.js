/** Messaggio Telegram con i nuovi segnali. Testo dei dati sempre "ripulito": un "&" in un nome di squadra non deve rompere il messaggio. */
const { LEAGUES } = require('./leagues');
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function when(iso) {
  return new Date(iso).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
}

function formatSignalsMessage(signals, { max = 10 } = {}) {
  const shown = signals.slice(0, max);
  const lines = [`🎯 <b>${signals.length} ${signals.length === 1 ? 'nuovo segnale' : 'nuovi segnali'}</b> (tracker, senza soldi veri)`, ''];
  for (const s of shown) {
    const pick = s.selection === 'home' ? s.home : s.selection === 'away' ? s.away : 'Pareggio';
    lines.push(`<b>${esc((LEAGUES[s.code] || {}).name || s.code)}</b>`);
    lines.push(`${esc(s.home)} – ${esc(s.away)}${s.kickoff ? ' · ' + esc(when(s.kickoff)) : ''}`);
    lines.push(`Punta su <b>${esc(pick)}</b> a <b>${Number(s.odd).toFixed(2)}</b> (${esc(s.bookmaker || 'n/d')}) · vantaggio ${s.edge >= 0 ? '+' : ''}${(s.edge * 100).toFixed(1)}%`);
    lines.push('');
  }
  if (signals.length > max) lines.push(`…e altri ${signals.length - max}: aprili nell'app.`, '');
  lines.push('Sono segnali di carta: servono a misurare la strategia, non a giocare.');
  return lines.join('\n');
}

module.exports = { formatSignalsMessage, esc };
