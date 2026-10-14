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

// Функция сохранения транзакции в Firebase
async function saveTransaction(ctx, text) {
  const cleanText = text.trim();
  
  if (cleanText === '/start') {
    return ctx.reply(
      '🤖 Бот на связи!\n\n' +
      '• Сюда приходят заявки с сайта.\n' +
      '• Для учета финансов отправьте текст или голосовое (например: `1500 материалы` или `-300 бензин`).'
    );
  }

  // Регулярное выражение: ищет сумму в начале и описание дальше
  const match = cleanText.match(/^([+-]?\d+[\d\s]*)\s+(.+)$/);
  
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
    await ctx.reply(`Распознано: «${cleanText}». Укажите сумму и описание (например: `600 миксер`).`);
  }
}

// Обработка текста
bot.on('text', async (ctx) => {
  if (ctx.chat.id.toString() !== ADMIN_CHAT_ID) return;
  await saveTransaction(ctx, ctx.message.text);
});

// Обработка голосовых сообщений через Whisper API
bot.on('voice', async (ctx) => {
  if (ctx.chat.id.toString() !== ADMIN_CHAT_ID) return;

  try {
    await ctx.reply('🎧 Распознаю голосовое...');
    
    const fileId = ctx.message.voice.file_id;
    const fileLink = await bot.telegram.getFileLink(fileId);
    
    // Скачиваем аудиофайл через встроенный fetch
    const audioRes = await fetch(fileLink);
    const arrayBuffer = await audioRes.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: 'audio/ogg' });

    // Формируем FormData для OpenAI
    const formData = new FormData();
    formData.append('file', blob, 'voice.ogg');
    formData.append('model', 'whisper-1');

    const transcriptionRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: formData,
    });

    const transcriptionData = await transcriptionRes.json();
    
    if (!transcriptionData.text) {
      return ctx.reply('❌ Не удалось распознать голос.');
    }

    await saveTransaction(ctx, transcriptionData.text);

  } catch (error) {
    console.error('Voice error:', error);
    await ctx.reply('❌ Ошибка при обработке голосового сообщения.');
  }
});

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const body = req.body;
      
      // Проверка на лид с сайта
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

      // Обработка запроса от Telegram
      await bot.handleUpdate(req.body);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('Handler error:', e);
      return res.status(500).json({ error: e.message });
    }
  }
  return res.status(200).send('Bot is running!');
}
