import { Update, Ctx, Start, Help, Command, On, Action } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { Logger } from '@nestjs/common';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { BotService } from './bot.service';
import { AiService } from '../ai/ai.service';
import { ReminderService } from '../reminder/reminder.service';
import { ReportService } from '../report/report.service';

@Update()
export class BotUpdate {
  private readonly logger = new Logger(BotUpdate.name);

  constructor(
    private readonly calendarService: GoogleCalendarService,
    private readonly botService: BotService,
    private readonly aiService: AiService,
    private readonly reminderService: ReminderService,
    private readonly reportService: ReportService,
  ) {}

  // =============================================
  //  START & HELP
  // =============================================

  @Start()
  async handleStart(@Ctx() ctx: Context) {
    const firstName = ctx.from?.first_name || 'bạn';
    if (ctx.chat) {
      this.reminderService.addChatId(ctx.chat.id);
      this.reportService.addChatId(ctx.chat.id);
    }
    await ctx.reply(
      `Xin chào ${firstName}! 👋\n\n` +
      `Tôi là <b>Trợ Lý Lịch & Báo Cáo Thông Minh</b>.\n\n` +
      `✨ <b>Các tính năng chính:</b>\n` +
      `• 🧠 <b>Quản lý lịch bằng AI:</b> Phân tích lịch theo Ma trận Eisenhower (Q1, Q2, Q3, Q4) & đánh giá mức độ cân bằng.\n` +
      `• 📅 <b>Quản lý Google Calendar:</b> Xem, thêm, sửa, xóa sự kiện bằng ngôn ngữ tự nhiên.\n` +
      `• 📊 <b>Báo cáo công việc tự động:</b> Tổng hợp doanh thu & chỉ số hàng ngày lúc 15:00.\n\n` +
      `👇 <i>Bấm chọn nút nhanh bên dưới hoặc gõ /help để xem chi tiết:</i>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🧠 Quản lý lịch trình (Eisenhower)', callback_data: 'manage_schedule' },
            ],
            [
              { text: '📅 Lịch hôm nay', callback_data: 'view_today' },
              { text: '🗓️ Lịch tuần này', callback_data: 'view_week' },
            ],
            [
              { text: '📊 Báo cáo vận hành', callback_data: 'trigger_report' },
              { text: '⚙️ Cài đặt', callback_data: 'open_settings' },
            ],
          ],
        },
      },
    );

    // Also send bottom persistent quick-action keyboard
    try {
      await ctx.reply('Bàn phím tác vụ nhanh đã sẵn sàng 👇', {
        reply_markup: {
          keyboard: [
            [{ text: '🧠 Quản lý lịch trình' }, { text: '📅 Lịch hôm nay' }],
            [{ text: '🗓️ Lịch tuần này' }, { text: '📊 Báo cáo' }],
          ],
          resize_keyboard: true,
        },
      });
    } catch {}
  }

  @Help()
  async handleHelp(@Ctx() ctx: Context) {
    await ctx.reply(this.botService.getHelpMessage(), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🧠 Quản lý lịch trình (Eisenhower)', callback_data: 'manage_schedule' },
            { text: '📊 Xem báo cáo', callback_data: 'trigger_report' },
          ],
        ],
      },
    });
  }

  // =============================================
  //  VIEW EVENTS
  // =============================================

  @Command('today')
  async handleToday(@Ctx() ctx: Context) {
    if (!this.checkReady(ctx)) return;

    try {
      await ctx.sendChatAction('typing').catch(() => {});
      const events = await this.calendarService.getTodayEvents();
      const today = new Date().toLocaleDateString('vi-VN', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Asia/Ho_Chi_Minh',
      });
      const message = this.botService.formatEventList(events, `📅 <b>Lịch hôm nay — ${this.botService.escapeHtml(today)}:</b>`);
      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (error) {
      this.logger.error('Error fetching today events:', error);
      await ctx.reply('❌ Không thể tải lịch hôm nay. Vui lòng thử lại.');
    }
  }

  @Command('tomorrow')
  async handleTomorrow(@Ctx() ctx: Context) {
    if (!this.checkReady(ctx)) return;

    try {
      await ctx.sendChatAction('typing').catch(() => {});
      const events = await this.calendarService.getTomorrowEvents();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toLocaleDateString('vi-VN', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Asia/Ho_Chi_Minh',
      });
      const message = this.botService.formatEventList(events, `📅 <b>Lịch ngày mai — ${this.botService.escapeHtml(dateStr)}:</b>`);
      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (error) {
      this.logger.error('Error fetching tomorrow events:', error);
      await ctx.reply('❌ Không thể tải lịch ngày mai. Vui lòng thử lại.');
    }
  }

  @Command('events')
  async handleEvents(@Ctx() ctx: Context) {
    if (!this.checkReady(ctx)) return;

    try {
      await ctx.sendChatAction('typing').catch(() => {});
      const events = await this.calendarService.getUpcomingEvents(10);
      const message = this.botService.formatEventList(events, '📋 <b>10 sự kiện sắp tới:</b>');
      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (error) {
      this.logger.error('Error fetching events:', error);
      await ctx.reply('❌ Không thể tải sự kiện. Vui lòng thử lại.');
    }
  }

  @Command('date')
  async handleDate(@Ctx() ctx: Context) {
    if (!this.checkReady(ctx)) return;

    try {
      await ctx.sendChatAction('typing').catch(() => {});
      const text = (ctx.message as any).text;
      const dateStr = text.replace(/^\/date\s*/i, '').trim();

      if (!dateStr) {
        await ctx.reply('⚠️ Vui lòng nhập ngày theo định dạng: /date DD/MM/YYYY\n\nVí dụ: /date 20/10/2026');
        return;
      }

      // Parse DD/MM/YYYY
      const parts = dateStr.split('/');
      let date: Date;
      if (parts.length === 3) {
        date = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      } else if (parts.length === 2) {
        date = new Date(new Date().getFullYear(), parseInt(parts[1]) - 1, parseInt(parts[0]));
      } else {
        await ctx.reply('⚠️ Định dạng không hợp lệ. Sử dụng: /date DD/MM/YYYY');
        return;
      }

      if (isNaN(date.getTime())) {
        await ctx.reply('⚠️ Ngày không hợp lệ. Vui lòng kiểm tra lại.');
        return;
      }

      const events = await this.calendarService.getEventsForDate(date);
      const formattedDate = date.toLocaleDateString('vi-VN', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Asia/Ho_Chi_Minh',
      });
      const message = this.botService.formatEventList(
        events,
        `📅 <b>Lịch ngày ${this.botService.escapeHtml(formattedDate)}:</b>`,
      );
      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (error) {
      this.logger.error('Error fetching date events:', error);
      await ctx.reply('❌ Không thể tải lịch cho ngày này. Vui lòng thử lại.');
    }
  }

  @Command('search')
  async handleSearch(@Ctx() ctx: Context) {
    if (!this.checkReady(ctx)) return;

    try {
      await ctx.sendChatAction('typing').catch(() => {});
      const text = (ctx.message as any).text;
      const query = text.replace(/^\/search\s*/i, '').trim();

      if (!query) {
        await ctx.reply('⚠️ Vui lòng nhập từ khóa: /search từ_khóa\n\nVí dụ: /search họp nhóm');
        return;
      }

      const events = await this.calendarService.searchEvents(query);
      const message = this.botService.formatEventList(
        events,
        `🔍 <b>Kết quả tìm kiếm "${this.botService.escapeHtml(query)}":</b>`,
      );
      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (error) {
      this.logger.error('Error searching events:', error);
      await ctx.reply('❌ Không thể tìm kiếm. Vui lòng thử lại.');
    }
  }

  // =============================================
  //  ADD EVENT
  // =============================================

  @Command('add')
  async handleAdd(@Ctx() ctx: Context) {
    if (!this.checkReady(ctx)) return;

    try {
      const text = (ctx.message as any).text;
      const rawContent = text.replace(/^\/add\s*/i, '').trim();

      if (!rawContent) {
        await ctx.reply(
          '💡 <b>Thêm lịch nhanh bằng tin nhắn tự nhiên:</b>\n\n' +
          'Bạn chỉ cần nhắn tự do không cần theo mẫu, ví dụ:\n' +
          '• <code>/add học lái xe từ 13h-17h ngày thứ 4 tuần sau</code>\n' +
          '• <code>/add mai 9h đi họp với sếp ở Highland</code>\n\n' +
          '👉 Hoặc <b>không cần gõ /add</b>, cứ nhắn tin trực tiếp cho bot là được!',
          { parse_mode: 'HTML' },
        );
        return;
      }

      // Check if user used legacy pipe format
      if (rawContent.includes('|')) {
        const parsed = this.botService.parseAddCommand(text);
        if (parsed) {
          await ctx.reply('⏳ Đang tạo sự kiện...');
          await this.createAndReplyEvent(ctx, parsed);
          return;
        }
      }

      // Otherwise parse using AI / Vietnamese NLP
      await ctx.reply('⏳ Đang phân tích thông tin lịch...');
      const processed = await this.aiService.processMessage(rawContent);

      if (processed.intent === 'CREATE_EVENT' && processed.event) {
        await this.createAndReplyEvent(ctx, processed.event);
      } else {
        await ctx.reply(
          '⚠️ Chưa rõ thời gian hoặc tiêu đề sự kiện.\n\n' +
          'Ví dụ bạn có thể nhắn:\n' +
          '• `/add học lái xe từ 13h-17h ngày thứ 4 tuần sau`\n' +
          '• `/add mai 10h gặp khách hàng tại cafe Highland`',
        );
      }
    } catch (error) {
      this.logger.error('Error creating event:', error);
      await ctx.reply('❌ Không thể tạo sự kiện. Vui lòng kiểm tra lại thông tin và thử lại.');
    }
  }

  // =============================================
  //  EDIT EVENT
  // =============================================

  @Command('edit')
  async handleEdit(@Ctx() ctx: Context) {
    if (!this.checkReady(ctx)) return;

    try {
      const text = (ctx.message as any).text;
      const parsed = this.botService.parseEditCommand(text);

      if (!parsed) {
        await ctx.reply(
          '⚠️ <b>Định dạng không hợp lệ.</b>\n\n' +
          '<b>Cách sử dụng:</b>\n' +
          '<code>/edit eventId | title=Tên mới</code>\n' +
          '<code>/edit eventId | start=ngày mai 14:00</code>\n' +
          '<code>/edit eventId | end=ngày mai 15:00</code>\n' +
          '<code>/edit eventId | desc=Mô tả mới</code>\n' +
          '<code>/edit eventId | location=Địa điểm mới</code>\n\n' +
          '<b>Có thể sửa nhiều trường cùng lúc:</b>\n' +
          '<code>/edit eventId | title=Tên mới | start=ngày mai 14:00</code>\n\n' +
          '💡 <i>Mẹo: Dùng /events hoặc /today để lấy eventId</i>',
          { parse_mode: 'HTML' },
        );
        return;
      }

      await ctx.reply('⏳ Đang cập nhật sự kiện...');

      const updatedEvent = await this.calendarService.updateEvent(parsed.eventId, parsed.updates);
      const eventInfo = this.botService.formatEvent(updatedEvent);
      await ctx.reply(
        `✅ <b>Đã cập nhật sự kiện thành công!</b>\n\n${eventInfo}`,
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      this.logger.error('Error updating event:', error);
      await ctx.reply('❌ Không thể cập nhật sự kiện. Kiểm tra lại eventId và thử lại.');
    }
  }

  // =============================================
  //  DELETE EVENT
  // =============================================

  @Command('delete')
  async handleDelete(@Ctx() ctx: Context) {
    if (!this.checkReady(ctx)) return;

    try {
      const text = (ctx.message as any).text;
      const eventId = text.replace(/^\/delete\s*/i, '').trim();

      if (!eventId) {
        await ctx.reply(
          '⚠️ Vui lòng cung cấp ID sự kiện.\n\n' +
          'Cách sử dụng: /delete eventId\n\n' +
          '💡 Mẹo: Dùng /events hoặc /today để lấy eventId',
        );
        return;
      }

      // Get event info before deleting
      try {
        const event = await this.calendarService.getEvent(eventId);
        await this.calendarService.deleteEvent(eventId);
        await ctx.reply(`🗑️ Đã xóa sự kiện: <b>${this.botService.escapeHtml(event.summary)}</b>`, {
          parse_mode: 'HTML',
        });
      } catch {
        await this.calendarService.deleteEvent(eventId);
        await ctx.reply('🗑️ Đã xóa sự kiện thành công.');
      }
    } catch (error) {
      this.logger.error('Error deleting event:', error);
      await ctx.reply('❌ Không thể xóa sự kiện. Kiểm tra lại eventId và thử lại.');
    }
  }

  // =============================================
  //  AUTH & STATUS
  // =============================================

  @Command('auth')
  async handleAuth(@Ctx() ctx: Context) {
    try {
      const oauth2Client = this.calendarService.getOAuth2Client();
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/calendar'],
        prompt: 'consent',
      });

      await ctx.reply(
        '🔑 <b>Kết nối Google Calendar</b>\n\n' +
        'Bấm vào link bên dưới để đăng nhập Google và cấp quyền truy cập Calendar:\n\n' +
        `<a href="${authUrl}">👉 Đăng nhập Google</a>\n\n` +
        'Sau khi đăng nhập, bạn sẽ nhận được mã xác thực (code). ' +
        'Hãy gửi mã đó cho tôi bằng lệnh:\n\n' +
        '<code>/code MÃ_XÁC_THỰC</code>',
        { parse_mode: 'HTML', disable_web_page_preview: true } as any,
      );
    } catch (error) {
      this.logger.error('Error generating auth URL:', error);
      await ctx.reply('❌ Không thể tạo link xác thực. Kiểm tra cấu hình Google OAuth2.');
    }
  }

  @Command('code')
  async handleCode(@Ctx() ctx: Context) {
    try {
      const text = (ctx.message as any).text;
      const code = text.replace(/^\/code\s*/i, '').trim();

      if (!code) {
        await ctx.reply('⚠️ Vui lòng cung cấp mã xác thực: /code MÃ_XÁC_THỰC');
        return;
      }

      await ctx.reply('⏳ Đang xác thực...');

      const oauth2Client = this.calendarService.getOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code);
      this.calendarService.setCredentials(tokens);

      let successMsg = '✅ Đã kết nối Google Calendar thành công!\n\n';
      successMsg += 'Bạn có thể bắt đầu sử dụng các lệnh:\n';
      successMsg += '• /today - Xem lịch hôm nay\n';
      successMsg += '• /events - Xem sự kiện sắp tới\n';
      successMsg += '• /add - Thêm sự kiện mới\n';

      if (tokens.refresh_token) {
        successMsg += '\n💡 <b>Lưu ý:</b> Hãy lưu refresh token sau vào file <code>.env</code> để không cần xác thực lại:\n';
        successMsg += `<code>GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}</code>`;
      }

      await ctx.reply(successMsg, { parse_mode: 'HTML' });
    } catch (error) {
      this.logger.error('Error exchanging code for tokens:', error);
      await ctx.reply('❌ Mã xác thực không hợp lệ hoặc đã hết hạn. Vui lòng thử lại với /auth.');
    }
  }

  @Command('status')
  async handleStatus(@Ctx() ctx: Context) {
    const isReady = this.calendarService.isReady();
    if (isReady) {
      try {
        // Try fetching events to verify connection
        const events = await this.calendarService.getUpcomingEvents(1);
        await ctx.reply(
          '✅ Trạng thái: <b>Đã kết nối Google Calendar</b>\n\n' +
          `📅 Sự kiện sắp tới: ${events.length > 0 ? this.botService.escapeHtml(events[0].summary) : 'Không có'}`,
          { parse_mode: 'HTML' },
        );
      } catch {
        await ctx.reply(
          '⚠️ Trạng thái: Đã cấu hình nhưng không thể truy cập Calendar.\n' +
          'Token có thể đã hết hạn. Dùng /auth để kết nối lại.',
        );
      }
    } else {
      await ctx.reply(
        '❌ Trạng thái: <b>Chưa kết nối Google Calendar</b>\n\n' +
        'Dùng /auth để bắt đầu kết nối.',
        { parse_mode: 'HTML' },
      );
    }
  }

  // =============================================
  //  SETTINGS & REMINDER TIME
  // =============================================

  @Command('settings')
  @Command('reminder')
  async handleSettings(@Ctx() ctx: Context) {
    if (ctx.chat) {
      this.reminderService.addChatId(ctx.chat.id);
    }
    const message = this.buildSettingsMessage();
    const keyboard = this.buildSettingsKeyboard();
    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  @Action(/^set_time_(.+)$/)
  async handleSetTimeAction(@Ctx() ctx: Context) {
    const match = (ctx as any).match;
    const time = match ? match[1] : null;
    if (time) {
      this.reminderService.setDailySummaryTime(time);
      await ctx.answerCbQuery(`Đã đổi giờ thông báo sang ${time}!`).catch(() => {});
      const message = this.buildSettingsMessage();
      const keyboard = this.buildSettingsKeyboard();
      try {
        await ctx.editMessageText(message, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
      } catch {}
    }
  }

  @Action('toggle_reminder')
  async handleToggleReminderAction(@Ctx() ctx: Context) {
    const isEnabled = this.reminderService.toggleDailySummary();
    await ctx.answerCbQuery(isEnabled ? 'Đã bật thông báo hàng ngày' : 'Đã tắt thông báo hàng ngày').catch(() => {});
    const message = this.buildSettingsMessage();
    const keyboard = this.buildSettingsKeyboard();
    try {
      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch {}
  }

  @Action('test_reminder')
  async handleTestReminderAction(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('Đang gửi thử bản tóm tắt hôm nay...').catch(() => {});
    if (ctx.chat) {
      await this.reminderService.sendDailySummary(ctx.chat.id);
    }
  }

  private buildSettingsMessage(): string {
    const time = this.reminderService.getDailySummaryTime();
    const enabled = this.reminderService.isDailySummaryEnabled();
    return (
      `⚙️ <b>CÀI ĐẶT THÔNG BÁO LỊCH HÀNG NGÀY</b>\n\n` +
      `⏰ Giờ gửi thông báo hiện tại: <b>${time}</b>\n` +
      `🔔 Trạng thái: <b>${enabled ? 'Đang BẬT ✅' : 'Đang TẮT ❌'}</b>\n` +
      `📍 Múi giờ: <b>Asia/Ho_Chi_Minh</b>\n\n` +
      `💡 <i>Bạn có thể bấm các nút chọn giờ bên dưới, hoặc nhắn tin tự nhiên như:</i>\n` +
      `• <code>đổi giờ thông báo sang 8h</code>\n` +
      `• <code>cài giờ nhắc lịch 06:30</code>`
    );
  }

  private buildSettingsKeyboard() {
    const enabled = this.reminderService.isDailySummaryEnabled();
    return {
      inline_keyboard: [
        [
          { text: '06:30', callback_data: 'set_time_06:30' },
          { text: '07:00', callback_data: 'set_time_07:00' },
          { text: '07:30', callback_data: 'set_time_07:30' },
        ],
        [
          { text: '08:00', callback_data: 'set_time_08:00' },
          { text: '08:30', callback_data: 'set_time_08:30' },
          { text: '09:00', callback_data: 'set_time_09:00' },
        ],
        [
          {
            text: enabled ? '🔕 Tắt thông báo hàng ngày' : '🔔 Bật thông báo hàng ngày',
            callback_data: 'toggle_reminder',
          },
          { text: '🚀 Gửi thử ngay', callback_data: 'test_reminder' },
        ],
        [
          { text: '🧠 Quản lý lịch trình (AI Eisenhower)', callback_data: 'manage_schedule' },
        ],
      ],
    };
  }

  // =============================================
  //  AI SCHEDULE MANAGEMENT (EISENHOWER MATRIX)
  // =============================================

  @Command('manage')
  @Command('quanly')
  @Command('eisenhower')
  @Command('matrix')
  async handleManageScheduleCommand(@Ctx() ctx: Context) {
    if (!this.checkReady(ctx)) return;
    await this.runEisenhowerAnalysis(ctx, 'month');
  }

  @Action('manage_schedule')
  async handleManageScheduleAction(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('Đang phân tích lịch tháng này...').catch(() => {});
    if (!this.checkReady(ctx)) return;
    await this.runEisenhowerAnalysis(ctx, 'month');
  }

  @Action('eisenhower_week')
  async handleEisenhowerWeekAction(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('Đang phân tích lịch tuần này...').catch(() => {});
    if (!this.checkReady(ctx)) return;
    await this.runEisenhowerAnalysis(ctx, 'week');
  }

  @Action('eisenhower_today')
  async handleEisenhowerTodayAction(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('Đang phân tích lịch hôm nay...').catch(() => {});
    if (!this.checkReady(ctx)) return;
    await this.runEisenhowerAnalysis(ctx, 'today');
  }

  @Action('eisenhower_upcoming')
  async handleEisenhowerUpcomingAction(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('Đang phân tích 10 sự kiện tới...').catch(() => {});
    if (!this.checkReady(ctx)) return;
    await this.runEisenhowerAnalysis(ctx, 'upcoming');
  }

  @Action('eisenhower_month')
  async handleEisenhowerMonthAction(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('Đang phân tích lịch tháng này...').catch(() => {});
    if (!this.checkReady(ctx)) return;
    await this.runEisenhowerAnalysis(ctx, 'month');
  }

  @Action('view_today')
  async handleViewTodayAction(@Ctx() ctx: Context) {
    await ctx.answerCbQuery().catch(() => {});
    await this.handleToday(ctx);
  }

  @Action('view_week')
  async handleViewWeekAction(@Ctx() ctx: Context) {
    await ctx.answerCbQuery().catch(() => {});
    await ctx.sendChatAction('typing').catch(() => {});
    const thisWeekEvents = await this.calendarService.getThisWeekEvents();
    const msg = this.botService.formatEventList(thisWeekEvents, '📅 <b>Lịch tuần này:</b>');
    await ctx.reply(msg, { parse_mode: 'HTML' });
  }

  @Action('trigger_report')
  async handleTriggerReportAction(@Ctx() ctx: Context) {
    await ctx.answerCbQuery('Đang tải báo cáo...').catch(() => {});
    await this.handleReportCommand(ctx);
  }

  @Action('open_settings')
  async handleOpenSettingsAction(@Ctx() ctx: Context) {
    await ctx.answerCbQuery().catch(() => {});
    await this.handleSettings(ctx);
  }

  private async runEisenhowerAnalysis(ctx: Context, scope: 'today' | 'week' | 'month' | 'upcoming' = 'month') {
    await ctx.sendChatAction('typing').catch(() => {});
    let events: any[] = [];
    const currentMonthName = new Date().toLocaleDateString('vi-VN', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    let scopeTitle = `Tháng hiện tại (${currentMonthName})`;

    let statusMsg: any = null;
    try {
      statusMsg = await ctx.reply(`⏳ 🧠 Đang tổng hợp lịch ${scope === 'month' ? currentMonthName : scope} và phân tích theo Ma trận Eisenhower...`);
    } catch {}

    const typingInterval = setInterval(() => {
      ctx.sendChatAction('typing').catch(() => {});
    }, 2500);

    try {
      if (scope === 'today') {
        events = await this.calendarService.getTodayEvents();
        scopeTitle = 'Hôm nay';
      } else if (scope === 'week') {
        events = await this.calendarService.getThisWeekEvents();
        scopeTitle = 'Tuần này';
      } else if (scope === 'upcoming') {
        events = await this.calendarService.getUpcomingEvents(10);
        scopeTitle = '10 sự kiện sắp tới';
      } else {
        // Default: Current Month
        events = await this.calendarService.getThisMonthEvents();
        scopeTitle = `Tháng hiện tại (${currentMonthName})`;
      }

      const result = await this.aiService.analyzeEisenhowerMatrix(events, scopeTitle);

      if (statusMsg && ctx.chat) {
        try {
          await ctx.deleteMessage(statusMsg.message_id);
        } catch {}
      }

      try {
        await ctx.reply(result, {
          parse_mode: 'HTML',
          reply_markup: this.buildEisenhowerFollowupKeyboard(),
        });
      } catch (sendErr: any) {
        this.logger.warn(`Failed to send HTML Eisenhower analysis (${sendErr.message}), falling back to plain text`);
        const plainText = result.replace(/<[^>]+>/g, '');
        await ctx.reply(plainText, {
          reply_markup: this.buildEisenhowerFollowupKeyboard(),
        });
      }
    } catch (err) {
      this.logger.error('Error running Eisenhower analysis:', err);
      if (statusMsg && ctx.chat) {
        try {
          await ctx.deleteMessage(statusMsg.message_id);
        } catch {}
      }
      await ctx.reply('❌ Không thể phân tích lịch trình lúc này. Vui lòng thử lại sau.');
    } finally {
      clearInterval(typingInterval);
    }
  }

  private buildEisenhowerFollowupKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: '📆 Phân tích lại Tháng này', callback_data: 'eisenhower_month' },
        ],
        [
          { text: '🗓️ Tuần này', callback_data: 'eisenhower_week' },
          { text: '📅 Hôm nay', callback_data: 'eisenhower_today' },
          { text: '📊 Báo cáo', callback_data: 'trigger_report' },
        ],
      ],
    };
  }

  // =============================================
  //  DAILY OPERATIONAL REPORT
  // =============================================

  @Command('report')
  @Command('baocao')
  async handleReportCommand(@Ctx() ctx: Context) {
    if (ctx.chat) {
      this.reportService.addChatId(ctx.chat.id);
    }
    await ctx.sendChatAction('typing').catch(() => {});
    const text = ((ctx.message as any)?.text || '').trim();
    const parts = text.split(/\s+/);
    let targetDate: Date | undefined;

    if (parts.length > 1 && parts[1]) {
      const dateMatch = parts[1].match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?$/);
      if (dateMatch) {
        const d = parseInt(dateMatch[1], 10);
        const m = parseInt(dateMatch[2], 10) - 1;
        const y = dateMatch[3] ? parseInt(dateMatch[3], 10) : new Date().getFullYear();
        targetDate = new Date(y, m, d);
      }
    }

    const res = await this.reportService.generateDailyReport(targetDate);
    if (res.success && res.text) {
      await ctx.reply(res.text);
    } else {
      await ctx.reply(
        `❌ <b>Không thể tạo báo cáo:</b>\n\n${res.error || 'Vui lòng kiểm tra lại link Google Sheets.'}`,
        { parse_mode: 'HTML' },
      );
    }
  }

  @Command('set_report_url')
  @Command('report_url')
  async handleSetReportUrl(@Ctx() ctx: Context) {
    if (ctx.chat) {
      this.reportService.addChatId(ctx.chat.id);
    }
    const text = ((ctx.message as any)?.text || '').trim();
    const parts = text.split(/\s+/);
    const url = parts.slice(1).join(' ').trim();

    if (!url) {
      const currentUrl = this.reportService.getSheetUrl();
      await ctx.reply(
        `📊 <b>Cấu hình Link Báo Cáo Google Sheets:</b>\n\n` +
        `🔗 <b>Link hiện tại:</b>\n<code>${currentUrl}</code>\n\n` +
        `💡 <i>Để đổi link mới, gõ:</i>\n<code>/set_report_url https://docs.google.com/spreadsheets/d/...</code>`,
        { parse_mode: 'HTML', disable_web_page_preview: true } as any,
      );
      return;
    }

    const res = this.reportService.setSheetUrl(url);
    if (res.success) {
      await ctx.reply(
        `✅ <b>Đã cập nhật link Google Sheets thành công!</b>\n\n` +
        `🆔 Spreadsheet ID: <code>${res.spreadsheetId}</code>\n` +
        `⏰ Giờ gửi tự động: <b>${this.reportService.getReportTime()}</b> hàng ngày (báo cáo ngày hôm trước).\n\n` +
        `💡 <i>Gõ /report để xem báo cáo ngay lập tức.</i>`,
        { parse_mode: 'HTML' },
      );
    } else {
      await ctx.reply(`❌ ${res.error || 'Link Google Sheets không hợp lệ.'}`);
    }
  }

  @Command('report_settings')
  async handleReportSettings(@Ctx() ctx: Context) {
    if (ctx.chat) {
      this.reportService.addChatId(ctx.chat.id);
    }
    const url = this.reportService.getSheetUrl();
    const time = this.reportService.getReportTime();
    const enabled = this.reportService.isReportEnabled();

    await ctx.reply(
      `📊 <b>Cài đặt Báo Cáo Vận Hành Hàng Ngày</b>\n\n` +
      `🔗 <b>Google Sheet:</b>\n<code>${url}</code>\n\n` +
      `⏰ <b>Giờ gửi tự động:</b> <b>${time}</b> hàng ngày (báo cáo số liệu ngày hôm trước)\n` +
      `🔔 <b>Trạng thái:</b> <b>${enabled ? 'Đang BẬT ✅' : 'Đang TẮT ❌'}</b>\n\n` +
      `💡 <i>Lệnh thao tác nhanh:</i>\n` +
      `• <code>/report</code> — Xem báo cáo ngay lập tức\n` +
      `• <code>/set_report_url &lt;url&gt;</code> — Cài đặt link Google Sheet mới\n` +
      `• <code>đổi giờ báo cáo sang 15h</code> — Đổi giờ gửi`,
      { parse_mode: 'HTML', disable_web_page_preview: true } as any,
    );
  }

  // =============================================
  //  NATURAL LANGUAGE TEXT HANDLER
  // =============================================

  @On('text')
  async handleTextMessage(@Ctx() ctx: Context) {
    const text = ((ctx.message as any)?.text || '').trim();

    // Ignore slash commands
    if (text.startsWith('/')) {
      return;
    }

    if (!this.checkReady(ctx)) return;

    // 1. Send typing action immediately (shows "bot is typing..." in header)
    await ctx.sendChatAction('typing').catch(() => {});

    // 2. Send instant feedback message so user knows the bot received the command
    let statusMsg: any = null;
    try {
      statusMsg = await ctx.reply('⏳ Đang tiếp nhận và xử lý yêu cầu...');
    } catch {}

    const typingInterval = setInterval(() => {
      ctx.sendChatAction('typing').catch(() => {});
    }, 2500);

    const updateStatus = async (newText: string) => {
      if (statusMsg && ctx.chat) {
        try {
          await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, newText);
        } catch {}
      }
    };

    const cleanupStatus = async () => {
      if (statusMsg && ctx.chat) {
        try {
          await ctx.deleteMessage(statusMsg.message_id);
        } catch {}
        statusMsg = null;
      }
    };

    try {
      this.logger.log(`Processing natural text message: "${text}"`);
      const result = await this.aiService.processMessage(text);

      switch (result.intent) {
        case 'CREATE_EVENT':
          if (result.event) {
            await updateStatus('✍️ Đang tạo sự kiện lên Google Calendar...');
            await this.createAndReplyEvent(ctx, result.event);
            await cleanupStatus();
          } else {
            await cleanupStatus();
            await ctx.reply('⚠️ Chưa nhận diện được thời gian hoặc tiêu đề sự kiện. Vui lòng nói rõ hơn (ví dụ: "mai 9h họp team").');
          }
          break;

        case 'UPDATE_EVENT':
          if (result.updateData?.targetEventTitle) {
            await updateStatus(`🔄 Đang tìm và cập nhật sự kiện "${result.updateData.targetEventTitle}"...`);
            await this.handleNaturalUpdate(ctx, result.updateData);
            await cleanupStatus();
          } else {
            await cleanupStatus();
            await ctx.reply('⚠️ Chưa rõ sự kiện cần sửa. Ví dụ: "sửa lịch học lái xe thành 13h30".');
          }
          break;

        case 'VIEW_TODAY':
          await cleanupStatus();
          await this.handleToday(ctx);
          break;

        case 'VIEW_TOMORROW':
          await cleanupStatus();
          await this.handleTomorrow(ctx);
          break;

        case 'VIEW_UPCOMING':
          await cleanupStatus();
          await this.handleEvents(ctx);
          break;

        case 'VIEW_THIS_WEEK':
          await updateStatus('📅 Đang tải lịch tuần này...');
          const thisWeekEvents = await this.calendarService.getThisWeekEvents();
          const thisWeekMsg = this.botService.formatEventList(
            thisWeekEvents,
            '📅 <b>Lịch tuần này:</b>',
          );
          await cleanupStatus();
          await ctx.reply(thisWeekMsg, { parse_mode: 'HTML' });
          break;

        case 'VIEW_NEXT_WEEK':
          await updateStatus('📅 Đang tải lịch tuần sau...');
          const nextWeekEvents = await this.calendarService.getNextWeekEvents();
          const nextWeekMsg = this.botService.formatEventList(
            nextWeekEvents,
            '📅 <b>Lịch tuần sau:</b>',
          );
          await cleanupStatus();
          await ctx.reply(nextWeekMsg, { parse_mode: 'HTML' });
          break;

        case 'VIEW_THIS_MONTH':
          const currentMonthName = new Date().toLocaleDateString('vi-VN', {
            month: 'long',
            year: 'numeric',
            timeZone: 'Asia/Ho_Chi_Minh',
          });
          await updateStatus(`📅 Đang tải lịch ${currentMonthName}...`);
          const thisMonthEvents = await this.calendarService.getThisMonthEvents();
          const thisMonthMsg = this.botService.formatEventList(
            thisMonthEvents,
            `📅 <b>Lịch ${this.botService.escapeHtml(currentMonthName)}:</b>`,
          );
          await cleanupStatus();
          await ctx.reply(thisMonthMsg, { parse_mode: 'HTML' });
          break;

        case 'VIEW_NEXT_MONTH':
          const nextMonthDate = new Date();
          nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
          const nextMonthName = nextMonthDate.toLocaleDateString('vi-VN', {
            month: 'long',
            year: 'numeric',
            timeZone: 'Asia/Ho_Chi_Minh',
          });
          await updateStatus(`📅 Đang tải lịch ${nextMonthName}...`);
          const nextMonthEvents = await this.calendarService.getNextMonthEvents();
          const nextMonthMsg = this.botService.formatEventList(
            nextMonthEvents,
            `📅 <b>Lịch ${this.botService.escapeHtml(nextMonthName)}:</b>`,
          );
          await cleanupStatus();
          await ctx.reply(nextMonthMsg, { parse_mode: 'HTML' });
          break;

        case 'VIEW_DATE':
          if (result.targetDate) {
            const date = new Date(result.targetDate);
            const formattedDate = date.toLocaleDateString('vi-VN', {
              weekday: 'long',
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              timeZone: 'Asia/Ho_Chi_Minh',
            });
            await updateStatus(`📅 Đang tải lịch ngày ${formattedDate}...`);
            const events = await this.calendarService.getEventsForDate(date);
            const msg = this.botService.formatEventList(
              events,
              `📅 <b>Lịch ${this.botService.escapeHtml(formattedDate)}:</b>`,
            );
            await cleanupStatus();
            await ctx.reply(msg, { parse_mode: 'HTML' });
          } else {
            await cleanupStatus();
          }
          break;

        case 'SEARCH_EVENTS':
          if (result.searchQuery) {
            // Check if searchQuery is actually a date query like "22/10/2026", "22/10", "2026-10-22", "ngày 22"
            const dateMatch =
              result.searchQuery.match(/^(?:ngày\s+)?(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?$/) ||
              result.searchQuery.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (dateMatch) {
              let date: Date;
              if (dateMatch[0].includes('-') && dateMatch[1]?.length === 4) {
                date = new Date(parseInt(dateMatch[1]), parseInt(dateMatch[2]) - 1, parseInt(dateMatch[3]));
              } else {
                const day = parseInt(dateMatch[1]);
                const month = parseInt(dateMatch[2]) - 1;
                const year = dateMatch[3] ? parseInt(dateMatch[3]) : new Date().getFullYear();
                date = new Date(year, month, day);
              }

              if (!isNaN(date.getTime())) {
                const formattedDate = date.toLocaleDateString('vi-VN', {
                  weekday: 'long',
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  timeZone: 'Asia/Ho_Chi_Minh',
                });
                await updateStatus(`📅 Đang tải lịch ngày ${formattedDate}...`);
                const events = await this.calendarService.getEventsForDate(date);
                const msg = this.botService.formatEventList(
                  events,
                  `📅 <b>Lịch ngày ${this.botService.escapeHtml(formattedDate)}:</b>`,
                );
                await cleanupStatus();
                await ctx.reply(msg, { parse_mode: 'HTML' });
                break;
              }
            }

            await updateStatus(`🔍 Đang tìm kiếm "${result.searchQuery}"...`);
            const events = await this.calendarService.searchEvents(result.searchQuery);
            const msg = this.botService.formatEventList(
              events,
              `🔍 <b>Kết quả tìm kiếm "${this.botService.escapeHtml(result.searchQuery)}":</b>`,
            );
            await cleanupStatus();
            await ctx.reply(msg, { parse_mode: 'HTML' });
          } else {
            await cleanupStatus();
          }
          break;

        case 'DELETE_EVENT':
          if (result.deleteKeyword) {
            await updateStatus(`🗑️ Đang tìm sự kiện "${result.deleteKeyword}" để xóa...`);
            const foundEvents = await this.calendarService.searchEvents(result.deleteKeyword);
            await cleanupStatus();
            if (foundEvents.length === 0) {
              await ctx.reply(`❌ Không tìm thấy sự kiện nào khớp với "${this.botService.escapeHtml(result.deleteKeyword)}" để xóa.`);
            } else if (foundEvents.length === 1) {
              await this.calendarService.deleteEvent(foundEvents[0].id!);
              await ctx.reply(
                `🗑️ Đã xóa sự kiện: <b>${this.botService.escapeHtml(foundEvents[0].summary)}</b>`,
                { parse_mode: 'HTML' },
              );
            } else {
              let msg = `⚠️ Tìm thấy ${foundEvents.length} sự kiện khớp với "${this.botService.escapeHtml(result.deleteKeyword)}". Dùng lệnh <code>/delete &lt;eventId&gt;</code> để xóa cụ thể:\n\n`;
              foundEvents.forEach((ev) => {
                msg += `• <b>${this.botService.escapeHtml(ev.summary)}</b> (ID: <code>${ev.id}</code>)\n`;
              });
              await ctx.reply(msg, { parse_mode: 'HTML' });
            }
          } else {
            await cleanupStatus();
          }
          break;

        case 'SET_REMINDER_TIME':
          await cleanupStatus();
          if (ctx.chat) {
            this.reminderService.addChatId(ctx.chat.id);
          }
          if (result.reminderTime) {
            const formatted = this.reminderService.setDailySummaryTime(result.reminderTime);
            if (formatted) {
              await ctx.reply(
                `✅ <b>Đã cài đặt giờ thông báo lịch hàng ngày!</b>\n\n` +
                `⏰ Giờ gửi thông báo mới: <b>${formatted}</b> mỗi sáng.\n` +
                `🔔 Trạng thái: <b>Đang BẬT</b>\n\n` +
                `💡 <i>Dùng lệnh /settings để xem bảng điều khiển hoặc đổi giờ khác bất cứ lúc nào.</i>`,
                { parse_mode: 'HTML' },
              );
            } else {
              await ctx.reply(`⚠️ Giờ "${result.reminderTime}" không hợp lệ. Vui lòng nhập giờ dạng: 08:00 hoặc 7h30.`);
            }
          } else if (result.reminderEnabled !== undefined) {
            this.reminderService.setDailySummaryEnabled(result.reminderEnabled);
            await ctx.reply(
              `✅ Đã <b>${result.reminderEnabled ? 'BẬT' : 'TẮT'}</b> thông báo lịch hàng ngày!`,
              { parse_mode: 'HTML' },
            );
          }
          break;

        case 'SET_REPORT_URL':
          await cleanupStatus();
          if (ctx.chat) {
            this.reportService.addChatId(ctx.chat.id);
          }
          if (result.reportUrl) {
            const res = this.reportService.setSheetUrl(result.reportUrl);
            if (res.success) {
              await ctx.reply(
                `✅ <b>Đã cập nhật link Google Sheets báo cáo thành công!</b>\n\n` +
                `🆔 Spreadsheet ID: <code>${res.spreadsheetId}</code>\n` +
                `⏰ Giờ gửi tự động: <b>${this.reportService.getReportTime()}</b> hàng ngày (báo cáo kết quả ngày hôm trước).\n\n` +
                `💡 <i>Bạn có thể gõ "báo cáo" hoặc /report để kiểm tra lấy kết quả ngay.</i>`,
                { parse_mode: 'HTML' },
              );
            } else {
              await ctx.reply(`❌ ${res.error || 'Link Google Sheets không hợp lệ.'}`);
            }
          } else {
            await ctx.reply('⚠️ Vui lòng gửi kèm link Google Sheets (ví dụ: "cài link báo cáo https://docs.google.com/spreadsheets/...")');
          }
          break;

        case 'SET_REPORT_TIME':
          await cleanupStatus();
          if (ctx.chat) {
            this.reportService.addChatId(ctx.chat.id);
          }
          if (result.reminderTime) {
            const formatted = this.reportService.setReportTime(result.reminderTime);
            if (formatted) {
              await ctx.reply(
                `✅ <b>Đã cài đặt giờ gửi báo cáo hàng ngày!</b>\n\n` +
                `⏰ Giờ gửi mới: <b>${formatted}</b> hàng ngày (báo cáo số liệu ngày hôm trước).\n` +
                `🔔 Trạng thái: <b>Đang BẬT</b>`,
                { parse_mode: 'HTML' },
              );
            } else {
              await ctx.reply(`⚠️ Giờ "${result.reminderTime}" không hợp lệ. Vui lòng nhập giờ dạng 15:00 hoặc 15h.`);
            }
          }
          break;

        case 'GENERATE_REPORT':
          if (ctx.chat) {
            this.reportService.addChatId(ctx.chat.id);
          }
          await updateStatus('📊 Đang tải số liệu từ Google Sheets và tạo báo cáo...');
          const reportRes = await this.reportService.generateDailyReport(result.targetDate);
          await cleanupStatus();
          if (reportRes.success && reportRes.text) {
            await ctx.reply(reportRes.text);
          } else {
            await ctx.reply(
              `❌ <b>Không thể tạo báo cáo:</b>\n\n${reportRes.error || 'Vui lòng kiểm tra lại link Google Sheets.'}`,
              { parse_mode: 'HTML' },
            );
          }
          break;

        case 'ANALYZE_SCHEDULE':
          await cleanupStatus();
          await this.runEisenhowerAnalysis(ctx, result.scheduleScope || 'month');
          break;

        case 'CHAT':
        default:
          await cleanupStatus();
          if (result.aiReply) {
            await ctx.reply(result.aiReply);
          }
          break;
      }
    } catch (error) {
      clearInterval(typingInterval);
      await cleanupStatus();
      this.logger.error('Error handling natural message:', error);
      await ctx.reply('❌ Có lỗi xảy ra khi xử lý tin nhắn. Vui lòng thử lại.');
    } finally {
      clearInterval(typingInterval);
      await cleanupStatus();
    }
  }

  // =============================================
  //  HELPERS
  // =============================================

  private async createAndReplyEvent(
    ctx: Context,
    eventData: {
      summary: string;
      startTime: Date;
      endTime: Date;
      description?: string;
      location?: string;
    },
  ) {
    try {
      const createdEvent = await this.calendarService.createEvent({
        summary: eventData.summary,
        startTime: eventData.startTime.toISOString(),
        endTime: eventData.endTime.toISOString(),
        description: eventData.description,
        location: eventData.location,
      });

      const eventInfo = this.botService.formatEvent(createdEvent);
      await ctx.reply(`✅ <b>Đã tạo sự kiện thành công!</b>\n\n${eventInfo}`, {
        parse_mode: 'HTML',
      });
    } catch (err: any) {
      if (err.message?.includes('invalid_grant') || err.toString().includes('invalid_grant')) {
        const authUrl = this.calendarService.getOAuth2Client().generateAuthUrl({
          access_type: 'offline',
          scope: ['https://www.googleapis.com/auth/calendar'],
          prompt: 'consent',
        });
        await ctx.reply(
          '❌ <b>Token Google Calendar không hợp lệ hoặc đã hết hạn!</b>\n\n' +
          'Vui lòng bấm vào link dưới đây để cấp quyền lại (hệ thống sẽ tự động lưu token mới):\n\n' +
          `<a href="${authUrl}">👉 Bấm vào đây để đăng nhập Google</a>`,
          { parse_mode: 'HTML', disable_web_page_preview: true } as any,
        );
        return;
      }
      throw err;
    }
  }

  private async handleNaturalUpdate(ctx: Context, updateData: any) {
    try {
      const events = await this.calendarService.searchEvents(updateData.targetEventTitle);

      if (events.length === 0) {
        await ctx.reply(`❌ Không tìm thấy sự kiện nào khớp với "${this.botService.escapeHtml(updateData.targetEventTitle)}" để sửa.`);
        return;
      }

      if (events.length > 1) {
        let msg = `⚠️ Tìm thấy ${events.length} sự kiện khớp với "${this.botService.escapeHtml(updateData.targetEventTitle)}". Dùng lệnh <code>/edit &lt;eventId&gt; | ...</code> để sửa cụ thể:\n\n`;
        events.forEach((ev) => {
          msg += `• <b>${this.botService.escapeHtml(ev.summary)}</b> (${new Date(ev.startTime).toLocaleDateString('vi-VN')}) - ID: <code>${ev.id}</code>\n`;
        });
        await ctx.reply(msg, { parse_mode: 'HTML' });
        return;
      }

      const target = events[0];
      const oldStart = new Date(target.startTime);
      const oldEnd = new Date(target.endTime);
      const oldDurationMs = oldEnd.getTime() - oldStart.getTime();

      const updates: any = {};

      if (updateData.newTitle) {
        updates.summary = updateData.newTitle;
      }
      if (updateData.newLocation) {
        updates.location = updateData.newLocation;
      }
      if (updateData.newDescription) {
        updates.description = updateData.newDescription;
      }

      let newStart = new Date(oldStart);

      // If newDateStr is provided (e.g. "ngày mai", "thứ 5"):
      if (updateData.newDateStr) {
        const parsedDate = this.aiService.parseVietnameseEvent(`sự kiện ${updateData.newDateStr}`);
        if (parsedDate) {
          newStart.setFullYear(parsedDate.startTime.getFullYear());
          newStart.setMonth(parsedDate.startTime.getMonth());
          newStart.setDate(parsedDate.startTime.getDate());
        }
      }

      // If newTimeStr is provided (e.g. "13h30", "15:00", "14h"):
      if (updateData.newTimeStr) {
        const timeMatch = updateData.newTimeStr.match(/(\d{1,2})(?:[h:](\d{2})?|h)/i);
        if (timeMatch) {
          const h = parseInt(timeMatch[1], 10);
          const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
          newStart.setHours(h, m, 0, 0);
        }
      } else if (updateData.newStartTime) {
        newStart = new Date(updateData.newStartTime);
      }

      // Calculate newEnd:
      let newEnd = new Date(newStart.getTime() + (oldDurationMs > 0 ? oldDurationMs : 3600000));
      if (updateData.newEndTime) {
        newEnd = new Date(updateData.newEndTime);
      }

      if (newStart.getTime() !== oldStart.getTime() || updateData.newEndTime) {
        updates.startTime = newStart.toISOString();
        updates.endTime = newEnd.toISOString();
      }

      const updated = await this.calendarService.updateEvent(target.id!, updates);
      const info = this.botService.formatEvent(updated);
      await ctx.reply(`✅ <b>Đã sửa sự kiện thành công!</b>\n\n${info}`, {
        parse_mode: 'HTML',
      });
    } catch (err: any) {
      this.logger.error('Error updating event naturally:', err);
      if (err.message?.includes('invalid_grant') || err.toString().includes('invalid_grant')) {
        const authUrl = this.calendarService.getOAuth2Client().generateAuthUrl({
          access_type: 'offline',
          scope: ['https://www.googleapis.com/auth/calendar'],
          prompt: 'consent',
        });
        await ctx.reply(
          '❌ <b>Token Google Calendar không hợp lệ hoặc đã hết hạn!</b>\n\n' +
          'Vui lòng bấm vào link dưới đây để cấp quyền lại:\n\n' +
          `<a href="${authUrl}">👉 Bấm vào đây để đăng nhập Google</a>`,
          { parse_mode: 'HTML', disable_web_page_preview: true } as any,
        );
        return;
      }
      await ctx.reply('❌ Không thể sửa sự kiện. Vui lòng thử lại.');
    }
  }

  private checkReady(ctx: Context): boolean {
    if (!this.calendarService.isReady()) {
      ctx.reply(
        '⚠️ Google Calendar chưa được kết nối.\n\n' +
        'Dùng /auth để kết nối Google Calendar trước.',
      );
      return false;
    }
    return true;
  }
}
