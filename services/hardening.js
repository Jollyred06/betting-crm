/**
 * Difese semplici del server (14 novembre 2026): intestazioni di sicurezza, freno ai tentativi ripetuti sulle azioni
 * (scrittura) e rete di sicurezza contro gli errori non gestiti. Niente dipendenze nuove.
 */
function securityHeaders(req, res, next) {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
  next();
}

/** Freno per le richieste che cambiano qualcosa (POST/DELETE): al massimo `max` al minuto per indirizzo. Le letture non sono toccate. */
function writeLimiter({ max = 60, windowMs = 60000, now = () => Date.now() } = {}) {
  const hits = new Map();
  return function limiter(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const t = now(), ip = req.ip || (req.socket && req.socket.remoteAddress) || '?';
    const h = (hits.get(ip) || []).filter(x => t - x < windowMs);
    if (h.length >= max) { res.set('Retry-After', String(Math.ceil(windowMs / 1000))); return res.status(429).json({ error: 'Troppe richieste: riprova fra un minuto' }); }
    h.push(t); hits.set(ip, h);
    if (hits.size > 1000) for (const [k, v] of hits) if (!v.some(x => t - x < windowMs)) hits.delete(k);   // pulizia
    next();
  };
}

/** Un errore non gestito non deve spegnere il server (Render lo riavvierebbe perdendo la cache e i lavori in corso): si scrive nel log e si va avanti. */
function installProcessGuards(proc = process, log = console) {
  proc.on('unhandledRejection', e => log.error('Errore non gestito (promessa):', e && e.message ? e.message : e));
  proc.on('uncaughtException', e => log.error('Errore non gestito:', e && e.message ? e.message : e));
}

module.exports = { securityHeaders, writeLimiter, installProcessGuards };
