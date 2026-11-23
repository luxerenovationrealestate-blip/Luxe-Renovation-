import fetch from 'node-fetch';
import FormData from 'form-data';

const PROJECT_ID = 'luxe-renovation-72e1a';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPEN_KEY || process.env.OPENAI_API_KEY;

function fmt(num) {
  return Number(num || 0).toLocaleString('da-DK', { maximumFractionDigits: 2 });
}

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

// 2. Умный мульти-анализ текста через GPT-4o-mini (разделение доходов и расходов + категории)
async function parseMultipleTransactions(text) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: `Ты финансовый контролёр строительной компании Luxe Renovation (Дания).
Твоя главная задача — безошибочно разделять ДОХОДЫ и РАСХОДЫ в сообщении пользователя (в одном сообщении может быть сразу несколько разных операций).

ПРАВИЛА КЛАССИФИКАЦИИ:
1. "income" (ДОХОД):
   - Деньги, которые ПОЛУЧИЛА компания или выставила клиенту: "фактура", "счёт клиенту", "оплата от заказчика", "пришло", "зашло", "получил", "перевели за работу", "аванс от клиента", знак "+" перед суммой.
   - Категория для income всегда: "Доход с объекта".

2. "expense" (РАСХОД):
   - Деньги, которые ПОТРАТИЛА компания: "купил", "закупка", "чек", "оплатил", "потратил", "бензин", "дизель", "парковка", "материалы", "краска", "шпаклёвка", "инструмент", "аренда", "выдал аванс рабочему/сотруднику", "зарплата", знак "-" перед суммой.
   - Если слово "аванс" без уточнения, что это от клиента (например, просто "аванс 2000" или "дал аванс"), в строительной бригаде это выдача аванса работнику -> "expense". Если "аванс от клиента / за объект" -> "income".
   - Подбери точную категорию для expense строго из списка: "Материалы", "Инструмент", "Транспорт", "Субподряд", "Прочее".

Верни строго JSON-объект формата:
{
  "transactions": [
    {
      "type": "income" | "expense",
      "title": "Короткое чистое описание",
      "amount": 100000,
      "category": "Доход с объекта" | "Материалы" | "Инструмент" | "Транспорт" | "Субподряд" | "Прочее"
    }
  ]
}`
        },
        { role: 'user', content: text }
      ],
      max_tokens: 400
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Ошибка AI парсинга');

  const content = data.choices[0].message.content.trim();
  const parsed = JSON.parse(content);
  return Array.isArray(parsed.transactions) ? parsed.transactions : [];
}

// 3. Умный анализ изображения (чек из магазина vs фактура/входящий перевод)
async function analyzeImage(imageUrl) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Проанализируй изображение для бухгалтерии строительной компании Luxe Renovation:
- Если это кассовый чек, квитанция из магазина (STARK, Bauhaus, Silvan, Jem & fix, Circle K, Netto и т.д.) или счёт на оплату материалов/топлива — это "expense".
- Если это скриншот входящего банковского перевода на счёт Luxe Renovation или исходящая фактура от Luxe Renovation клиенту — это "income" (бери сумму без Moms, если указана разбивка).

