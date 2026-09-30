const axios = require('axios');
const nodemailer = require('nodemailer');
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
async function sendTelegramDetailed(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { configured: false, sent: false, missing: [!token && 'TELEGRAM_BOT_TOKEN', !chatId && 'TELEGRAM_CHAT_ID'].filter(Boolean) };

  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML'
    });
    return { configured: true, sent: true };
  } catch (err) {
    const detail = err.response && err.response.data && err.response.data.description ? err.response.data.description : err.message;
    console.error('Errore invio notifica Telegram:', detail);
    // Non blocchiamo l'analisi giornaliera se la notifica fallisce
    return { configured: true, sent: false, error: detail };
  }
}

async function sendTelegramNotification(text) {
  await sendTelegramDetailed(text);
}

/**
 * Cerca nei messaggi ricevuti dal bot chi gli ha scritto, cosi' non serve aprire indirizzi a mano per trovare il chat id.
 * Richiede solo TELEGRAM_BOT_TOKEN e che tu abbia mandato almeno un messaggio al bot.
 */
async function findTelegramChats() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { configured: false, chats: [] };
  try {
    const { data } = await axios.get(`https://api.telegram.org/bot${token}/getUpdates`, { timeout: 15000 });
    const seen = new Map();
    for (const u of data.result || []) {
      const c = (u.message || u.my_chat_member || u.channel_post || {}).chat;
      if (c && c.id && !seen.has(c.id)) seen.set(c.id, { id: String(c.id), name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.title || c.username || '' });
    }
    return { configured: true, chats: [...seen.values()] };
  } catch (err) {
    const detail = err.response && err.response.data && err.response.data.description ? err.response.data.description : err.message;
    return { configured: true, chats: [], error: detail };
  }
}

/**
 * Invia una notifica via email usando il tuo account Gmail come mittente
 * (gratis, nessun servizio terzo da registrare). Se le variabili non sono
 * impostate, non fa nulla: il sistema funziona comunque senza avviso.
 *
 * Setup (una tantum):
 * 1. Attiva la verifica in due passaggi sul tuo account Google, se non
 *    già attiva (myaccount.google.com/security).
 * 2. Vai su myaccount.google.com/apppasswords, crea una "password per le
 *    app" (scegli un nome a piacere, es. "betting-crm").
 * 3. Copia la password di 16 caratteri che Google genera: quella è
 *    EMAIL_PASS, non la tua password normale di Gmail.
 * 4. EMAIL_USER è il tuo indirizzo Gmail; EMAIL_TO è dove vuoi ricevere
 *    le notifiche (può essere lo stesso indirizzo).
 */
async function sendEmailNotification(subject, text) {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const to = process.env.EMAIL_TO || user;
  if (!user || !pass) return; // notifiche email non configurate, salta silenziosamente

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass }
    });

    await transporter.sendMail({
      from: `"Betting CRM" <${user}>`,
      to,
      subject,
      text
    });
  } catch (err) {
    console.error('Errore invio notifica email:', err.message);
    // Non blocchiamo l'analisi giornaliera se la notifica fallisce
  }
}

/**
 * Invia una notifica WhatsApp tramite CallMeBot (servizio gratuito di
 * terze parti, non ufficiale — pensato per uso personale, non un'API
 * WhatsApp garantita da Meta). Può interrompersi senza preavviso, ma è
 * l'unica strada gratuita per WhatsApp senza passare da servizi a pagamento.
 * Se le variabili non sono impostate, non fa nulla.
 *
 * Setup (una tantum, dal tuo telefono):
 * 1. Salva questo numero in rubrica: +34 644 59 71 65 (numero ufficiale
 *    di CallMeBot, verificalo su callmebot.com/blog/free-api-whatsapp-messages
 *    perché può cambiare).
 * 2. Manda al numero salvato, su WhatsApp, esattamente questo messaggio:
 *    "I allow callmebot to send me messages"
 * 3. Aspetta la risposta automatica con scritto "API Activated... Your
 *    APIKEY is ..." — quel numero è WHATSAPP_APIKEY.
 * 4. WHATSAPP_PHONE è il tuo numero con prefisso internazionale, es.
 *    "+393331234567".
 */
async function sendWhatsAppNotification(text) {
  const phone = process.env.WHATSAPP_PHONE;
  const apiKey = process.env.WHATSAPP_APIKEY;
  if (!phone || !apiKey) return; // notifiche WhatsApp non configurate, salta silenziosamente

  try {
    await axios.get('https://api.callmebot.com/whatsapp.php', {
      params: { phone, text, apikey: apiKey }
    });
  } catch (err) {
    console.error('Errore invio notifica WhatsApp:', err.message);
    // Non blocchiamo l'analisi giornaliera se la notifica fallisce
  }
}

module.exports = { sendTelegramNotification, sendTelegramDetailed, findTelegramChats, sendEmailNotification, sendWhatsAppNotification };
