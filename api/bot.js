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

// 1. Расшифровка голоса через Whisper
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

// 2. Умный мульти-анализ текста через GPT-4o-mini
async function parseMultipleTransactions(text) {
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
          role: 'system',
          content: 'Ты профессиональный финансовый помощник. Проанализируй текст пользователя. Определи тип операции: "income" (доход, аванс, получено, пришло) или "expense" (расход, покупка, материал, трата), извлеки точную сумму (number) и чистое описание (string). Верни строго JSON-массив: [{"type": "income", "title": "Аванс", "amount": 2000}]'
        },
        { role: 'user', content: text }
      ],
      max_tokens: 300
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Ошибка AI парсинга');

  const content = data.choices[0].message.content.trim();
  const jsonClean = content.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(jsonClean);
}

// 3. Анализ изображения (чек/скриншот)
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
            { type: 'text', text: 'Определи документ: чек (expense) или перевод от клиента (income). Верни строго JSON: [{"type": "expense" || "income", "title": "описание", "amount": число}]' },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ],
      max_tokens: 150
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Ошибка Vision API');

  const content = data.choices[0].message.content.trim();
  const jsonClean = content.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(jsonClean);
}

// 4. Сохранение транзакции в Firestore с расчетом Moms (25%), AM-bidrag (8%) и B-skat (38%)
async function saveTransaction(chatId, type, amount, title, receiptUrl = '') {
  if (isNaN(amount) || amount <= 0 || amount > 500000) return false;

  const momsAmount = type === 'income' ? Math.round(amount * 0.25 * 100) / 100 : 0;
  const netIncome = amount - momsAmount;
  
  const amBidrag = type === 'income' ? Math.round(netIncome * 0.08 * 100) / 100 : 0;
  const baseForBSkat = netIncome - amBidrag;
  const bSkat = type === 'income' ? Math.round(baseForBSkat * 0.38 * 100) / 100 : 0;
  
  const takeHome = type === 'income' ? Math.round((netIncome - amBidrag - bSkat) * 100) / 100 : 0;

  const collectionName = type === 'income' ? 'incomes' : 'expenses';
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionName}`;
  
  const firestoreBody = {
    fields: {
      amount: { doubleValue: amount },
      title: { stringValue: title },
      cat: { stringValue: type === 'income' ? 'Доход с объекта' : 'Материалы' },
      date: { stringValue: new Date().toISOString().substring(0, 10) },
      created: { stringValue: Date.now().toString() },
      chatId: { stringValue: chatId.toString() },
      receipt: { stringValue: receiptUrl },
      moms: { doubleValue: momsAmount },
      amBidrag: { doubleValue: amBidrag },
      bSkat: { doubleValue: bSkat }
    }
  };

  const dbResponse = await fetch(firestoreUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(firestoreBody)
  });

  if (dbResponse.ok) {
    if (type === 'income') {
      await sendMessage(chatId, 
        `🟢 **Доход зафиксирован:**\n💰 +${amount.toLocaleString()} DKK — ${title}\n\n` +
        `📊 *Налоговая раскладка:*\n` +
        `• Moms (25%): ~${momsAmount.toLocaleString()} DKK\n` +
        `• AM-bidrag (8%): ~${amBidrag.toLocaleString()} DKK\n` +
        `• B-skat (38%): ~${bSkat.toLocaleString()} DKK\n` +
        `💵 *Чистыми на руки:* ~${takeHome.toLocaleString()} DKK`
      );
    } else {
      await sendMessage(chatId, `🔴 **Расход записан:**\n💸 -${amount.toLocaleString()} DKK — ${title}`);
    }
    return true;
  }
  return false;
}

export default async function handler(req, res) {
  try {
    const body = req.body;
    if (!body || !body.message) {
      return res.status(200).json({ ok: true });
    }

    const chatId = body.message.chat.id;

    // Голосовые
    if (body.message.voice || body.message.audio) {
      if (!OPENAI_API_KEY) return res.status(200).json({ ok: true });
      const fileId = body.message.voice ? body.message.voice.file_id : body.message.audio.file_id;
      const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
      const fileData = await fileRes.json();

      if (fileData.ok && fileData.result?.file_path) {
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`;
        await sendMessage(chatId, `🎤 Анализирую голос...`);
        const text = await transcribeAudio(fileUrl);
        const items = await parseMultipleTransactions(text);
        for (const item of items) {
          await saveTransaction(chatId, item.type || 'expense', Number(item.amount), item.title || text);
        }
      }
      return res.status(200).json({ ok: true });
    }

    // Фото / Чеки
    if (body.message.photo && body.message.photo.length > 0) {
      if (!OPENAI_API_KEY) return res.status(200).json({ ok: true });
      const photo = body.message.photo[body.message.photo.length - 1];
      const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${photo.file_id}`);
      const fileData = await fileRes.json();

      if (fileData.ok && fileData.result?.file_path) {
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.result.file_path}`;
        await sendMessage(chatId, `📸 Анализирую документ...`);
        const items = await analyzeImage(fileUrl);
        for (const item of items) {
          await saveTransaction(chatId, item.type || 'expense', Number(item.amount), item.title || 'Документ', fileUrl);
        }
      }
      return res.status(200).json({ ok: true });
    }

    // Текст
    if (body.message.text) {
      const text = body.message.text.trim();
      const lowerText = text.toLowerCase();

      if (text === '/start' || lowerText === 'id') {
        await sendMessage(chatId, `🤖 Бот на связи!\nВаш Chat ID: \`${chatId}\`\n\n📌 Управление финансами и налогами:\n• /moms — график квартальных налогов\n• Отправляйте текстом или голосом списки доходов и расходов.`);
        return res.status(200).json({ ok: true });
      }

      if (lowerText === '/moms' || lowerText.includes('moms') || lowerText.includes('налог')) {
        await sendMomsInfo(chatId);
        return res.status(200).json({ ok: true });
      }

      const items = await parseMultipleTransactions(text);
      for (const item of items) {
        await saveTransaction(chatId, item.type || 'expense', Number(item.amount), item.title || text);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Handler error:', e);
    return res.status(200).json({ ok: true, error: e.message });
  }
}

async function sendMomsInfo(chatId) {
  const msg = `🇩🇰 **График уплаты налогов и Moms (Skattestyrelsen):**\n\n` +
              `🏢 **Luxe Renovation (CVR: 46769074)**\n\n` +
              `🔹 **Q1 (Январь — Март):** Сдача и уплата до **1 июня**\n` +
              `🔹 **Q2 (Апрель — Июнь):** Сдача и уплата до **1 сентября**\n` +
              `🔹 **Q3 (Июль — Сентябрь):** Сдача и уплата до **1 декабря**\n` +
              `🔹 **Q4 (Октябрь — Декабрь):** Сдача и уплата до **1 марта**\n\n` +
              `💡 Автоматический расчет: Moms 25%, AM-bidrag 8% и B-skat 38%!`;
  await sendMessage(chatId, msg);
}

