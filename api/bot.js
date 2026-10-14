import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fetch from 'node-fetch';

let db = null;

try {
  if (!getApps().length && process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    
    // Аккуратно восстанавливаем переносы строк независимо от того, как ключ был вставлен
    privateKey = privateKey.replace(/\\n/g, '\n');
    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      // Если ключ вставлен сплошным текстом без дефисов, пробуем восстановить обертку
      privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
    }

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
  console.error('Firebase init error details:', e.message);
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

    // 1. Заявка с сайта
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

    // 2. Сообщения из Telegram
    if (body && body.message && body.message.chat) {
      const chatId = body.message.chat.id;
      const text = body.message.text ? body.message.text.trim() : '';

      if (text === '/start' || text.toLowerCase() === 'id') {
        await sendMessage(chatId, `🤖 Бот на связи!\nВаш Chat ID: \`${chatId}\`\n\nОтправьте расход (например: \`500 материал\` или \`миксер 600\`).`);
        return res.status(200).json({ ok: true });
      }

      if (text) {
        const cleanText = text.replace(/(крон|кр|kr|\.)/gi, '').trim();
        const numMatch = cleanText.match(/\d+[\d\s]*/);

        if (numMatch) {
          const amountStr = numMatch[0].replace(/\s/g, '');
          const amount = parseFloat(amountStr);
          const description = cleanText.replace(numMatch[0], '').trim() || text;

          if (db) {
            await db.collection('transactions').add({
              amount: Math.abs(amount),
              type: 'expense',
              description: description,
              date: new Date().toISOString(),
              chatId: chatId.toString()
            });
            await sendMessage(chatId, `✅ Успешно записано в базу:\n💰 ${Math.abs(amount)} DKK — ${description}`);
          } else {
            await sendMessage(chatId, `⚠️ Сумма найдена (${amount} DKK), но объект базы данных ` + (db ? 'подключен' : 'пустой (проверьте ключ в Vercel)') + `.`);
          }
        } else {
          await sendMessage(chatId, `❌ Не удалось найти сумму. Укажите цифру (например: \`миксер 600\`).`);
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Handler error:', e);
    return res.status(200).json({ ok: true, error: e.message });
  }
}
