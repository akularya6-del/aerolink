import TelegramBot from 'node-telegram-bot-api';
import pc from 'picocolors';
import { KeyManager } from '../manager/KeyManager.js';

export class TelegramNotifier {
  private bot: TelegramBot | null = null;
  private chatId: string | null = null;
  private initialized = false;
  private keyManager: KeyManager | null = null;
  private checkInterval: NodeJS.Timeout | null = null;

  public init(manager?: KeyManager) {
    if (this.initialized) return;
    this.initialized = true;
    if (manager) this.keyManager = manager;
    
    const token = process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = process.env.TELEGRAM_CHAT_ID || null;

    if (token && this.chatId) {
      try {
        // Enable polling to listen for commands
        this.bot = new TelegramBot(token, { polling: true });
        console.log(pc.cyan(`[Telegram] Integration initialized for chat ${this.chatId} (Polling enabled)`));
        
        this.setupCommands();
      } catch (err: any) {
        console.error(pc.red(`[Telegram] Failed to initialize bot: ${err.message}`));
      }
    } else {
      console.log(pc.yellow(`[Telegram] Skipping integration (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing in .env)`));
    }
  }

  private setupCommands() {
    if (!this.bot) return;

    this.bot.onText(/^\/start$/, (msg) => {
      if (msg.chat.id.toString() !== this.chatId) return;
      
      this.sendMessage('▶️ <b>Automated Key Checker Started</b>\n\nI will now test all keys every 30 minutes and send you a report.', false);
      this.startChecker();
    });

    this.bot.onText(/^\/stop$/, (msg) => {
      if (msg.chat.id.toString() !== this.chatId) return;
      
      this.sendMessage('⏹️ <b>Automated Key Checker Stopped</b>\n\nI will no longer run automated tests. You can still test manually from the dashboard.', false);
      this.stopChecker();
    });
  }

  private startChecker() {
    this.stopChecker();
    // 30 minutes in milliseconds
    const INTERVAL_MS = 30 * 60 * 1000;
    
    this.checkInterval = setInterval(async () => {
      if (!this.keyManager) return;
      try {
        const { summary, results } = await this.keyManager.testAllKeys();
        await this.alertTestResults(summary.working, summary.failed, results, true);
      } catch (err: any) {
        console.error(pc.red(`[Telegram] Scheduled test failed: ${err.message}`));
      }
    }, INTERVAL_MS);
  }

  private stopChecker() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  public async sendMessage(message: string, isError = false): Promise<void> {
    if (!this.bot || !this.chatId) return;

    try {
      await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }
      });
    } catch (err: any) {
      console.error(pc.red(`[Telegram] Failed to send message: ${err.message}`));
    }
  }

  public async alertKeyFailure(keyId: string, reason: string, isRateLimit = false): Promise<void> {
    const icon = isRateLimit ? '⏳' : '🚨';
    const msg = `<b>${icon} Key Failure: ${keyId}</b>\n\nReason: <code>${reason}</code>\nAction: Placed on cooldown.`;
    await this.sendMessage(msg, true);
  }

  public async alertTestResults(working: number, failed: number, details: Array<{id: string, status: string, message?: string}>, isAutomated = false): Promise<void> {
    const icon = failed === 0 ? '✅' : (working === 0 ? '❌' : '⚠️');
    let msg = `<b>${icon} ${isAutomated ? 'Automated' : 'Manual'} Key Test Results</b>\n\n`;
    msg += `<b>Working:</b> ${working}\n`;
    msg += `<b>Failed:</b> ${failed}\n\n`;
    
    // Include up to 5 failures in the message to avoid super long texts
    const failingKeys = details.filter(d => d.status === 'error');
    if (failingKeys.length > 0) {
      msg += `<b>Failing Keys:</b>\n`;
      failingKeys.slice(0, 5).forEach(k => {
        msg += `❌ <b>${k.id}</b>: <code>${k.message ? k.message.replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Unknown error'}</code>\n`;
      });
      if (failingKeys.length > 5) {
        msg += `- <i>...and ${failingKeys.length - 5} more</i>\n`;
      }
    }

    await this.sendMessage(msg);
  }
}

// Export a singleton instance
export const telegramNotifier = new TelegramNotifier();
