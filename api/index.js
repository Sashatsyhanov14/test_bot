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
Ты — экспертный ИИ-ассистент компании по производству кухонь "DHBot".
Твоя задача: собрать данные клиента за 5 шагов.

СЦЕНАРИЙ ВОПРОСОВ (задавай по одному!):
1. Форма кухни (угловая, прямая или с островом?)
2. Размеры или метраж кухни.
3. Стиль кухни (минимализм, скандинавский, классика или свой вариант?)
4. Желаемая дата установки.
5. Контактный номер телефона.

ПРАВИЛА:
- После каждого ответа клиента давай короткий "экспертный" комментарий.
- Если спрашивают цену, отвечай, что расчет сделает технолог после получения всех деталей.
- Когда собраны ВСЕ 5 ПУНКТОВ, ответь СТРОГО этой фразой: "Спасибо за предоставленную информацию! Я передаю эти данные нашему технологу, который сделает расчет стоимости и свяжется с вами в ближайшее время."
- В конце этого финального сообщения ОБЯЗАТЕЛЬНО добавь: [LEAD_COMPLETED]

ИНСТРУКЦИЯ ПО ОТЧЕТУ:
Когда увидишь [LEAD_COMPLETED], сформируй анкету в формате:
1. Форма: ...
2. Размеры: ...
3. Стиль: ...
4. Дата: ...
5. Номер: ...
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

    if (botResponse.includes('[LEAD_COMPLETED]')) {
      botResponse = botResponse.replace('[LEAD_COMPLETED]', '').trim();
      
      const summaryPrompt = [
        ...history,
        { role: 'system', content: 'Сформируй анкету строго по пунктам: 1. Форма, 2. Размеры, 3. Стиль, 4. Дата, 5. Номер.' }
      ];
      
      const summaryGen = await openai.chat.completions.create({
        model: AI_MODEL,
        messages: summaryPrompt,
      });

      const summary = summaryGen.choices[0].message.content;
      const userInfo = `\n\n👤 Клиент: @${ctx.from.username || 'n/a'}\n🆔 ID: ${ctx.from.id}`;
      const finalReport = "🚀 НОВЫЙ ЛИД!\n" + summary + userInfo;

      await ctx.reply(botResponse); // Отправляем финальную фразу
      await ctx.reply('✅ Опрос завершен! Вот какое уведомление мгновенно пришло менеджеру в CRM/Telegram:');
      await ctx.reply(finalReport);

      if (OWNER_CHAT_ID) {
        await bot.telegram.sendMessage(OWNER_CHAT_ID, finalReport);
      }
      return;
    }

    history.push({ role: 'assistant', content: botResponse });
    await ctx.reply(botResponse);

  } catch (error) {
    console.error('Bot Error:', error);
    ctx.reply('Извините, я немного задумался. Повторите, пожалуйста, ваш последний ответ.');
  }
});

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } else {
    res.status(200).send('Бот квалификации активен!');
  }
};
