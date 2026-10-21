/**
 * Sicurezza Supabase: attiva la "sicurezza a livello di riga" (RLS) su tutte le tabelle del CRM nello schema public.
 * Senza RLS, chi conosce l'indirizzo del progetto e la chiave pubblica di Supabase potrebbe leggere o cambiare i dati
 * attraverso l'API automatica di Supabase. Il CRM non usa quell'API: si collega direttamente al database con DATABASE_URL,
 * come proprietario delle tabelle, e il proprietario non e' toccato da RLS. Quindi il CRM continua a funzionare uguale,
 * mentre l'accesso dall'esterno viene chiuso.
 * Per prudenza si toccano solo le tabelle di cui l'utente del CRM e' proprietario (cosi' non puo' mai chiudersi fuori da solo).
 */
async function enableRls(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity AND pg_get_userbyid(c.relowner) = current_user`);
    for (const r of rows) await pool.query(`ALTER TABLE public."${r.t.replace(/"/g, '""')}" ENABLE ROW LEVEL SECURITY`);
    return { attivata: rows.map(r => r.t) };
  } catch (e) { return { errore: e.message }; }
}

module.exports = { enableRls };