Верни строго JSON-объект:
{
  "transactions": [
    {
      "type": "expense" | "income",
      "title": "Название магазина или суть платежа",
      "amount": число,
      "category": "Доход с объекта" | "Материалы" | "Инструмент" | "Транспорт" | "Субподряд" | "Прочее"
    }
  ]
}`
            },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ],
      max_tokens: 250
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Ошибка Vision API');

  const content = data.choices[0].message.content.trim();
  const parsed = JSON.parse(content);
  return Array.isArray(parsed.transactions) ? parsed.transactions : [];
}

// 4. Сохранение транзакции в Firestore (раздельные коллекции incomes и expenses)
async function saveTransaction(chatId, rawType, amount, title, category = '', receiptUrl = '') {
  if (isNaN(amount) || amount <= 0 || amount > 2000000) return false;

  // Дополнительная страховка по знакам + / -
  let type = rawType === 'income' ? 'income' : 'expense';
  const trimmedTitle = String(title || '').trim();
  if (trimmedTitle.startsWith('+')) type = 'income';
  if (trimmedTitle.startsWith('-')) type = 'expense';

  const allowedExpenseCats = ['Материалы', 'Инструмент', 'Транспорт', 'Субподряд', 'Прочее'];
  const finalCategory = type === 'income'
    ? 'Доход с объекта'
    : (allowedExpenseCats.includes(category) ? category : 'Прочее');

  const momsAmount = type === 'income' ? Math.round(amount * 0.25 * 100) / 100 : 0;
  const grossAmount = type === 'income' ? Math.round((amount + momsAmount) * 100) / 100 : amount;

  const collectionName = type === 'income' ? 'incomes' : 'expenses';
  const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionName}`;

  const firestoreBody = {
    fields: {
      amount: { doubleValue: amount },
      title: { stringValue: trimmedTitle.replace(/^[+-]\s*/, '') },
      cat: { stringValue: finalCategory },
      date: { stringValue: new Date().toISOString().substring(0, 10) },
      created: { stringValue: Date.now().toString() },
      chatId: { stringValue: chatId.toString() },
      receipt: { stringValue: receiptUrl },
      moms: { doubleValue: momsAmount },
      grossAmount: { doubleValue: grossAmount }
    }
  };

  const dbResponse = await fetch(firestoreUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(firestoreBody)
  });

  if (dbResponse.ok) {
    const cleanTitle = trimmedTitle.replace(/^[+-]\s*/, '');
    if (type === 'income') {
      await sendMessage(
        chatId,
        `🟢 **ДОХОД зафиксирован:** — ${cleanTitle}\n` +
        `💵 *Чистая сумма в фактуру:* ${fmt(amount)} DKK\n` +
        `🧾 *Доп. Moms (+25%):* +${fmt(momsAmount)} DKK\n` +
        `💰 *Итого с Moms (+25%):* **${fmt(grossAmount)} DKK**`
      );
    } else {
      await sendMessage(
        chatId,
        `🔴 **РАСХОД записан:** — ${cleanTitle}\n` +
        `📂 *Категория:* ${finalCategory}\n` +
        `💸 *Сумма:* -${fmt(amount)} DKK`
      );
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
              await saveTransaction(chatId, item.type, Number(item.amount), item.title || text, item.category);
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
              await saveTransaction(chatId, item.type, Number(item.amount), item.title || 'Чек/Документ', item.category, fileUrl);
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
        await sendMessage(
          chatId,
          `🤖 Бот **Luxe Renovation** на связи!\nВаш Chat ID: \`${chatId}\`\n\n📌 Возможности:\n• /moms — график сдачи и уплаты Moms\n• Текст или голос: «Выставил фактуру 100000, купил краску 1500, бензин 400» — бот сам разделит доходы и расходы по категориям\n• Фото чеков и скриншоты переводов`
        );
        return res.status(200).json({ ok: true });
      }

      if (lowerText === '/moms' || lowerText.includes('moms') || lowerText.includes('налог')) {
        await sendMomsInfo(chatId);
        return res.status(200).json({ ok: true });
      }

      try {
        const items = await parseMultipleTransactions(text);
        if (Array.isArray(items) && items.length > 0) {
          for (const item of items) {
            await saveTransaction(chatId, item.type, Number(item.amount), item.title || text, item.category);
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
  const msg =
    `🇩🇰 **График уплаты Moms (Skattestyrelsen):**\n\n` +
    `🏢 **Luxe Renovation (CVR: 46769074)**\n` +
    `📍 Lyngbyvej 83A, 2100 København Ø\n\n` +
    `🔹 **Q1 (Январь — Март):** Сдача и уплата до **1 июня**\n` +
    `🔹 **Q2 (Апрель — Июнь):** Сдача и уплата до **1 сентября**\n` +
    `🔹 **Q3 (Июль — Сентябрь):** Сдача и уплата до **1 декабря**\n` +
    `🔹 **Q4 (Октябрь — Декабрь):** Сдача и уплата до **1 марта**\n\n` +
    `💡 К чистой сумме в фактуру автоматически добавляется **+25% Moms**.`;
  await sendMessage(chatId, msg);
}
