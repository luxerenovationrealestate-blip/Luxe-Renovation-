const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    })
  });
}

const db = admin.firestore();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_ID = String(process.env.ALLOWED_CHAT_ID || "8669097831");

async function sendTelegramMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Luxe Accountant Bot is Running');
  }

  const update = req.body;
  if (!update || !update.message) {
    return res.status(200).send('OK');
  }

  const msg = update.message;
  const chatId = String(msg.chat.id);

  if (chatId !== ALLOWED_CHAT_ID) {
    await sendTelegramMessage(chatId, '⛔ Доступ запрещен.');
    return res.status(200).send('Forbidden');
  }

  const text = (msg.text || msg.caption || '').trim();

  if (text === '/start' || text === '/help') {
    const welcome = `🤖 *Привет! Я ваш личный бухгалтер Luxe Renovation.*\n\n` +
      `Просто пишите мне траты или доходы в свободной форме:\n` +
      `• \`450 материалы Flügger\`\n` +
      `• \`1200 инструмент Аренда\`\n` +
      `• \`8000 аванс за фасад\` (доход)\n` +
      `• \`/report\` — отчёт за текущий месяц\n` +
      `• \`/moms\` — справка по датскому НДС (Moms)`;
    await sendTelegramMessage(chatId, welcome);
    return res.status(200).send('OK');
  }

  if (text === '/report' || text === '/balance') {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const expSnap = await db.collection('expenses').get();
    let expTotal = 0;
    expSnap.forEach(doc => {
      const d = doc.data();
      if (d.date && d.date.startsWith(currentMonth)) {
        expTotal += Number(d.amount || 0);
      }
    });

    const incSnap = await db.collection('incomes').get();
    let incTotal = 0;
    incSnap.forEach(doc => {
      const d = doc.data();
      if (d.date && d.date.startsWith(currentMonth)) {
        incTotal += Number(d.amount || 0);
      }
    });

    const clientSnap = await db.collection('clients').get();
    clientSnap.forEach(doc => {
      const c = doc.data();
      if (c.created) {
        const dStr = new Date(c.created).toISOString().substring(0, 7);
        if (dStr === currentMonth && (c.status === 'Завершен' || c.status === 'Оплачен')) {
          incTotal += Number(c.amount || 0);
        }
      }
    });

    const net = incTotal - expTotal;
    const reportText = `📊 *Финансовый отчет за ${currentMonth}:*\n\n` +
      `🟢 *Доходы:* ${incTotal.toLocaleString()} DKK\n` +
      `🔴 *Расходы:* ${expTotal.toLocaleString()} DKK\n` +
      `💰 *Чистая прибыль:* *${net.toLocaleString()} DKK*`;

    await sendTelegramMessage(chatId, reportText);
    return res.status(200).send('OK');
  }

  if (text === '/moms') {
    await sendTelegramMessage(chatId, `🇩🇰 *Напоминание о Moms (НДС в Дании):*\nОтчетность по Moms сдается каждые 6 месяцев (или 3 месяца для CVR). Не забудьте проверить сохранность всех чеков в панели \`finance.html\`!`);
    return res.status(200).send('OK');
  }

  const match = text.match(/^(\d+)\s+(.+)$/);
  if (match) {
    const amount = Number(match[1]);
    const details = match[2];
    const isIncome = details.toLowerCase().includes('доход') || details.toLowerCase().includes('аванс') || details.toLowerCase().includes('оплата');

    const todayStr = new Date().toISOString().substring(0, 10);

    if (isIncome) {
      await db.collection('incomes').add({
        title: details,
        amount: amount,
        date: todayStr,
        created: Date.now()
      });
      await sendTelegramMessage(chatId, `✅ *Записан ДОХОД:* +${amount.toLocaleString()} DKK\nОписание: ${details}`);
    } else {
      let cat = 'Прочее';
      const dLower = details.toLowerCase();
      if (dLower.includes('мат') || dLower.includes('краск') || dLower.includes('гипс') || dLower.includes('плит')) cat = 'Материалы';
      else if (dLower.includes('инструмент') || dLower.includes('аренд')) cat = 'Инструмент';
      else if (dLower.includes('топливо') || dLower.includes('бензин') || dLower.includes('дизель') || dLower.includes('транспорт')) cat = 'Транспорт';
      else if (dLower.includes('субподряд') || dLower.includes('работа')) cat = 'Субподряд';

      await db.collection('expenses').add({
        title: details,
        amount: amount,
        cat: cat,
        date: todayStr,
        created: Date.now()
      });
      await sendTelegramMessage(chatId, `✅ *Записан РАСХОД:* -${amount.toLocaleString()} DKK\nКатегория: *${cat}*\nОписание: ${details}`);
    }
    return res.status(200).send('OK');
  }

  await sendTelegramMessage(chatId, `💡 *Не понял команду.* Введите сумму и описание, например:\n\`450 материалы краска\` или \`8000 аванс доход\``);
  return res.status(200).send('OK');
};

