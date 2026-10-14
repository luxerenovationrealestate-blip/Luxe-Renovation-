import fetch from 'node-fetch';
import FormData from 'form-data';

const PROJECT_ID = 'luxe-renovation-72e1a';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPEN_KEY || process.env.OPENAI_API_KEY;

async function sendMessage(chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
    });
  } catch (err) {
    console.error('Telegram send error:', err);
  }
}

// 1. Расшифровка голосовых через Whisper
async function transcribeAudio(fileUrl) {
  const audioRes = await fetch(fileUrl);
  const audioBuffer = await audioRes.buffer();

  const formData = new FormData();
  formData.append('file', audioBuffer, { filename: 'voice.ogg', contentType: 'audio/ogg' });
  formData.append('model', 'whisper-1');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, ...formData.getHeaders() },
    body: formData
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Ошибка Whisper API');
  return data.text || '';
}

// 2. Распознавание чеков/скриншотов через GPT-4o-mini Vision
async function analyzeImage(imageUrl) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Это чек или скриншот расхода. Проанализируй изображение, найди описание товара/услуги и итоговую сумму в кронах (DKK). Верни ответ строго в формате JSON без лишнего текста: {"title": "описание", "amount": число}'
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl }
            }
          ]
        }
      ],
      max_tokens: 150
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Ошибка Vision API');

  const content = data.choices[0].message.content.trim();
  // Очищаем от возможных маркеров кода markdown
  const jsonClean = content.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(jsonClean);
}

// 3. Сохранение расхода в Firestore
async function saveExpense(chatId, amount, title, receiptUrl = '') {
  if (isNaN(amount) || amount <= 0 || amount > 500000) {
    await sendMessage(chatId, `❌ Неверная сумма (${amount}). Проверьте данные.`);
    return;
  }

  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/expenses`;
  
  const firestoreBody = {
    fields: {
      amount: { doubleValue: amount },
      title: { stringValue: title },
      cat: { stringValue: 'Материалы' },
      date: { stringValue: new Date().toISOString().substring(0, 10) },
      created: { stringValue: Date.now().toString() },
      chatId: { stringValue: chatId.toString() },
      receipt: { stringValue: receiptUrl }
    }
  };

  const dbResponse = await fetch(firestoreUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(firestoreBody)
  });

  if (dbResponse.ok) {
    await sendMessage(chatId, `✅ Успешно записано в базу:\n💰 ${amount.toLocaleString()} DKK — ${title}`);
  } else {
    await sendMessage(chatId, `⚠️ Ошибка записи в базу данных.`);
  }
}

// 4. Обработка текстовых расходов
async function processExpenseText(chatId, text) {
  const cleanText = text.replace(/(крон|кроны|кр|dkk|kr|\.)/gi, '').trim();
  const numMatch = cleanText.match(/\d{1,3}(?:\s\d{3})+|\d+/g);

  if (numMatch && numMatch.length > 0) {
    const rawNumStr = numMatch[numMatch.length - 1];
    const amount = parseFloat(rawNumStr.replace(/\s/g, ''));
    const description = cleanText.replace(rawNumStr, '').trim() || text;
    await saveExpense(chatId, amount, description);
  } else {
    await sendMessage(chatId, `❌ Распознано: «${text}». Не найдена сумма. Укажите цифру (например: \`миксер 600\`).`);
  }
}

export default async function handler(req, res) {
  try {
    const body = req.body;
    if (!body || !body.message) {
      return res.status(200).json({ ok: true });
    }

    const chatId = body.message.chat.id;

    // А. Обработка голосовых
    if (body.message.voice || body.message.audio) {
      if (!OPENAI_API_KEY) {
        await sendMessage(chatId, `⚠️ Ошибка: не задан ключ OPEN_KEY.`);
        return res.status(200).json({ ok: true });
      }

      const fileId = body.message.voice ? body.message.voice.file_id : body.message.audio.file_id;
      const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
      const fileData = await fileRes.json();

      if (fileData.ok && fileData.result?.file_path) {
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`;
        await sendMessage(chatId, `🎤 Слушаю и расшифровываю голосовое...`);
        try {
          const text = await transcribeAudio(fileUrl);
          await processExpenseText(chatId, text);
        } catch (err) {
          await sendMessage(chatId, `❌ Ошибка распознавания голоса: ${err.message}`);
        }
      }
      return res.status(200).json({ ok: true });
    }

    // Б. Обработка фотографий / скриншотов чеков
    if (body.message.photo && body.message.photo.length > 0) {
      if (!OPENAI_API_KEY) {
        await sendMessage(chatId, `⚠️ Ошибка: не задан ключ OPEN_KEY.`);
        return res.status(200).json({ ok: true });
      }

      // Берем фото самого высокого качества (последний элемент массива)
      const photo = body.message.photo[body.message.photo.length - 1];
      const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${photo.file_id}`);
      const fileData = await fileRes.json();

      if (fileData.ok && fileData.result?.file_path) {
        const filePath = fileData.result.file_path;
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
        
        await sendMessage(chatId, `📸 Анализирую чек / скриншот...`);
        try {
          const result = await analyzeImage(fileUrl);
          if (result && result.amount) {
            await saveExpense(chatId, Number(result.amount), result.title || 'Чек с фото', fileUrl);
          } else {
            await sendMessage(chatId, `❌ Не удалось найти сумму на изображении.`);
          }
        } catch (err) {
          await sendMessage(chatId, `❌ Ошибка анализа изображения: ${err.message}`);
        }
      }
      return res.status(200).json({ ok: true });
    }

    // В. Обработка обычного текста
    if (body.message.text) {
      const text = body.message.text.trim();
      if (text === '/start' || text.toLowerCase() === 'id') {
        await sendMessage(chatId, `🤖 Бот на связи!\nВаш Chat ID: \`${chatId}\`\n\nОтправьте текст, голосовое или **фото/скриншот чека**.`);
        return res.status(200).json({ ok: true });
      }
      await processExpenseText(chatId, text);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Handler error:', e);
    return res.status(200).json({ ok: true, error: e.message });
  }
}
