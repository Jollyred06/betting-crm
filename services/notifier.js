const axios = require('axios');
require('dotenv').config();

/**
 * Invia una notifica Telegram (gratuito, senza SMTP/email da configurare).
 * Se le variabili non sono impostate, non fa nulla: il sistema funziona
 * comunque, semplicemente senza avviso automatico.
 *
 * Setup (una tantum):
 * 1. Su Telegram, cerca "@BotFather", manda /newbot, segui le istruzioni:
 *    ottieni un TELEGRAM_BOT_TOKEN.
 * 2. Cerca il tuo bot appena creato e mandagli un messaggio qualsiasi
 *    (es. "ciao"), altrimenti non può scriverti per primo.
 * 3. Apri nel browser:
 *    https://api.telegram.org/bot<IL_TUO_TOKEN>/getUpdates
 *    e cerca "chat":{"id": ...} nella risposta: quello è il TELEGRAM_CHAT_ID.
 */
async function sendTelegramNotification(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return; // notifiche non configurate, salta silenziosamente

  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML'
    });
  } catch (err) {
    console.error('Errore invio notifica Telegram:', err.message);
    // Non blocchiamo l'analisi giornaliera se la notifica fallisce
  }
}

module.exports = { sendTelegramNotification };
