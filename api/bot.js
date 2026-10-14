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

async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot is working!');
  }

  try {
    const body = req.body;

    // Заявка с сайта
    if (body && (body.name || body.service || body.смета)) {
      const leadText = `🔔 *Новая заявка с сайта!*\n\n` +
        `👤 *Имя:* ${body.name || 'Не указано'}\n` +
        `📞 *Телефон:* ${body.phone || 'Не указан'}\n` +
        `💰 *Смета:* ${body.смета || body.price || 'Не указана'}`;

      if (process.env.ALLOWED_CHAT_ID) {
        await sendMessage(process.env.ALLOWED_CHAT_ID, leadText);
      }
      return res.status(200).json({ ok: true, message: 'Lead sent' });
    }

    // Сообщение из Telegram (без фильтрации по ID для теста)
    if (body && body.message && body.message.chat) {
      const chatId = body.message.chat.id;
      const text = body.message.text ? body.message.text.trim() : '';

      // Отправляем вам ваш ID обратно в чат, чтобы вы точный знали его
      if (text === '/start' || text.toLowerCase() === 'id') {
        await sendMessage(chatId, `🤖 Бот на связи!\nВаш Chat ID: \`${chatId}\`\n\nОтправьте расход (например: \`500 материал\`).`);
        return res.status(200).json({ ok: true });
      }

      if (text) {
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
            chatId: chatId.toString()
          });

          await sendMessage(chatId, `✅ Записано в базу: ${Math.abs(amount)} DKK — ${description}`);
        } else {
          await sendMessage(chatId, `Получено: «${text}». Укажите сумму и текст (например: \`300 бензин\`).`);
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Critical error:', e);
    return res.status(500).json({ error: e.message });
  }
}
