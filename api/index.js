const { Telegraf } = require('telegraf');
const { OpenAI } = require('openai');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const openai = new OpenAI({
  apiKey: process.env.POLZA_API_KEY,
  baseURL: 'https://polza.ai/api/v1',
});

const AI_MODEL = process.env.AI_MODEL || 'google/gemini-2.0-flash-lite-001';
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;

const chatHistory = new Map();
const MAX_HISTORY = 20;

const SYSTEM_PROMPT = `
Ты — ведущий эксперт-дизайнер компании "DHBot". Твоя специализация: ТОЛЬКО кухни, мебель и дизайн интерьера.

ТВОИ ПРАВИЛА:
1. ФОКУС НА ТЕМЕ: Ты отвечаешь только на вопросы о кухнях, материалах, фурнитуре и интерьере. Если клиент спрашивает о чем-то другом (политика, наука, общие вопросы, не связанные с мебелью) — вежливо отвечай, что ты эксперт только в области кухонь, и возвращайся к текущему вопросу анкеты.
2. ОТВЕТЫ НА ВОПРОСЫ: В рамках своей темы ты эксперт. Если клиент задает вопрос по теме — отвечай профессионально.
3. ГИБКИЙ СЦЕНАРИЙ: После любого ответа или консультации ты обязан вернуть клиента к опросу.

ВОПРОСЫ ДЛЯ КВАЛИФИКАЦИИ (задавай по одному):
1. Форма кухни (угловая, прямая, с островом?)
2. Размеры или метраж.
3. Стиль (минимализм, сканди, классика?)
4. Желаемая дата установки.
5. Контактный номер телефона.

ПРАВИЛА ОФОРМЛЕНИЯ:
- Когда собраны ВСЕ 5 ПУНКТОВ, ответь СТРОГО этой фразой: "Спасибо за предоставленную информацию! Я передаю эти данные нашему технологу, который сделает расчет стоимости и свяжется с вами в ближайшее время."
- В самом конце этого сообщения добавь технический тег: [FINISH]
- Не называй цену "с потолка", говори что расчет сделает технолог.
`;

bot.start((ctx) => {
  chatHistory.delete(ctx.chat.id);
  ctx.reply('Здравствуйте! Я помогу вам рассчитать стоимость вашей идеальной кухни. Подскажите, какая форма кухни вам нравится: угловая, прямая или, может быть, с островом?');
});

bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  const userText = ctx.message.text;

  if (!chatHistory.has(chatId)) {
    chatHistory.set(chatId, [{ role: 'system', content: SYSTEM_PROMPT }]);
  }

  const history = chatHistory.get(chatId);
  history.push({ role: 'user', content: userText });

  try {
    await ctx.sendChatAction('typing');

    const completion = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: history,
    });

    let botResponse = completion.choices[0].message.content;

    // Если опрос завершен
    if (botResponse.includes('[FINISH]')) {
      const finalCleanMessage = botResponse.replace('[FINISH]', '').trim();
      await ctx.reply(finalCleanMessage); // 1. Шлем вежливое прощание

      // 2. Генерируем анкету (чистые данные)
      const summaryGen = await openai.chat.completions.create({
        model: AI_MODEL,
        messages: [
          ...history,
          { role: 'system', content: 'СОСТАВЬ ТЕХНИЧЕСКУЮ АНКЕТУ. Напиши ТОЛЬКО список: 1. Форма, 2. Размеры, 3. Стиль, 4. Дата, 5. Номер. Без приветствий и лишних слов.' }
        ],
      });

      const summary = summaryGen.choices[0].message.content;
      const userInfo = `\n👤 Клиент: @${ctx.from.username || 'n/a'}\n🆔 ID: ${ctx.from.id}`;
      const managerReport = "🚀 НОВЫЙ ЛИД!\n\n" + summary + userInfo;

      // 3. Показываем анкету пользователю
      await ctx.reply('✅ Опрос завершен! Вот какое уведомление мгновенно пришло менеджеру в CRM/Telegram:');
      await ctx.reply(managerReport);

      // 4. Шлем менеджеру
      if (OWNER_CHAT_ID) {
        await bot.telegram.sendMessage(OWNER_CHAT_ID, managerReport);
      }
      
      chatHistory.delete(chatId); // Очищаем историю после завершения
      return;
    }

    history.push({ role: 'assistant', content: botResponse });
    await ctx.reply(botResponse);

  } catch (error) {
    console.error('Bot Error:', error);
    ctx.reply('Извините, я немного задумался. Попробуйте еще раз.');
  }
});

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } else {
    res.status(200).send('Бот активен!');
  }
};
