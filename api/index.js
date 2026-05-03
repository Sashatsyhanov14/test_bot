const { Telegraf } = require('telegraf');
const { OpenAI } = require('openai');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const openai = new OpenAI({
  apiKey: process.env.POLZA_API_KEY,
  baseURL: 'https://polza.ai/api/v1',
});

const AI_MODEL = process.env.AI_MODEL || 'google/gemini-2.0-flash-lite-001';
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID; // Ваш ID для получения лидов

const chatHistory = new Map();
const MAX_HISTORY = 20;

// Системный промпт со всеми вашими правилами
const SYSTEM_PROMPT = `
Ты — экспертный ИИ-ассистент компании по производству кухонь на заказ "DHBot". 
Твоя цель: квалифицировать клиента, следуя четкому сценарию, и вызвать доверие.

ПРАВИЛА ПОВЕДЕНИЯ:
1. МГНОВЕННЫЙ ЗАХВАТ: Отвечай сразу, дружелюбно и профессионально.
2. ОДИН ВОПРОС ЗА РАЗ: Не задавай всё сразу. Веди клиента по очереди:
   - Форма кухни (Угловая, прямая, П-образная?)
   - Размеры или погонные метры.
   - Стиль (Лофт, классика, сканди, минимализм?)
   - Техника (Встроенная или отдельно стоящая?)
   - Сроки (Когда планируете установку?)
3. ЭКСПЕРТНЫЕ КРОШКИ: После каждого ответа клиента давай короткий совет (например: "Отличный выбор, П-образная кухня — это максимум рабочей зоны. Кстати, в ней удобно реализовать 'рабочий треугольник'").
4. ЦЕНА: Если спрашивают цену, отвечай: "Я не называю цену 'с потолка', потому что мы работаем на результат. Мне нужно еще буквально пару деталей, чтобы технолог сделал честный расчет, который не вырастет в процессе".
5. ЗАВЕРШЕНИЕ: Когда узнаешь все 5 пунктов, поблагодари клиента и скажи, что передаешь данные технологу. 

ВАЖНО: Если ты собрал ВСЕ ДАННЫЕ (Форма, Размер, Стиль, Техника, Срок), в конце своего сообщения ОБЯЗАТЕЛЬНО добавь техническую строку: [LEAD_COMPLETED]
`;

bot.start((ctx) => {
  chatHistory.delete(ctx.chat.id); // Сброс при старте
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

    // Проверка на завершение квалификации
    if (botResponse.includes('[LEAD_COMPLETED]')) {
      botResponse = botResponse.replace('[LEAD_COMPLETED]', '').trim();
      
      // Отправка уведомления владельцу
      if (OWNER_CHAT_ID) {
        const summaryPrompt = [
          ...history,
          { role: 'system', content: 'Сформируй краткий отчет для владельца: Кухня (форма, размер), Стиль, Техника, Срок. Формат: "Новый лид! ..."' }
        ];
        
        const summaryGen = await openai.chat.completions.create({
          model: AI_MODEL,
          messages: summaryPrompt,
        });

        const summary = summaryGen.choices[0].message.content;
        
        // Для теста отправляем анкету самому пользователю
        await ctx.reply('✅ Опрос завершен! Вот какая анкета будет приходить владельцу компании:');
        await ctx.reply(summary);
      }
    }

    history.push({ role: 'assistant', content: botResponse });

    // Ограничение истории
    if (history.length > MAX_HISTORY) {
      const systemMsg = history[0];
      const recent = history.slice(-MAX_HISTORY);
      chatHistory.set(chatId, [systemMsg, ...recent]);
    }

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
    res.status(200).send('Бот квалификации кухонь активен!');
  }
};
