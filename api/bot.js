import { Telegraf } from 'telegraf';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Инициализация Firebase
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

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const ADMIN_CHAT_ID = process.env.ALLOWED_CHAT_ID;

// Обработка текстовых команд
bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const text = ctx.message.text;

  // Проверка, что пишет администратор (вы)
  if (chatId !== ADMIN_CHAT_ID) return;

  // Команда /start
  if (text === '/start') {
    return ctx.reply(
      '🤖 Бот на связи!\n\n' +
      '• Сюда падают заявки с вашего сайта.\n' +
      '• Для учета финансов просто отправьте сумму и описание (например: `1500 материалы` или `-300 бензин`).'
    );
  }

  // Пробуем распознать финансовую запись (начинается с числа)
  const match = text.match(/^([+-]?\d+[\d\s]*)\s+(.+)$/);
  
  if (match) {
    const amount = parseFloat(match[1].replace(/\s/g, ''));
    const description = match[2];
    const type = amount >= 0 ? 'income' : 'expense';

    try {
      await db.collection('transactions').add({
        amount: Math.abs(amount),
        type: type,
        description: description,
        date: new Date().toISOString(),
      });

      const sign = type === 'income' ? '+' : '-';
      await ctx.reply(`✅ Записано (${sign}): ${Math.abs(amount)} DKK — ${description}`);
    } catch (error) {
      console.error('Firebase error:', error);
      await ctx.reply('❌ Ошибка сохранения в базу данных.');
    }
  } else {
    // Если это не финансы, бот просто подтвердит получение обычного текста
    await ctx.reply('Сообщение получено. Если это финансы, отправьте в формате: "сумма описание" (например, `500 инструмент`).');
  }
});

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      // Проверяем, прилетел ли лид с сайта (если есть поле name или service)
      const body = req.body;
      if (body && (body.name || body.service || body.смета)) {
        const leadText = `🔔 *Новая заявка с сайта!*\n\n` +
          `👤 *Имя:* ${body.name || 'Не указано'}\n` +
          `📞 *Телефон:* ${body.phone || 'Не указан'}\n` +
          `📧 *Email:* ${body.email || 'Не указан'}\n` +
          `📍 *Адрес:* ${body.address || 'Не указан'}\n` +
          `🛠️ *Услуга:* ${body.service || 'Не указана'}\n` +
          `💰 *Смета:* ${body.смета || body.price || 'Не указана'}\n` +
          `💬 *Заметка:* ${body.note || body.comment || 'Нет'}`;

        await bot.telegram.sendMessage(ADMIN_CHAT_ID, leadText, { parse_mode: 'Markdown' });
        return res.status(200).json({ ok: true, message: 'Lead sent' });
      }

      // Иначе обрабатываем как обновление от Telegram (сообщения от вас)
      await bot.handleUpdate(req.body);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message });
    }
  }
  return res.status(200).send('Bot is running!');
}
