import { Injectable, Logger } from '@nestjs/common';
import { CalendarEvent } from '../google-calendar/google-calendar.service';

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  /**
   * Escape special HTML characters for Telegram HTML mode
   */
  escapeHtml(text: string): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Format a single event for Telegram display (HTML mode)
   */
  formatEvent(event: CalendarEvent, index?: number): string {
    const startDate = new Date(event.startTime);
    const endDate = new Date(event.endTime);

    const dateStr = startDate.toLocaleDateString('vi-VN', {
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    const startTimeStr = startDate.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    const endTimeStr = endDate.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    });

    const prefix = index !== undefined ? `<b>${index + 1}.</b> ` : '';
    let text = `${prefix}📌 <b>${this.escapeHtml(event.summary)}</b>\n`;
    if (event.calendarName) {
      text += `   🏷️ Tag: <b>${this.escapeHtml(event.calendarName)}</b>\n`;
    }
    text += `   📅 ${this.escapeHtml(dateStr)}\n`;
    text += `   🕐 ${startTimeStr} → ${endTimeStr}\n`;

    if (event.location) {
      text += `   📍 ${this.escapeHtml(event.location)}\n`;
    }
    if (event.description) {
      const desc = event.description.length > 100
        ? event.description.substring(0, 100) + '...'
        : event.description;
      text += `   📝 <i>${this.escapeHtml(desc)}</i>\n`;
    }
    if (event.id) {
      text += `   🆔 <code>${event.id}</code>\n`;
    }

    return text;
  }

  /**
   * Format a list of events for display
   */
  formatEventList(events: CalendarEvent[], title: string): string {
    if (events.length === 0) {
      return `${title}\n\n📭 Không có sự kiện nào.`;
    }

    let message = `${title}\n\n`;
    events.forEach((event, index) => {
      message += this.formatEvent(event, index) + '\n';
    });

    return message;
  }

  /**
   * Parse date/time from natural Vietnamese text
   * Supports formats like:
   * - "hôm nay 14:00"
   * - "ngày mai 9:30"
   * - "20/10 15:00"
   * - "20/10/2026 15:00"
   * - "2026-10-20 15:00"
   * - "2026-10-20T15:00:00"
   */
  parseDateTime(text: string): Date | null {
    const now = new Date();
    const cleanText = text.trim().toLowerCase();

    // ISO format: 2026-10-20T15:00:00
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(cleanText)) {
      const date = new Date(cleanText);
      return isNaN(date.getTime()) ? null : date;
    }

    // "hôm nay HH:MM" or "hom nay HH:MM"
    const todayMatch = cleanText.match(/h[oô]m\s*nay\s+(\d{1,2})[:\.](\d{2})/);
    if (todayMatch) {
      const result = new Date(now);
      result.setHours(parseInt(todayMatch[1]), parseInt(todayMatch[2]), 0, 0);
      return result;
    }

    // "ngày mai HH:MM" or "ngay mai HH:MM"
    const tomorrowMatch = cleanText.match(/ng[aà]y\s*mai\s+(\d{1,2})[:\.](\d{2})/);
    if (tomorrowMatch) {
      const result = new Date(now);
      result.setDate(result.getDate() + 1);
      result.setHours(parseInt(tomorrowMatch[1]), parseInt(tomorrowMatch[2]), 0, 0);
      return result;
    }

    // "DD/MM HH:MM" or "DD/MM/YYYY HH:MM"
    const dateMatch = cleanText.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+(\d{1,2})[:\.](\d{2})/);
    if (dateMatch) {
      const day = parseInt(dateMatch[1]);
      const month = parseInt(dateMatch[2]) - 1;
      const year = dateMatch[3] ? parseInt(dateMatch[3]) : now.getFullYear();
      const hour = parseInt(dateMatch[4]);
      const minute = parseInt(dateMatch[5]);
      return new Date(year, month, day, hour, minute, 0);
    }

    // "YYYY-MM-DD HH:MM"
    const isoDateMatch = cleanText.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2})[:\.](\d{2})/);
    if (isoDateMatch) {
      return new Date(
        parseInt(isoDateMatch[1]),
        parseInt(isoDateMatch[2]) - 1,
        parseInt(isoDateMatch[3]),
        parseInt(isoDateMatch[4]),
        parseInt(isoDateMatch[5]),
        0,
      );
    }

    // Just time "HH:MM" → assume today
    const timeOnlyMatch = cleanText.match(/^(\d{1,2})[:\.](\d{2})$/);
    if (timeOnlyMatch) {
      const result = new Date(now);
      result.setHours(parseInt(timeOnlyMatch[1]), parseInt(timeOnlyMatch[2]), 0, 0);
      return result;
    }

    return null;
  }

  /**
   * Parse the /add command text
   * Format: /add Tiêu đề | Bắt đầu | Kết thúc [| Mô tả] [| Địa điểm]
   */
  parseAddCommand(text: string): {
    summary: string;
    startTime: Date;
    endTime: Date;
    description?: string;
    location?: string;
  } | null {
    const payload = text.replace(/^\/add\s*/i, '').trim();
    if (!payload) return null;

    const parts = payload.split('|').map((p) => p.trim());
    if (parts.length < 3) return null;

    const summary = parts[0];
    const startTime = this.parseDateTime(parts[1]);
    const endTime = this.parseDateTime(parts[2]);

    if (!summary || !startTime || !endTime) return null;

    return {
      summary,
      startTime,
      endTime,
      description: parts[3] || undefined,
      location: parts[4] || undefined,
    };
  }

  /**
   * Parse the /edit command text
   * Format: /edit eventId | field=value | field=value ...
   * Fields: title, start, end, desc, location
   */
  parseEditCommand(text: string): {
    eventId: string;
    updates: {
      summary?: string;
      startTime?: string;
      endTime?: string;
      description?: string;
      location?: string;
    };
  } | null {
    const payload = text.replace(/^\/edit\s*/i, '').trim();
    if (!payload) return null;

    const parts = payload.split('|').map((p) => p.trim());
    if (parts.length < 2) return null;

    const eventId = parts[0];
    const updates: any = {};

    for (let i = 1; i < parts.length; i++) {
      const [key, ...valueParts] = parts[i].split('=');
      const value = valueParts.join('=').trim();

      switch (key.trim().toLowerCase()) {
        case 'title':
        case 'tiêu đề':
        case 'tên':
          updates.summary = value;
          break;
        case 'start':
        case 'bắt đầu':
          const startDate = this.parseDateTime(value);
          if (startDate) updates.startTime = startDate.toISOString();
          break;
        case 'end':
        case 'kết thúc':
          const endDate = this.parseDateTime(value);
          if (endDate) updates.endTime = endDate.toISOString();
          break;
        case 'desc':
        case 'mô tả':
          updates.description = value;
          break;
        case 'location':
        case 'địa điểm':
          updates.location = value;
          break;
      }
    }

    if (Object.keys(updates).length === 0) return null;

    return { eventId, updates };
  }

  /**
   * Escape special Markdown characters for Telegram
   */
  escapeMarkdown(text: string): string {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
  }

  /**
   * Build the help message
   */
  getHelpMessage(): string {
    return `
🤖 <b>Trợ Lý Lịch Google Calendar</b>

💬 <b>Nhắn tin tự nhiên (Không cần lệnh hay cú pháp):</b>
• <code>lịch tháng này</code> hoặc <code>lịch cả tháng này</code>
• <code>lịch tuần này</code> hoặc <code>lịch tuần sau</code>
• <code>lịch ngày 22</code> hoặc <code>hôm nay có lịch gì không</code>
• <code>học lái xe từ 13h-17h thứ 4 tuần sau</code>
• <code>sửa lịch học lái xe thành 13h30</code>
• <code>mai 9h đi họp với sếp ở Highland Coffee</code>
• <code>đổi giờ thông báo sang 8h</code>
• <code>tìm lịch học lái xe</code>
• <code>xóa lịch học lái xe</code>

📋 <b>Lệnh xem lịch:</b>
/today — Xem lịch hôm nay
/tomorrow — Xem lịch ngày mai
/events — Xem 10 sự kiện sắp tới
/date DD/MM/YYYY — Xem lịch ngày cụ thể
/search từ_khóa — Tìm kiếm sự kiện

⚙️ <b>Cài đặt thông báo lịch:</b>
/settings — Mở bảng cài đặt giờ gửi thông báo lịch hàng ngày
/reminder — Xem trạng thái và đổi giờ thông báo

🧠 <b>Quản lý lịch trình bằng AI (Ma trận Eisenhower):</b>
• <code>/manage</code> hoặc <code>quản lý</code> — Phân tích toàn bộ lịch theo 4 góc phần tư Eisenhower (Q1, Q2, Q3, Q4) & đánh giá mức độ cân bằng quỹ thời gian.
• Nhắn tự nhiên: <code>quản lý lịch trình</code>, <code>đánh giá lịch của tôi</code>, <code>quản lý hôm nay</code>, <code>quản lý tuần này</code>.

📊 <b>Báo cáo công việc / vận hành hàng ngày:</b>
• <code>/report</code> hoặc <code>báo cáo</code> — Xem báo cáo ngày hôm qua
• <code>/report 16/10</code> — Xem báo cáo theo ngày cụ thể
• <code>/set_report_url link_google_sheet</code> — Cập nhật file Google Sheet
• <code>/report_settings</code> — Xem cấu hình báo cáo
• Tự động gửi báo cáo mỗi ngày lúc <b>15:00</b>

➕ <b>Lệnh thêm lịch (tùy chọn):</b>
<code>/add học lái xe từ 13h-17h thứ 4 tuần sau</code>

📝 <b>Sửa & Xóa:</b>
<code>/edit eventId | title=Tên mới</code>
<code>/delete eventId</code>

🔔 <b>Tự động nhắc nhở:</b>
Bot tự động nhắc trước 15 phút khi sắp tới giờ sự kiện và tóm tắt lịch mỗi sáng theo giờ bạn cài đặt.
    `.trim();
  }
}
