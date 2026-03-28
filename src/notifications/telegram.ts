import TelegramBot from 'node-telegram-bot-api';

let bot: TelegramBot | null = null;

function getBot(): TelegramBot | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  if (!bot) {
    bot = new TelegramBot(token, { polling: false });
  }
  return bot;
}

export async function sendTelegram(message: string): Promise<void> {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const instance = getBot();

  if (!instance || !chatId) {
    console.log(`[Telegram] (not configured) ${message}`);
    return;
  }

  try {
    await instance.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch {
    // Retry without markdown in case of formatting errors
    try {
      await instance.sendMessage(chatId, message);
    } catch (err2) {
      console.error('[Telegram] Failed to send message:', (err2 as Error).message);
    }
  }
}
