import fetch from 'node-fetch';

const PROJECT_ID = 'luxe-renovation-72e1a';
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

    // Обработка лидов с сайта
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

    // Обработка сообщений из Telegram-бота
    if (body && body.message && body.message.chat) {
      const chatId = body.message.chat.id;
      const text = body.message.text ? body.message.text.trim() : '';

      if (text === '/start' || text.toLowerCase() === 'id') {
        await sendMessage(chatId, `🤖 Бот на связи!\nВаш Chat ID: \`${chatId}\`\n\nОтправьте расход (например: \`миксер 500\`).`);
        return res.status(200).json({ ok: true });
      }

      if (text) {
        const cleanText = text.replace(/(крон|кр|kr|\.)/gi, '').trim();
        const numMatch = cleanText.match(/\d+[\d\s]*/);

        if (numMatch) {
          const amountStr = numMatch[0].replace(/\s/g, '');
          const amount = parseFloat(amountStr);
          const description = cleanText.replace(numMatch[0], '').trim() || text;

          // Правильный URL корневой коллекции expenses через REST API
          const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/expenses`;
          
          // Структура документов, совместимая с сайтом
          const firestoreBody = {
            fields: {
              amount: { doubleValue: Math.abs(amount) },
              title: { stringValue: description },
              cat: { stringValue: 'Прочее' },
              date: { stringValue: new Date().toISOString().substring(0, 10) },
              created: { stringValue: Date.now().toString() },
              chatId: { stringValue: chatId.toString() }
            }
          };

          const dbResponse = await fetch(firestoreUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(firestoreBody)
          });

          if (dbResponse.ok) {
            await sendMessage(chatId, `✅ Успешно записано в базу:\n💰 ${Math.abs(amount)} DKK — ${description}`);
          } else {
            const errText = await dbResponse.text();
            console.error('Firestore REST error:', errText);
            await sendMessage(chatId, `⚠️ Ошибка записи в базу.`);
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
