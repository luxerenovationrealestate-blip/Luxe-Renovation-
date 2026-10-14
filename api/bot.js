import fetch from 'node-fetch';

const PROJECT_ID = 'luxe-renovation-72e1a';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPEN_KEY || process.env.OPENAI_API_KEY;

async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
  });
}

async function transcribeAudio(fileUrl) {
  const audioRes = await fetch(fileUrl);
  const audioBuffer = await audioRes.arrayBuffer();

  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'voice.ogg');
  formData.append('model', 'whisper-1');

  // Устанавливаем таймаут 10 секунд, чтобы бот не зависал навсегда
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: formData,
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Ошибка OpenAI API');
    }
    return data.text || '';
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Превышено время ожидания OpenAI (таймаут)');
    }
    throw err;
  }
}

async function processExpenseText(chatId, text) {
  const cleanText = text.replace(/(крон|кр|kr|\.)/gi, '').trim();
  const numMatch = cleanText.match(/\d+[\d\s]*/);

  if (numMatch) {
    const amountStr = numMatch[0].replace(/\s/g, '');
    const amount = parseFloat(amountStr);
    const description = cleanText.replace(numMatch[0], '').trim() || text;

    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/expenses`;
    
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
      await sendMessage(chatId, `⚠️ Ошибка записи в базу.`);
    }
  } else {
    await sendMessage(chatId, `❌ Распознано: «${text}». Но сумма не найдена. Укажите цифру (например: \`миксер 600\`).`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot is working perfectly!');
  }

  try {
    const body = req.body;

    if (body && body.message) {
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
          
          await sendMessage(chatId, `🎤 Слушаю голосовое...`);
          
          try {
            text = await transcribeAudio(fileUrl);
          } catch (voiceErr) {
            await sendMessage(chatId, `❌ Ошибка расшифровки голоса: ${voiceErr.message}\n\n(Проверьте баланс в OpenAI Billing).`);
            return res.status(200).json({ ok: true });
          }
        } else {
          await sendMessage(chatId, `❌ Не удалось получить аудиофайл.`);
          return res.status(200).json({ ok: true });
        }
      } else if (body.message.text) {
        text = body.message.text.trim();
      }

      if (text === '/start' || text.toLowerCase() === 'id') {
        await sendMessage(chatId, `🤖 Бот на связи!\nВаш Chat ID: \`${chatId}\`\n\nОтправьте текст или голосовое.`);
        return res.status(200).json({ ok: true });
      }

      if (text) {
        await processExpenseText(chatId, text);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Handler error:', e);
    return res.status(200).json({ ok: true, error: e.message });
  }
}
