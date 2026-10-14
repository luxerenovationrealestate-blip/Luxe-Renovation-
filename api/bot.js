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

async function transcribeAudio(fileUrl) {
  const audioRes = await fetch(fileUrl);
  const audioBuffer = await audioRes.buffer();

  const formData = new FormData();
  formData.append('file', audioBuffer, {
    filename: 'voice.ogg',
    contentType: 'audio/ogg',
  });
  formData.append('model', 'whisper-1');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      ...formData.getHeaders()
    },
    body: formData
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'Ошибка OpenAI API');
  }
  return data.text || '';
}

async function processExpenseText(chatId, text) {
  // Убираем валютные приставки, но оставляем числа и текст
  const cleanText = text.replace(/(крон|кроны|кр|dkk|kr|\.)/gi, '').trim();
  
  // Улучшенный поиск любых чисел от 1 до 500 000 (поддерживает пробелы внутри тысяч, например "15 000" или "500000")
  const numMatch = cleanText.match(/\d{1,3}(?:\s\d{3})+|\d+/g);

  if (numMatch && numMatch.length > 0) {
    // Берем последнее найденное число (обычно сумма в конце или в тексте)
    const rawNumStr = numMatch[numMatch.length - 1];
    const amount = parseFloat(rawNumStr.replace(/\s/g, ''));
    
    // Описание — это весь текст без найденного числа
    const description = cleanText.replace(rawNumStr, '').trim() || text;

    if (isNaN(amount) || amount <= 0 || amount > 500000) {
      await sendMessage(chatId, `❌ Сумма должна быть в пределах от 1 до 500 000 DKK.`);
      return;
    }

    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/expenses`;
    
    const firestoreBody = {
      fields: {
        amount: { doubleValue: amount },
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
      await sendMessage(chatId, `✅ Успешно записано:\n💰 ${amount.toLocaleString()} DKK — ${description}`);
    } else {
      await sendMessage(chatId, `⚠️ Ошибка записи в базу данных.`);
    }
  } else {
    await sendMessage(chatId, `❌ Распознано: «${text}». Но я не нашел сумму. Назовите или укажите число (например: \`15000 материалы\` или \`500\`).`);
  }
}

export default async function handler(req, res) {
  try {
    const body = req.body;
    if (!body || !body.message) {
      return res.status(200).json({ ok: true });
    }

    const chatId = body.message.chat.id;
    let text = '';

    if (body.message.voice || body.message.audio) {
      if (!OPENAI_API_KEY) {
        await sendMessage(chatId, `⚠️ Ошибка: не задан ключ OPEN_KEY в настройках Vercel.`);
        return res.status(200).json({ ok: true });
      }

      const fileId = body.message.voice ? body.message.voice.file_id : body.message.audio.file_id;
      
      const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
      const fileData = await fileRes.json();

      if (fileData.ok && fileData.result && fileData.result.file_path) {
        const filePath = fileData.result.file_path;
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
        
        await sendMessage(chatId, `🎤 Слушаю и расшифровываю голосовое...`);
        
        try {
          text = await transcribeAudio(fileUrl);
        } catch (voiceErr) {
          await sendMessage(chatId, `❌ Ошибка OpenAI: ${voiceErr.message}`);
          return res.status(200).json({ ok: true });
        }
      } else {
        await sendMessage(chatId, `❌ Не удалось получить аудиофайл из Telegram.`);
        return res.status(200).json({ ok: true });
      }
    } else if (body.message.text) {
      text = body.message.text.trim();
    }

    if (text === '/start' || text.toLowerCase() === 'id') {
      await sendMessage(chatId, `🤖 Бот на связи!\nВаш Chat ID: \`${chatId}\`\n\nОтправьте любую сумму от 1 до 500 000 текстом или голосом.`);
      return res.status(200).json({ ok: true });
    }

    if (text) {
      await processExpenseText(chatId, text);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Critical handler error:', e);
    return res.status(200).json({ ok: true, error: e.message });
  }
}
