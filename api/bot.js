import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fetch from 'node-fetch';

let db = null;

try {
  if (!getApps().length) {
    const serviceAccount = {
      "type": "service_account",
      "project_id": "luxe-renovation-72e1a",
      "private_key_id": "hardcoded_fix",
      "private_key": `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDDJUBp/DyJcoq\nnnncylC4qlZO/Ga1kbCpkxNOofGYjuJ9V1cTSHDBDrUJFKg5IoFp9j/DbznSeprQGNA\nnw9OjCIYNOPlOgZV2EC/n0bGPXhapPoMQZYNDd7HuHDnaEr1HfO5RZoNJLko9TaEc\nNvsjhYevFLUPoCtkjog6uKUDMbqC6TwbPfL4tazcup+cyZv6A0f5l75NhvozbGK\nkNR/XEqxOZ1+LjLj+NQvrRkgtSABL7MxFlGtv4N0ZE1BSCwdb40gtr9zrnWD1FNG\nc8lXIfbfc3Gv/T5SCJgOvZbyihd9TchmqM8z5aTOMtumrcQWARTU9zIMVY6NHI17\nnpcOgG+QDAgMBAAEcggEAMWJOFoGgDx7g/7hmfqgsGUdsm+wqIYUKtQInsF3BL+M\nnnnrl8j3CzMbH+hyFT+0C/TupGXF5fQlFZEOnPzAy4UlfGoG2a5PoAXAQWxQCIEM3\nexndNpZoGoTCRL6vypFV7TiOHbxH70jbxZjZy4TVJSnr/cf6HCIcNQWSe3EM0F4Nx\nA64n7IScwzHcrf8KoMvCJ3ERXMEGvRpT14EnzFK8txmY1m6xF8/JvSrMj5eFT8Qiy\nxIPnCWsUV/TCMwwAEve9Mytpf9rKf3rxCh5tKnxMueGlGFucwBFuLVKyWjEJn48sX\KTsddD3D0F59vGfspfcaZMO5EAYrltAzGPkkzvDgxLmgtcQKBgQDph5PWuhC3S/he\n8Rwnhocfla4YwZI3/YvHcy12f+pnb8BJoKxtegks2FWUPmudvlFbWLHES4zc53YE\nhBXnNrlQid6u9dvuRI8DFwVPeaulAPrUlm+ZB2L5ArSqPorfhMKvdjaFylIFjCfN\nFPntg7i17ZMSGYCa4WP/y134PU8wKBgQDWXI8wOzCfMmPAqGoY1R9DTclvXnm50J\n3BntPsjrgjIoOa7iA8RxR7Vlw3UtfFsQNvXbcB7Smfioa7QKXeYzoT+QaAHNXbwBE\nqnFYShjUBTleWS3+elyByLhn66oRSp6US3kid5IgdirH0lzdEZWx4c1q1oqTe1G\namunSlIfzT24sQKBgf4s05zLakRQ+azC5JQwXDtcLW11YBd4gy8tm8lw4NspB0byf\ndAnMuJhrOY/P4Fw7EbuBuaCaBQ9stDY8AgLxlvT8ZnYOJgQfV8t1wQvXpGg5NO3pe\nGnwPeShH84D7MMY6d4Sgy5/F7VEgHEQDCfBISPYhOsLJzaOtkUMtgxbBurAoGAXB\n6fnQqe84zxUdaardh5nz+FmldBQPQ4UgKFBGlScombD6sS+TRGbfVYSBH2nYL\nDCK4snpb9H6sJ5wZDqO3YCQnECUDytur39rIN2cYFzos52HpUVI1zO/aloEf\najpG1cd65Elng3rvF4uPoeixeH7H8N1Q4usX8vGaho9jCMDyhEcGYEAi3cpFQs\adrEOCpXrBHbCnzpkoLGp9cPLNc37LURruNILxrAP2wTAJFTbIz/qwwCQUEet\nmeG7ymLz/A7LyhjppndaMO9nOZc4mxpTuTGur5I6ECkcQ+ux8KgGiVfDGP9F0ukf\b9MCq/w/R/0PAktV5cn7w3TGLkpz3QmlAvgoCXnx0=\n-----END PRIVATE KEY-----`,
      "client_email": "firebase-adminsdk-fbsvc@luxe-renovation-72e1a.iam.gserviceaccount.com"
    };

    initializeApp({
      credential: cert(serviceAccount)
    });
  }
  db = getFirestore();
} catch (e) {
  console.error('Firebase init error:', e.message);
}

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

          if (db) {
            await db.collection('transactions').add({
              amount: Math.abs(amount),
              type: 'expense',
              description: description,
              date: new Date().toISOString(),
              chatId: chatId.toString()
            });
            await sendMessage(chatId, `✅ Успешно записано в базу:\n💰 ${Math.abs(amount)} DKK — ${description}`);
          } else {
            await sendMessage(chatId, `⚠️ База данных не инициализирована.`);
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
