// Сохранение транзакции в Firestore
async function saveTransaction(chatId, type, amount, title, receiptUrl = '') {
  if (isNaN(amount) || amount <= 0 || amount > 500000) return false;

  // 100.000 DKK — ваш чистый доход (Netto)
  const momsAmount = type === 'income' ? Math.round(amount * 0.25 * 100) / 100 : 0; // +25% Moms заказчика
  const grossAmount = type === 'income' ? amount + momsAmount : amount; // 125.000 DKK с заказчика

  // Налоги с вашей суммы (100.000 DKK):
  const amBidrag = type === 'income' ? Math.round(amount * 0.08 * 100) / 100 : 0; // 8% = 8.000 DKK
  const baseForBSkat = amount - amBidrag; // 92.000 DKK
  const bSkat = type === 'income' ? Math.round(baseForBSkat * 0.38 * 100) / 100 : 0; // 38% = 34.960 DKK
  
  const takeHome = type === 'income' ? Math.round((baseForBSkat - bSkat) * 100) / 100 : 0; // 57.040 DKK

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
        `🟢 **Доход зафиксирован:**\n💰 +${amount.toLocaleString()} DKK (Ваша цена) — ${title}\n` +
        `🧾 *Чек заказчику (+25% Moms):* ${grossAmount.toLocaleString()} DKK\n\n` +
        `📊 *Налоги с ваших ${amount.toLocaleString()} DKK:*\n` +
        `• Moms заказчика в Skat: ~${momsAmount.toLocaleString()} DKK\n` +
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
