/**
 * Memoria dei calcoli pesanti (16 novembre 2026). Il primo /italia dopo un riavvio impiegava 40 secondi perche' ricostruiva
 * forza delle squadre e taratura su 120.000 partite; e le rileggeva dal database ogni 10-30 minuti (traffico Supabase).
 * Ora: si calcola una volta (all'avvio e dopo l'aggiornamento dello storico), si tiene 24 ore, e chi non puo' aspettare
 * (la pagina dei segnali) prende quello che c'e' senza bloccarsi: se il calcolo non e' pronto, va avanti senza.
 */
function memo(build, ttlMs) {
  let cache = null, building = null;
  const start = pool => {
    if (!building) building = Promise.resolve().then(() => build(pool)).then(v => { cache = { at: Date.now(), val: v }; return v; }).finally(() => { building = null; });
    return building;
  };
  return {
    /** Aspetta il risultato (per le pagine di Analisi). */
    async get(pool) { if (cache && Date.now() - cache.at < ttlMs) return cache.val; if (cache) { start(pool).catch(() => {}); return cache.val; } return start(pool); },
    /** Non aspetta mai: il valore in memoria (anche vecchio) oppure null, e intanto prepara quello nuovo. */
    peek(pool) { if (!cache || Date.now() - cache.at >= ttlMs) start(pool).catch(() => {}); return cache ? cache.val : null; },
    invalidate() { cache = null; },
    get ready() { return !!cache; }
  };
}
module.exports = { memo };
