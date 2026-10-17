import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf, Context } from 'telegraf';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleCalendarService, CalendarEvent } from '../google-calendar/google-calendar.service';

export interface ReminderSettings {
  dailySummaryTime: string; // Format: "HH:mm" (e.g. "07:00")
  dailySummaryEnabled: boolean;
  lastSummarySentDate?: string; // "YYYY-MM-DD"
  chatIds: number[];
}

@Injectable()
export class ReminderService implements OnModuleInit {
  private readonly logger = new Logger(ReminderService.name);
  private chatIds: Set<number> = new Set();
  private notifiedEvents: Set<string> = new Set();
  private dailySummaryTime = '07:00';
  private dailySummaryEnabled = true;
  private lastSummarySentDate = '';
  private readonly settingsFilePath = path.resolve(process.cwd(), 'data', 'reminder-settings.json');

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly calendarService: GoogleCalendarService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.logger.log('🔔 Reminder service initialized');
    this.loadSettings();

    // Capture chat IDs for reminders
    this.bot.on('message', (ctx, next) => {
      if (ctx.chat) {
        this.addChatId(ctx.chat.id);
      }
      return next();
    });
  }

  /**
   * Load settings from JSON file
   */
  private loadSettings() {
    try {
      if (fs.existsSync(this.settingsFilePath)) {
        const raw = fs.readFileSync(this.settingsFilePath, 'utf8');
        const data: ReminderSettings = JSON.parse(raw);
        if (data.dailySummaryTime) this.dailySummaryTime = data.dailySummaryTime;
        if (data.dailySummaryEnabled !== undefined) this.dailySummaryEnabled = data.dailySummaryEnabled;
        if (data.lastSummarySentDate) this.lastSummarySentDate = data.lastSummarySentDate;
        if (Array.isArray(data.chatIds)) {
          data.chatIds.forEach((id) => this.chatIds.add(id));
        }
        this.logger.log(
          `⚙️ Loaded reminder settings: time=${this.dailySummaryTime}, enabled=${this.dailySummaryEnabled}, chats=${this.chatIds.size}`,
        );
      }
    } catch (err) {
      this.logger.error('Failed to load reminder settings:', err);
    }
  }

  /**
   * Save settings to JSON file
   */
  private saveSettings() {
    try {
      const dir = path.dirname(this.settingsFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: ReminderSettings = {
        dailySummaryTime: this.dailySummaryTime,
        dailySummaryEnabled: this.dailySummaryEnabled,
        lastSummarySentDate: this.lastSummarySentDate,
        chatIds: Array.from(this.chatIds),
      };
      fs.writeFileSync(this.settingsFilePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      this.logger.error('Failed to save reminder settings:', err);
    }
  }

  /**
   * Register a chat ID for receiving reminders
   */
  addChatId(chatId: number) {
    if (!this.chatIds.has(chatId)) {
      this.chatIds.add(chatId);
      this.saveSettings();
    }
  }

  /**
   * Get current daily summary time (e.g. "07:00")
   */
  getDailySummaryTime(): string {
    return this.dailySummaryTime;
  }

  /**
   * Check if daily summary is enabled
   */
  isDailySummaryEnabled(): boolean {
    return this.dailySummaryEnabled;
  }

  /**
   * Toggle daily summary on/off
   */
  toggleDailySummary(): boolean {
    this.dailySummaryEnabled = !this.dailySummaryEnabled;
    this.saveSettings();
    return this.dailySummaryEnabled;
  }

  /**
   * Set daily summary enabled state directly
   */
  setDailySummaryEnabled(enabled: boolean) {
    this.dailySummaryEnabled = enabled;
    this.saveSettings();
  }

  /**
   * Normalize and set daily summary time
   * Supports: "08:00", "8:30", "8h", "8h30", "19:00", "7h tối"
   */
  setDailySummaryTime(timeInput: string): string | null {
    const clean = timeInput.trim().toLowerCase();

    let hour = -1;
    let minute = 0;

    // Pattern 1: "8h30", "08h30", "8h", "14h"
    const hMatch = clean.match(/^(\d{1,2})h(\d{1,2})?$/i);
    if (hMatch) {
      hour = parseInt(hMatch[1], 10);
      minute = hMatch[2] ? parseInt(hMatch[2], 10) : 0;
    } else {
      // Pattern 2: "08:00", "8:30", "19:45"
      const colonMatch = clean.match(/^(\d{1,2})[:\.](\d{1,2})$/);
      if (colonMatch) {
        hour = parseInt(colonMatch[1], 10);
        minute = parseInt(colonMatch[2], 10);
      } else {
        // Pattern 3: single number "8", "19"
        const singleMatch = clean.match(/^(\d{1,2})$/);
        if (singleMatch) {
          hour = parseInt(singleMatch[1], 10);
          minute = 0;
        }
      }
    }

    // Check period (sáng / chiều / tối)
    if (/chiều|tối/i.test(clean) && hour < 12 && hour !== -1) {
      hour += 12;
    }

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      const formatted = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      this.dailySummaryTime = formatted;
      this.dailySummaryEnabled = true;
      this.saveSettings();
      this.logger.log(`⏰ Updated daily summary time to: ${formatted}`);
      return formatted;
    }

    return null;
  }

  /**
   * Check for upcoming events every minute and trigger daily summary
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleMinuteChecks() {
    await this.checkUpcomingEvents();
    await this.checkDailySummaryTime();
  }

  /**
   * Check upcoming events in 15min and now
   */
  private escapeHtml(text: string): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Check upcoming events in 15min and now
   */
  async checkUpcomingEvents() {
    if (!this.calendarService.isReady()) return;
    if (this.chatIds.size === 0) return;

    try {
      const now = new Date();
      const in15min = new Date(now.getTime() + 15 * 60 * 1000);
      const in16min = new Date(now.getTime() + 16 * 60 * 1000);

      // Look for events starting in the next 15-16 minutes
      const events = await this.calendarService.getEventsInRange(in15min, in16min);

      for (const event of events) {
        const eventKey = `${event.id}-${event.startTime}`;
        if (this.notifiedEvents.has(eventKey)) continue;

        this.notifiedEvents.add(eventKey);

        const message = this.formatReminder(event);
        for (const chatId of this.chatIds) {
          try {
            await this.bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
          } catch (error) {
            this.logger.error(`Failed to send reminder to chat ${chatId}:`, error);
          }
        }

        this.logger.log(`🔔 Sent reminder for: ${event.summary}`);
      }

      // Check for events starting RIGHT NOW (0-1 minute window)
      const in1min = new Date(now.getTime() + 60 * 1000);
      const startingNow = await this.calendarService.getEventsInRange(now, in1min);

      for (const event of startingNow) {
        const eventKey = `${event.id}-${event.startTime}-now`;
        if (this.notifiedEvents.has(eventKey)) continue;

        this.notifiedEvents.add(eventKey);

        const message =
          `🚨 <b>SỰ KIỆN BẮT ĐẦU NGAY BÂY GIỜ!</b>\n\n` +
          `📌 <b>${this.escapeHtml(event.summary)}</b>\n` +
          (event.location ? `📍 ${this.escapeHtml(event.location)}\n` : '') +
          (event.description ? `📝 ${this.escapeHtml(event.description)}\n` : '');

        for (const chatId of this.chatIds) {
          try {
            await this.bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
          } catch (error) {
            this.logger.error(`Failed to send now-reminder to chat ${chatId}:`, error);
          }
        }
      }
    } catch (error) {
      this.logger.error('Error checking upcoming events for reminders:', error);
    }
  }

  /**
   * Check if current time matches configured daily summary time
   */
  async checkDailySummaryTime() {
    if (!this.dailySummaryEnabled) return;
    if (!this.calendarService.isReady()) return;
    if (this.chatIds.size === 0) return;

    try {
      const now = new Date();
      const timeZone = this.configService.get<string>('TIMEZONE') || 'Asia/Ho_Chi_Minh';
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour12: false,
      }).formatToParts(now);

      const hour = parts.find((p) => p.type === 'hour')?.value || '00';
      const minute = parts.find((p) => p.type === 'minute')?.value || '00';
      const currentHHmm = `${hour}:${minute}`;

      const day = parts.find((p) => p.type === 'day')?.value || '01';
      const month = parts.find((p) => p.type === 'month')?.value || '01';
      const year = parts.find((p) => p.type === 'year')?.value || '2026';
      const todayDateStr = `${year}-${month}-${day}`;

      if (currentHHmm === this.dailySummaryTime && this.lastSummarySentDate !== todayDateStr) {
        this.lastSummarySentDate = todayDateStr;
        this.saveSettings();
        this.logger.log(`⏰ Triggering daily summary at ${currentHHmm} for ${todayDateStr}`);
        await this.sendDailySummary();
      }
    } catch (error) {
      this.logger.error('Error in checkDailySummaryTime:', error);
    }
  }

  /**
   * Clean up old notified events (every hour)
   */
  @Cron(CronExpression.EVERY_HOUR)
  cleanupNotifiedEvents() {
    if (this.notifiedEvents.size > 1000) {
      this.notifiedEvents.clear();
      this.logger.log('🧹 Cleared notified events cache');
    }
  }

  /**
   * Send daily summary message (to specific chatId or all registered chats)
   */
  async sendDailySummary(targetChatId?: number) {
    if (!this.calendarService.isReady()) return;

    try {
      const events = await this.calendarService.getTodayEvents();
      const today = new Date().toLocaleDateString('vi-VN', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Asia/Ho_Chi_Minh',
      });

      let message: string;
      if (events.length === 0) {
        message = `☀️ <b>Chào buổi sáng!</b>\n\n📅 ${this.escapeHtml(today)}\n\n📭 Hôm nay bạn không có sự kiện nào. Chúc bạn một ngày làm việc tuyệt vời! 🎉`;
      } else {
        message = `☀️ <b>Chào buổi sáng!</b>\n\n📅 <b>Lịch hôm nay — ${this.escapeHtml(today)}:</b>\n\n`;
        events.forEach((event, index) => {
          const startTime = new Date(event.startTime).toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Ho_Chi_Minh',
          });
          const endTime = new Date(event.endTime).toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Ho_Chi_Minh',
          });
          message += `<b>${index + 1}.</b> 📌 <b>${this.escapeHtml(event.summary)}</b>\n`;
          message += `   🕐 ${startTime} → ${endTime}\n`;
          if (event.location) message += `   📍 ${this.escapeHtml(event.location)}\n`;
          message += '\n';
        });
        message += `📊 Tổng cộng: <b>${events.length}</b> sự kiện`;
      }

      const recipients = targetChatId ? [targetChatId] : Array.from(this.chatIds);
      for (const chatId of recipients) {
        try {
          await this.bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
        } catch (error) {
          this.logger.error(`Failed to send daily summary to chat ${chatId}:`, error);
        }
      }

      this.logger.log(`📨 Sent daily summary to ${recipients.length} chat(s)`);
    } catch (error) {
      this.logger.error('Error sending daily summary:', error);
    }
  }

  /**
   * Format a reminder message
   */
  private formatReminder(event: CalendarEvent): string {
    const startTime = new Date(event.startTime).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    let message = `🔔 <b>NHẮC NHỞ — Còn 15 phút!</b>\n\n`;
    message += `📌 <b>${this.escapeHtml(event.summary)}</b>\n`;
    message += `🕐 Bắt đầu lúc: <b>${startTime}</b>\n`;
    if (event.location) {
      message += `📍 ${this.escapeHtml(event.location)}\n`;
    }
    if (event.description) {
      message += `📝 <i>${this.escapeHtml(event.description)}</i>\n`;
    }

    return message;
  }
}
