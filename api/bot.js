import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fetch from 'node-fetch';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}
const db = getFirestore();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ALLOWED_CHAT_ID;

async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot is running!');
  }

  try {
    const body = req.body;

    // 1. Проверяем, если это заявка с сайта
    if (body && (body.name || body.service || body.смета)) {
      const leadText = `🔔 *Новая заявка с сайта!*\n\n` +
        `👤 *Имя:* ${body.name || 'Не указано'}\n` +
        `📞 *Телефон:* ${body.phone || 'Не указан'}\n` +
        `📧 *Email:* ${body.email || 'Не указан'}\n` +
        `📍 *Адрес:* ${body.address || 'Не указан'}\n` +
        `🛠️ *Услуга:* ${body.service || 'Не указана'}\n` +
        `💰 *Смета:* ${body.смета || body.price || 'Не указана'}\n` +
        `💬 *Заметка:* ${body.note || body.comment || 'Нет'}`;

      await sendMessage(ADMIN_CHAT_ID, leadText);
      return res.status(200).json({ ok: true, message: 'Lead sent' });
    }

    // 2. Проверяем, если это сообщение от Telegram-бота (текст)
    if (body && body.message && body.message.chat) {
      const chatId = body.message.chat.id.toString();
      
      if (chatId === ADMIN_CHAT_ID && body.message.text) {
        const text = body.message.text.trim();

        if (text === '/start') {
          await sendMessage(chatId, '🤖 Бот на связи!\n\n• Отправьте текст для учета финансов (например: `500 материалы`).');
          return res.status(200).json({ ok: true });
        }

        // Парсим сумму и описание
        const match = text.match(/^([+-]?\d+[\d\s]*)\s+(.+)$/);
        if (match) {
          const amount = parseFloat(match[1].replace(/\s/g, ''));
          const description = match[2];
          const type = amount >= 0 ? 'income' : 'expense';

          await db.collection('transactions').add({
            amount: Math.abs(amount),
            type: type,
            description: description,
            date: new Date().toISOString(),
          });

          const sign = type === 'income' ? '+' : '-';
          await sendMessage(chatId, `✅ Записано (${sign}): ${Math.abs(amount)} DKK — ${description}`);
        } else {
          await sendMessage(chatId, `Распознано: «${text}». Укажите сумму и описание (например: `500 краска`).`);
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Error:', e);
    return res.status(500).json({ error: e.message });
  }
}
