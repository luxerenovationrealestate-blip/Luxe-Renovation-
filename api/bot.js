import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fetch from 'node-fetch';

let db = null;

try {
  if (!getApps().length && process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.slice(1, -1);
    }
    privateKey = privateKey.replace(/\\n/g, '\n');

    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
    });
  }
  db = getFirestore();
} catch (e) {
  console.error('Firebase init error:', e);
}

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
    return res.status(200).send('Bot is working perfectly!');
  }

  try {
    const body = req.body;

    // 1. Обработка заявки с сайта
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

    // 2. Обработка сообщений из Telegram
    if (body && body.message && body.message.chat) {
      const chatId = body.message.chat.id;
      const text = body.message.text ? body.message.text.trim() : '';

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

          if (db) {
            await db.collection('transactions').add({
              amount: Math.abs(amount),
              type: type,
              description: description,
              date: new Date().toISOString(),
              chatId: chatId.toString()
            });
            await sendMessage(chatId, `✅ Записано в базу: ${Math.abs(amount)} DKK — ${description}`);
          } else {
            await sendMessage(chatId, `⚠️ Текст принят (${amount} DKK), но база данных не подключена.`);
          }
        } else {
          await sendMessage(chatId, `Получено: «${text}». Укажите сумму и текст (например: \`300 бензин\`).`);
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Handler error:', e);
    // Возвращаем 200, чтобы Telegram не считал запрос упавшим и не повторял его бесконечно
    return res.status(200).json({ error: e.message });
  }
}
