const axios = require('axios');
require('dotenv').config();

/**
 * Genera un commento in linguaggio naturale su una value bet trovata,
 * usando l'API gratuita di Gemini (Google AI Studio). Lo scopo è SPIEGARE
 * il calcolo già fatto dal value engine (edge, probabilità, campione dati)
 * — non introdurre una nuova fonte di previsione. L'AI non ha accesso a
 * dati che il sistema non le fornisce esplicitamente nel prompt.
 *
 * Nota: sul piano gratuito di Gemini, i contenuti inviati possono essere
 * usati da Google per migliorare i propri prodotti. Per questo caso d'uso
 * (dati sportivi, nessuna informazione personale/sensibile) non è un
 * problema, ma è bene saperlo.
 */
async function generateBetCommentary(valueBet, context) {
  const { market, selection, bookmakerOdd, estimatedProbability, edgePct } = valueBet;
  const { homeTeam, awayTeam, sampleMatches, injuries } = context;

  const prompt = `Sei un assistente che spiega in italiano semplice, in massimo 3 righe,
perché una scommessa calcolata da un modello statistico ha "valore" (edge positivo).
Non inventare dati che non ti fornisco. Segnala eventuali limiti (es. campione piccolo,
assenze chiave) se rilevanti.

Partita: ${homeTeam} vs ${awayTeam}
Mercato: ${market} - ${selection}
Quota bookmaker: ${bookmakerOdd}
Probabilità stimata dal modello: ${(estimatedProbability * 100).toFixed(1)}%
Vantaggio stimato (edge): ${edgePct}%
Partite usate per la stima: ${sampleMatches || 'non specificato'}
Assenze rilevanti: ${injuries?.length ? injuries.join(', ') : 'nessuna nota'}

Scrivi solo il commento, senza premesse.`;

  try {
    const { data } = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }]
      },
      { headers: { 'content-type': 'application/json' } }
    );

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text || null;
  } catch (err) {
    console.error('Errore generazione commento AI:', err.message);
    return null; // il sistema deve funzionare comunque senza il commento
  }
}

module.exports = { generateBetCommentary };
