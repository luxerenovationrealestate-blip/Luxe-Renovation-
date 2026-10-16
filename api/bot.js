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

// 1. Расшифровка голоса через Whisper API
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

// 2. Мульти-анализ текста через GPT-4o-mini
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

// 3. Анализ изображения (чек / скриншот) через Vision API
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
            { type: 'text', text: 'Определи документ: чек (expense) или перевод от клиента (income). Верни строго JSON-массив: [{"type": "expense" или "income", "title": "описание", "amount": число}]' },
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

// 4. Сохранение транзакции в Firestore с правильным расчётом B-skat с учётом Fradrag
async function saveTransaction(chatId, type, amount, title, receiptUrl = '') {
  if (isNaN(amount) || amount <= 0 || amount > 500000) return false;

  const momsAmount = type === 'income' ? Math.round(amount * 0.25 * 100) / 100 : 0;
  const grossAmount = type === 'income' ? amount + momsAmount : amount; 

  // Налоговая математика с учётом Fradrag 16.123 DKK
  const amBidrag = type === 'income' ? Math.round(amount * 0.08 * 100) / 100 : 0; // 8%
  const profitAfterAm = amount - amBidrag;
  const monthlyFradrag = 16123;
  const baseForBSkat = Math.max(0, profitAfterAm - monthlyFradrag);
  const bSkat = type === 'income' ? Math.round(baseForBSkat * 0.36 * 100) / 100 : 0; // 36%
  const takeHome = type === 'income' ? Math.round((amount - amBidrag - bSkat) * 100) / 100 : 0;

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
        `🟢 **Доход зафиксирован:**\n💰 +${amount.toLocaleString()} DKK (Ваш доход) — ${title}\n` +
        `🧾 *Чек заказчику (+25% Moms):* ${grossAmount.toLocaleString()} DKK\n\n` +
        `📊 *Налоговая раскладка с ${amount.toLocaleString()} DKK:*\n` +
        `• AM-bidrag (8%): ~${amBidrag.toLocaleString()} DKK\n` +
        `• Необлагаемый Fradrag: 16.123 DKK / мес.\n` +
        `• B-skat (36% с Fradrag): ~${bSkat.toLocaleString()} DKK\n` +
        `💵 *Чистыми на руки (без учёта расходов):* ~${takeHome.toLocaleString()} DKK`
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
        await sendMessage(chatId, `🎤 Слушаю и расшифровываю голосовое...`);
        try {
          const text = await transcribeAudio(fileUrl);
          
          if (text.toLowerCase().includes('moms') || text.toLowerCase().includes('налог')) {
            await sendMomsInfo(chatId);
            return res.status(200).json({ ok: true });
          }

          const items = await parseMultipleTransactions(text);
          if (Array.isArray(items) && items.length > 0) {
            for (const item of items) {
              await saveTransaction(chatId, item.type || 'expense', Number(item.amount), item.title || text);
            }
          } else {
            await sendMessage(chatId, `❌ Не удалось найти суммы в голосе: «${text}»`);
          }
        } catch (err) {
          await sendMessage(chatId, `❌ Ошибка обработки голоса: ${err.message}`);
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
        await sendMessage(chatId, `📸 Сканирую изображение...`);
        try {
          const items = await analyzeImage(fileUrl);
          if (Array.isArray(items) && items.length > 0) {
            for (const item of items) {
              await saveTransaction(chatId, item.type || 'expense', Number(item.amount), item.title || 'Чек/Документ', fileUrl);
            }
          } else {
            await sendMessage(chatId, `❌ Не удалось распознать документ.`);
          }
        } catch (err) {
          await sendMessage(chatId, `❌ Ошибка анализа фото: ${err.message}`);
        }
      }
      return res.status(200).json({ ok: true });
    }

    // Текст
    if (body.message.text) {
      const text = body.message.text.trim();
      const lowerText = text.toLowerCase();

      if (text === '/start' || lowerText === 'id') {
        await sendMessage(chatId, `🤖 Бот **Luxe Renovation** на связи!\nВаш Chat ID: \`${chatId}\`\n\n📌 Возможности:\n• /moms — налоги и график уплаты\n• Текст: «Аванс за объект 100000», «Купил краску 1500»\n• Голосовые сообщения\n• Фото чеков и скриншоты`);
        return res.status(200).json({ ok: true });
      }

      if (lowerText === '/moms' || lowerText.includes('moms') || lowerText.includes('налог') || lowerText.includes('skat')) {
        await sendMomsInfo(chatId);
        return res.status(200).json({ ok: true });
      }

      try {
        const items = await parseMultipleTransactions(text);
        if (Array.isArray(items) && items.length > 0) {
          for (const item of items) {
            await saveTransaction(chatId, item.type || 'expense', Number(item.amount), item.title || text);
          }
        } else {
          await sendMessage(chatId, `❌ Не удалось распознать сумму и тип операции.`);
        }
      } catch (err) {
        await sendMessage(chatId, `❌ Ошибка: ${err.message}`);
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
              `💡 Параметры 2026: Moms +25%, AM-bidrag 8%, Fradrag 16.123 kr./мес., B-skat 36%!`;
  await sendMessage(chatId, msg);
}
