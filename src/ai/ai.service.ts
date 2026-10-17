import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { CalendarEvent } from '../google-calendar/google-calendar.service';

export interface ParsedEventData {
  summary: string;
  startTime: Date;
  endTime: Date;
  description?: string;
  location?: string;
}

export interface UpdateEventData {
  targetEventTitle: string;
  newTitle?: string;
  newStartTime?: Date;
  newEndTime?: Date;
  newTimeStr?: string;
  newDateStr?: string;
  newLocation?: string;
  newDescription?: string;
}

export type UserIntent =
  | 'CREATE_EVENT'
  | 'UPDATE_EVENT'
  | 'VIEW_TODAY'
  | 'VIEW_TOMORROW'
  | 'VIEW_DATE'
  | 'VIEW_THIS_WEEK'
  | 'VIEW_NEXT_WEEK'
  | 'VIEW_THIS_MONTH'
  | 'VIEW_NEXT_MONTH'
  | 'VIEW_UPCOMING'
  | 'SEARCH_EVENTS'
  | 'DELETE_EVENT'
  | 'SET_REMINDER_TIME'
  | 'GENERATE_REPORT'
  | 'SET_REPORT_URL'
  | 'SET_REPORT_TIME'
  | 'ANALYZE_SCHEDULE'
  | 'CHAT'
  | 'UNKNOWN';

export interface ProcessedUserMessage {
  intent: UserIntent;
  event?: ParsedEventData;
  updateData?: UpdateEventData;
  targetDate?: Date;
  reminderTime?: string;
  reminderEnabled?: boolean;
  searchQuery?: string;
  deleteKeyword?: string;
  reportUrl?: string;
  scheduleScope?: 'today' | 'week' | 'month' | 'upcoming';
  aiReply?: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private genAI: GoogleGenAI | null = null;
  private apiKey: string | null = null;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY') || process.env.GEMINI_API_KEY || null;
    if (this.apiKey && this.apiKey !== 'your_gemini_api_key') {
      try {
        this.genAI = new GoogleGenAI({ apiKey: this.apiKey });
        this.logger.log('Gemini AI initialized successfully.');
      } catch (err) {
        this.logger.error('Failed to initialize Gemini AI:', err);
      }
    } else {
      this.logger.log('GEMINI_API_KEY not configured. Using built-in Vietnamese NLP parser.');
    }
  }

  /**
   * Process a user message using Gemini AI or fallback to Rule-based NLP
   */
  async processMessage(userText: string): Promise<ProcessedUserMessage> {
    const text = userText.trim();

    // 1. If Gemini AI is available, use it for intelligent NLU
    if (this.genAI) {
      try {
        const result = await this.parseWithGemini(text);
        if (result && result.intent !== 'UNKNOWN') {
          return result;
        }
      } catch (error) {
        this.logger.warn(`Gemini processing error, falling back to rule-based NLP: ${error.message}`);
      }
    }

    // 2. Rule-based Vietnamese NLP Parser
    return this.parseWithRuleBasedNlp(text);
  }

  /**
   * Parse user message with Google Gemini
   */
  private async parseWithGemini(text: string): Promise<ProcessedUserMessage | null> {
    const now = new Date();
    const timeZone = this.configService.get<string>('TIMEZONE') || 'Asia/Ho_Chi_Minh';
    const currentTimeStr = now.toLocaleString('vi-VN', { timeZone });

    const prompt = `
Bạn là trợ lý AI chuyên trích xuất thông tin lịch từ tin nhắn tiếng Việt của người dùng.
Thời gian hiện tại: ${currentTimeStr} (Timezone: ${timeZone}, ISO: ${now.toISOString()}).

Nhiệm vụ:
Phân tích tin nhắn của người dùng và trả về DUY NHẤT một đối tượng JSON hợp lệ (không kèm markdown code block hoặc text nào khác) theo schema sau:

{
  "intent": "CREATE_EVENT" | "UPDATE_EVENT" | "VIEW_TODAY" | "VIEW_TOMORROW" | "VIEW_DATE" | "VIEW_THIS_WEEK" | "VIEW_NEXT_WEEK" | "VIEW_THIS_MONTH" | "VIEW_NEXT_MONTH" | "VIEW_UPCOMING" | "SEARCH_EVENTS" | "DELETE_EVENT" | "SET_REMINDER_TIME" | "GENERATE_REPORT" | "SET_REPORT_URL" | "SET_REPORT_TIME" | "ANALYZE_SCHEDULE" | "CHAT" | "UNKNOWN",
  "event": {
    "summary": "Tên sự kiện (ví dụ: Học lái xe, Họp team, Đi ăn)",
    "startTime": "ISO 8601 string với múi giờ +07:00",
    "endTime": "ISO 8601 string với múi giờ +07:00 (mặc định nếu người dùng không nói thì +1 tiếng so với startTime)",
    "description": "Mô tả nếu có",
    "location": "Địa điểm nếu có"
  },
  "update": {
    "targetEventTitle": "tên sự kiện cần tìm để sửa (ví dụ: học lái xe, họp nhóm)",
    "newTitle": "tên mới nếu người dùng muốn đổi tên sự kiện",
    "newStartTime": "ISO 8601 string nếu có ngày giờ cụ thể",
    "newEndTime": "ISO 8601 string nếu có ngày giờ kết thúc cụ thể",
    "newTimeStr": "chuỗi giờ nếu chỉ sửa giờ bắt đầu (ví dụ: '13h30' hoặc '13:30')",
    "newDateStr": "chuỗi ngày nếu chỉ đổi ngày (ví dụ: 'ngày mai', 'thứ 5')",
    "newLocation": "địa điểm mới nếu có",
    "newDescription": "ghi chú mới nếu có"
  },
  "targetDate": "YYYY-MM-DD (dùng khi intent là VIEW_DATE hoặc GENERATE_REPORT có ngày cụ thể)",
  "reminderTime": "chuỗi giờ dạng '08:00' hoặc '15:00' nếu cài giờ thông báo lịch hoặc giờ gửi báo cáo",
  "reminderEnabled": true hoặc false nếu người dùng muốn bật hoặc tắt thông báo hàng ngày,
  "reportUrl": "đường link Google Sheet nếu intent là SET_REPORT_URL",
  "scheduleScope": "today" | "week" | "month" | "upcoming" (dùng khi intent là ANALYZE_SCHEDULE, mặc định là "week"),
  "searchQuery": "từ khóa tìm kiếm nếu intent là SEARCH_EVENTS (LƯU Ý: chỉ dùng khi tìm theo TÊN sự kiện, không dùng khi tìm theo ngày)",
  "deleteKeyword": "từ khóa hoặc tên sự kiện muốn xóa nếu intent là DELETE_EVENT",
  "aiReply": "Lời phản hồi thân thiện ngắn gọn bằng tiếng Việt nếu là CHAT"
}

Lưu ý:
- "thứ 4 tuần sau": tính đúng ngày thứ 4 của tuần tiếp theo.
- "mai", "ngày mai": ngày kế tiếp.
- Nếu người dùng yêu cầu báo cáo (ví dụ: "báo cáo hôm nay", "gửi báo cáo", "xem báo cáo", "báo cáo", "báo cáo ngày 16/10", "chạy báo cáo") -> intent BẮT BUỘC là "GENERATE_REPORT". Nếu có ngày thì trả về targetDate tương ứng.
- Nếu người dùng yêu cầu quản lý lịch, phân tích lịch trình, đánh giá lịch trình theo ma trận Eisenhower (ví dụ: "quản lý", "quản lý lịch trình", "phân tích lịch", "đánh giá lịch", "ma trận eisenhower", "tối ưu lịch", "quản lý lịch của tôi") -> intent BẮT BUỘC là "ANALYZE_SCHEDULE". Gán scheduleScope tương ứng ("today" nếu hỏi hôm nay, "month" nếu hỏi tháng, "upcoming" nếu hỏi sắp tới, mặc định "week").
- Nếu người dùng gửi link Google Sheet cài đặt báo cáo (ví dụ: "cài link báo cáo https://docs.google.com/...", "link báo cáo https://...", hoặc chỉ gửi link docs.google.com/spreadsheets/...) -> intent BẮT BUỘC là "SET_REPORT_URL", reportUrl là link Google Sheet đó.
- Nếu người dùng yêu cầu đổi giờ gửi báo cáo (ví dụ: "đổi giờ báo cáo sang 15h", "cài giờ gửi báo cáo lúc 15:00") -> intent là "SET_REPORT_TIME", reminderTime là "15:00".
- Nếu người dùng hỏi xem lịch của một ngày cụ thể (ví dụ: "lịch ngày 22", "ngày 22 có lịch gì không", "lịch 22/10", "lịch thứ 4 tuần sau", "xem lịch ngày 25") -> intent BẮT BUỘC là "VIEW_DATE", targetDate là "YYYY-MM-DD" tương ứng (ví dụ: "2026-10-22"). TUYỆT ĐỐI KHÔNG xếp vào SEARCH_EVENTS.
- Nếu người dùng hỏi xem lịch tuần này (ví dụ: "lịch tuần này", "tuần này có lịch gì", "lịch cả tuần này") -> intent là "VIEW_THIS_WEEK".
- Nếu người dùng hỏi xem lịch tuần sau (ví dụ: "lịch tuần sau", "tuần sau có lịch gì") -> intent là "VIEW_NEXT_WEEK".
- Nếu người dùng hỏi xem lịch tháng này (ví dụ: "lịch tháng này", "lịch cả tháng này", "tháng này có lịch gì", "tháng này có gì") -> intent là "VIEW_THIS_MONTH".
- Nếu người dùng hỏi xem lịch tháng sau (ví dụ: "lịch tháng sau", "tháng sau có lịch gì") -> intent là "VIEW_NEXT_MONTH".
- Chỉ khi người dùng nói chung chung "lịch sắp tới", "sự kiện sắp tới", "xem lịch" mà không nói rõ tuần/tháng nào -> intent mới là "VIEW_UPCOMING".
- Nếu người dùng nhắn: "thêm lịch học lái xe từ 13h-17h ngày thứ 4 tuần sau" -> intent là "CREATE_EVENT", summary là "Học lái xe", startTime lúc 13:00, endTime lúc 17:00.
- Nếu người dùng nhắn: "sửa lịch học lái xe thành 13h30" -> intent là "UPDATE_EVENT", update: { targetEventTitle: "học lái xe", newTimeStr: "13h30" }.
- Nếu người dùng nhắn: "đổi lịch họp sang 15h ngày mai" -> intent là "UPDATE_EVENT", update: { targetEventTitle: "họp", newTimeStr: "15h", newDateStr: "ngày mai" }.
- Nếu người dùng nhắn: "cài đặt giờ thông báo lịch hàng ngày lúc 8h" -> intent là "SET_REMINDER_TIME", reminderTime: "08:00".
- Nếu người dùng nhắn: "đổi giờ thông báo sang 6h30" -> intent là "SET_REMINDER_TIME", reminderTime: "06:30".
- Nếu người dùng nhắn: "bật thông báo hàng ngày" -> intent là "SET_REMINDER_TIME", reminderEnabled: true.
- Nếu người dùng nhắn: "tắt thông báo hàng ngày" -> intent là "SET_REMINDER_TIME", reminderEnabled: false.
- Nếu người dùng chào hỏi bình thường -> intent là "CHAT".
- Chỉ xuất JSON, không giải thích.

Tin nhắn người dùng: "${text}"
`;

    const preferredModel =
      this.configService.get<string>('GEMINI_MODEL') ||
      process.env.GEMINI_MODEL ||
      'gemini-3-flash-preview';

    try {
      let response;
      try {
        response = await this.genAI!.models.generateContent({
          model: preferredModel,
          contents: prompt,
        });
      } catch (err: any) {
        // If preview model has a temporary 503 spike, fallback to 2.5-flash
        if (preferredModel !== 'gemini-2.5-flash') {
          this.logger.warn(`Model ${preferredModel} hit error, falling back to gemini-2.5-flash: ${err.message}`);
          response = await this.genAI!.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
          });
        } else {
          throw err;
        }
      }

      const raw = response.text?.trim() || '';
      const cleanJson = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(cleanJson);

      if (parsed.intent === 'CREATE_EVENT' && parsed.event?.startTime && parsed.event?.summary) {
        return {
          intent: 'CREATE_EVENT',
          event: {
            summary: parsed.event.summary,
            startTime: new Date(parsed.event.startTime),
            endTime: parsed.event.endTime ? new Date(parsed.event.endTime) : new Date(new Date(parsed.event.startTime).getTime() + 3600000),
            description: parsed.event.description || undefined,
            location: parsed.event.location || undefined,
          },
          aiReply: parsed.aiReply,
        };
      }

      if (parsed.intent === 'UPDATE_EVENT' && parsed.update?.targetEventTitle) {
        return {
          intent: 'UPDATE_EVENT',
          updateData: {
            targetEventTitle: parsed.update.targetEventTitle,
            newTitle: parsed.update.newTitle || undefined,
            newStartTime: parsed.update.newStartTime ? new Date(parsed.update.newStartTime) : undefined,
            newEndTime: parsed.update.newEndTime ? new Date(parsed.update.newEndTime) : undefined,
            newTimeStr: parsed.update.newTimeStr || undefined,
            newDateStr: parsed.update.newDateStr || undefined,
            newLocation: parsed.update.newLocation || undefined,
            newDescription: parsed.update.newDescription || undefined,
          },
          aiReply: parsed.aiReply,
        };
      }

      if (parsed.intent === 'VIEW_DATE' && parsed.targetDate) {
        const parts = parsed.targetDate.split('-');
        if (parts.length === 3) {
          const targetDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          return {
            intent: 'VIEW_DATE',
            targetDate: isNaN(targetDate.getTime()) ? undefined : targetDate,
            aiReply: parsed.aiReply,
          };
        }
      }

      if (parsed.intent === 'SET_REPORT_URL') {
        return {
          intent: 'SET_REPORT_URL',
          reportUrl: parsed.reportUrl,
          aiReply: parsed.aiReply,
        };
      }

      if (parsed.intent === 'SET_REPORT_TIME') {
        return {
          intent: 'SET_REPORT_TIME',
          reminderTime: parsed.reminderTime,
          aiReply: parsed.aiReply,
        };
      }

      if (parsed.intent === 'GENERATE_REPORT') {
        let targetDate: Date | undefined;
        if (parsed.targetDate) {
          const parts = parsed.targetDate.split('-');
          if (parts.length === 3) {
            targetDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          }
        }
        return {
          intent: 'GENERATE_REPORT',
          targetDate,
          aiReply: parsed.aiReply,
        };
      }

      if (parsed.intent === 'SET_REMINDER_TIME') {
        return {
          intent: 'SET_REMINDER_TIME',
          reminderTime: parsed.reminderTime || undefined,
          reminderEnabled: parsed.reminderEnabled !== undefined ? parsed.reminderEnabled : undefined,
          aiReply: parsed.aiReply,
        };
      }

      if (parsed.intent === 'ANALYZE_SCHEDULE') {
        let scheduleScope: 'today' | 'week' | 'month' | 'upcoming' = 'month';
        if (['today', 'week', 'month', 'upcoming'].includes(parsed.scheduleScope)) {
          scheduleScope = parsed.scheduleScope;
        }
        return {
          intent: 'ANALYZE_SCHEDULE',
          scheduleScope,
          aiReply: parsed.aiReply,
        };
      }

      return {
        intent: parsed.intent || 'UNKNOWN',
        searchQuery: parsed.searchQuery,
        deleteKeyword: parsed.deleteKeyword,
        aiReply: parsed.aiReply,
      };
    } catch (e) {
      this.logger.error('Error in parseWithGemini:', e);
      return null;
    }
  }

  /**
   * Rule-based Vietnamese NLP parser
   */
  public parseWithRuleBasedNlp(text: string, referenceDate: Date = new Date()): ProcessedUserMessage {
    const cleanLower = text.toLowerCase().trim();

    // 0. Check Set Report URL
    const reportUrlMatch =
      text.match(/(?:cài\s*đặt|cài|đổi|lưu)?\s*(?:link|url|file)?\s*báo\s*cáo\s*[:\s]+(https:\/\/docs\.google\.com\/spreadsheets\/[^\s]+)/i) ||
      text.match(/^(https:\/\/docs\.google\.com\/spreadsheets\/[^\s]+)$/i);
    if (reportUrlMatch) {
      return {
        intent: 'SET_REPORT_URL',
        reportUrl: reportUrlMatch[1].trim(),
      };
    }

    // 0.5. Check Set Report Time
    const reportTimeMatch = cleanLower.match(
      /(?:cài\s*đặt|đổi|chỉnh|chọn|đặt)?\s*giờ\s+(?:gửi\s+)?báo\s*cáo\s*(?:hàng\s*ngày\s+)?(?:sang|thành|lúc|vào)?\s*(\d{1,2}(?:[h:]\d{2}|h)?)/i,
    );
    if (reportTimeMatch) {
      return {
        intent: 'SET_REPORT_TIME',
        reminderTime: reportTimeMatch[1].trim(),
      };
    }

    // 0.7. Check Generate Report
    if (
      /^(?:gửi\s+|xem\s+|lấy\s+|chạy\s+)?báo\s*cáo(?:\s+công\s+việc|\s+vận\s+hành|\s+hôm\s*nay|\s+ngày\s+(\d{1,2})[\/\-](\d{1,2}))?$/i.test(
        cleanLower,
      ) || cleanLower === 'báo cáo'
    ) {
      const match = cleanLower.match(/ngày\s+(\d{1,2})[\/\-](\d{1,2})/i);
      let targetDate: Date | undefined;
      if (match) {
        const d = parseInt(match[1], 10);
        const m = parseInt(match[2], 10) - 1;
        targetDate = new Date(referenceDate.getFullYear(), m, d);
      }
      return {
        intent: 'GENERATE_REPORT',
        targetDate,
      };
    }

    // 0.8. Check Analyze Schedule / Eisenhower
    if (
      /^(?:[\u{1F300}-\u{1F9FF}]\s*)?(?:quản\s*lý|quản\s*lý\s*lịch(?:\s*trình)?|phân\s*tích\s*lịch(?:\s*trình)?|đánh\s*giá\s*lịch(?:\s*trình)?|ma\s*trận\s*eisenhower|eisenhower|tối\s*ưu\s*lịch)(?:\s*(?:hôm\s*nay|tuần\s*này|tháng\s*này|sắp\s*tới))?$/iu.test(
        cleanLower,
      ) ||
      /(?:ma\s*trận\s*eisenhower|phân\s*tích\s*theo\s*eisenhower|đánh\s*giá\s*lịch\s*của\s*tôi|quản\s*lý\s*lịch\s*của\s*tôi)/i.test(
        cleanLower,
      )
    ) {
      let scope: 'today' | 'week' | 'month' | 'upcoming' = 'month';
      if (/hôm\s*nay/i.test(cleanLower)) scope = 'today';
      else if (/tuần/i.test(cleanLower)) scope = 'week';
      else if (/sắp\s*tới|tới/i.test(cleanLower)) scope = 'upcoming';
      return { intent: 'ANALYZE_SCHEDULE', scheduleScope: scope };
    }

    // 1. Check Set Reminder Time or Toggle
    const reminderTimeMatch = cleanLower.match(
      /(?:cài\s*đặt|đổi|chỉnh|chọn|đặt)?\s*giờ\s+(?:gửi\s+)?(?:thông\s*báo|nhắc\s*lịch|tóm\s*tắt)\s*(?:lịch\s+)?(?:hàng\s*ngày\s+)?(?:sang|thành|lúc|vào)?\s*(\d{1,2}(?:[h:]\d{2}|h)?)/i,
    );
    if (reminderTimeMatch) {
      return {
        intent: 'SET_REMINDER_TIME',
        reminderTime: reminderTimeMatch[1].trim(),
      };
    }

    if (/(?:bật|mở)\s+(?:thông\s*báo|nhắc\s*lịch)\s*(?:hàng\s*ngày)?/i.test(cleanLower)) {
      return {
        intent: 'SET_REMINDER_TIME',
        reminderEnabled: true,
      };
    }

    if (/(?:tắt|hủy)\s+(?:thông\s*báo|nhắc\s*lịch)\s*(?:hàng\s*ngày)?/i.test(cleanLower)) {
      return {
        intent: 'SET_REMINDER_TIME',
        reminderEnabled: false,
      };
    }

    // 2. Check View Today
    if (
      /^(hôm\s*nay\s+có\s+(lịch|việc|gì)|lịch\s+hôm\s*nay|xem\s+lịch\s+hôm\s*nay|hôm\s*nay\s+làm\s+gì)/i.test(
        cleanLower,
      )
    ) {
      return { intent: 'VIEW_TODAY' };
    }

    // 3. Check View Tomorrow
    if (
      /^(ngày\s*mai\s+có\s+(lịch|việc|gì)|mai\s+có\s+(lịch|việc|gì)|lịch\s+ngày\s*mai|lịch\s+mai|xem\s+lịch\s+ngày\s*mai)/i.test(
        cleanLower,
      )
    ) {
      return { intent: 'VIEW_TOMORROW' };
    }

    // 4. Check View Specific Date (e.g. "lịch ngày 22", "ngày 22 có lịch gì", "lịch 22/10", "lịch ngày 22/10/2026")
    const dateQueryMatch = cleanLower.match(
      /(?:xem\s+lịch|lịch\s+ngày|lịch|ngày)\s+(\d{1,2})(?:[\/\-](\d{1,2}))?(?:[\/\-](\d{4}))?(?:\s+(?:có\s+lịch\s+gì|có\s+gì|làm\s+gì))?/i,
    );
    if (dateQueryMatch && !/hôm\s*nay|ngày\s*mai|mai/i.test(cleanLower)) {
      const day = parseInt(dateQueryMatch[1], 10);
      const month = dateQueryMatch[2] ? parseInt(dateQueryMatch[2], 10) - 1 : referenceDate.getMonth();
      const year = dateQueryMatch[3] ? parseInt(dateQueryMatch[3], 10) : referenceDate.getFullYear();
      if (day >= 1 && day <= 31) {
        return {
          intent: 'VIEW_DATE',
          targetDate: new Date(year, month, day),
        };
      }
    }

    // 5. Check View Week / Month
    if (/(?:cả\s+)?tuần\s+này/i.test(cleanLower)) {
      return { intent: 'VIEW_THIS_WEEK' };
    }
    if (/(?:cả\s+)?tuần\s+sau/i.test(cleanLower)) {
      return { intent: 'VIEW_NEXT_WEEK' };
    }
    if (/(?:cả\s+)?tháng\s+này/i.test(cleanLower)) {
      return { intent: 'VIEW_THIS_MONTH' };
    }
    if (/(?:cả\s+)?tháng\s+sau/i.test(cleanLower)) {
      return { intent: 'VIEW_NEXT_MONTH' };
    }

    // 6. Check View Upcoming (generic)
    if (
      /^(xem\s+lịch(\s+sắp\s+tới)?|lịch\s+sắp\s+tới|sự\s+kiện\s+sắp\s+tới|danh\s+sách\s+lịch)/i.test(
        cleanLower,
      )
    ) {
      return { intent: 'VIEW_UPCOMING' };
    }

    // 5. Check Edit / Update Event Intent
    const updateMatch = cleanLower.match(/^(?:sửa\s+lịch|đổi\s+lịch|dời\s+lịch|chuyển\s+lịch|cập\s+nhật\s+lịch)\s+(.+)$/i);
    if (updateMatch) {
      const rest = updateMatch[1].trim();
      const splitMatch = rest.match(/^(.+?)\s+(?:thành|sang|lúc|vào|đến)\s+(.+)$/i);
      let targetTitle = rest;
      let changePart = '';
      if (splitMatch) {
        targetTitle = splitMatch[1].trim();
        changePart = splitMatch[2].trim();
      }

      const timeMatch = changePart.match(/(\d{1,2})(?:[h:](\d{2})?|h)/i);
      const hasDate = /(ngày\s*mai|\bmai\b|mốt|thứ\s*[2-7]|thứ\s*(hai|ba|tư|năm|sáu|bảy)|chủ\s*nhật|cn)/i.test(changePart);

      return {
        intent: 'UPDATE_EVENT',
        updateData: {
          targetEventTitle: targetTitle,
          newTimeStr: timeMatch ? timeMatch[0] : undefined,
          newDateStr: hasDate ? changePart : undefined,
          newTitle: !timeMatch && !hasDate && changePart ? changePart : undefined,
        },
      };
    }

    // 4. Check Search
    const searchMatch = cleanLower.match(/^(?:tìm\s+lịch|tìm\s+kiếm|tìm)\s+(.+)$/i);
    if (searchMatch) {
      return {
        intent: 'SEARCH_EVENTS',
        searchQuery: searchMatch[1].trim(),
      };
    }

    // 5. Check Delete
    const deleteMatch = cleanLower.match(/^(?:xóa\s+lịch|hủy\s+lịch|xóa\s+sự\s+kiện)\s+(.+)$/i);
    if (deleteMatch) {
      return {
        intent: 'DELETE_EVENT',
        deleteKeyword: deleteMatch[1].trim(),
      };
    }

    // 6. Check Create Event Intent
    const isExplicitCreate = /^(thêm\s+lịch|tạo\s+lịch|lên\s+lịch|đặt\s+lịch|nhắc\s+lịch|nhắc\s+tôi|nhắc\s+nhở|\/add)/i.test(
      cleanLower,
    );

    const hasTimeOrDate =
      /\b(hôm\s*nay|ngày\s*mai|\bmai\b|mốt|thứ\s*[2-7]|thứ\s*(hai|ba|tư|năm|sáu|bảy)|chủ\s*nhật|cn|\d{1,2}[h:]|\d{1,2}\/\d{1,2})\b/i.test(
        cleanLower,
      );

    if (isExplicitCreate || hasTimeOrDate) {
      const parsedEvent = this.parseVietnameseEvent(text, referenceDate);
      if (parsedEvent) {
        return {
          intent: 'CREATE_EVENT',
          event: parsedEvent,
        };
      }
    }

    return {
      intent: 'CHAT',
      aiReply:
        'Tôi có thể giúp bạn tạo lịch, xem lịch hoặc nhắc việc. Ví dụ bạn có thể nhắn:\n\n' +
        '• "thêm lịch học lái xe từ 13h-17h ngày thứ 4 tuần sau"\n' +
        '• "mai 9h đi họp với sếp ở Highland"\n' +
        '• "hôm nay có lịch gì không"\n' +
        '• "lịch ngày mai"',
    };
  }

  /**
   * Parse Vietnamese natural sentence into structured event details
   */
  public parseVietnameseEvent(text: string, referenceDate: Date = new Date()): ParsedEventData | null {
    let clean = text.trim();
    clean = clean.replace(/^\/add\s*/i, '');
    clean = clean.replace(
      /^(thêm\s+lịch|tạo\s+lịch|lên\s+lịch|đặt\s+lịch|nhắc\s+lịch|nhắc\s+tôi|nhắc\s+nhở|nhớ|lịch)\s+/i,
      '',
    );

    let location: string | undefined;
    // Match "ở <địa điểm>" or "tại <địa điểm>"
    const locMatch = clean.match(/(?:ở|tại)\s+([^,\.\n]+)$/i);
    if (locMatch) {
      location = locMatch[1].trim();
      clean = clean.replace(/(?:ở|tại)\s+[^,\.\n]+$/i, '').trim();
    }

    let targetDate = new Date(referenceDate);
    let dateFound = false;

    // Check "ngày DD tháng MM [năm YYYY]"
    const vietDateMatch = clean.match(/(?:ngày\s+)?(\d{1,2})\s+tháng\s+(\d{1,2})(?:\s+năm\s+(\d{4}))?/i);
    if (vietDateMatch) {
      const day = parseInt(vietDateMatch[1], 10);
      const month = parseInt(vietDateMatch[2], 10) - 1;
      const year = vietDateMatch[3] ? parseInt(vietDateMatch[3], 10) : referenceDate.getFullYear();
      targetDate = new Date(year, month, day);
      dateFound = true;
      clean = clean.replace(vietDateMatch[0], ' ');
    }

    // Check specific date: "ngày DD/MM[/YYYY]" or "DD/MM[/YYYY]"
    if (!dateFound) {
      const specificDateMatch = clean.match(/(?:ngày\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/i);
      if (specificDateMatch && !clean.includes('h-') && !clean.includes('h -')) {
        const day = parseInt(specificDateMatch[1], 10);
        const month = parseInt(specificDateMatch[2], 10) - 1;
        const year = specificDateMatch[3] ? parseInt(specificDateMatch[3], 10) : referenceDate.getFullYear();
        targetDate = new Date(year, month, day);
        dateFound = true;
        clean = clean.replace(specificDateMatch[0], ' ');
      }
    }

    if (!dateFound) {
      // Relative days
      if (/(hôm\s*nay|bữa\s*nay|tối\s*nay|chiều\s*nay|sáng\s*nay|trưa\s*nay)/i.test(clean)) {
        targetDate = new Date(referenceDate);
        dateFound = true;
        clean = clean.replace(/(hôm\s*nay|bữa\s*nay|tối\s*nay|chiều\s*nay|sáng\s*nay|trưa\s*nay)/gi, ' ');
      } else if (/(ngày\s*mốt|mốt|ngày\s*kia)/i.test(clean)) {
        targetDate = new Date(referenceDate);
        targetDate.setDate(targetDate.getDate() + 2);
        dateFound = true;
        clean = clean.replace(/(ngày\s*mốt|mốt|ngày\s*kia)/gi, ' ');
      } else if (/(ngày\s*mai|\bmai\b|sáng\s*mai|chiều\s*mai|tối\s*mai)/i.test(clean)) {
        targetDate = new Date(referenceDate);
        targetDate.setDate(targetDate.getDate() + 1);
        dateFound = true;
        clean = clean.replace(/(ngày\s*mai|\bmai\b|sáng\s*mai|chiều\s*mai|tối\s*mai)/gi, ' ');
      }
    }

    // Days of week
    if (!dateFound) {
      const dowMatch = clean.match(
        /(?:ngày\s+)?(thứ\s*[2-7]|thứ\s*hai|thứ\s*ba|thứ\s*tư|thứ\s*năm|thứ\s*sáu|thứ\s*bảy|chủ\s*nhật|cn)(?:\s+(tuần\s*sau|tuần\s*tới|tuần\s*này|tới))?/i,
      );
      if (dowMatch) {
        const dowStr = dowMatch[1].toLowerCase();
        const weekMod = (dowMatch[2] || '').toLowerCase();

        let targetDow = -1; // 0: CN, 1: T2, 2: T3, 3: T4, 4: T5, 5: T6, 6: T7
        if (dowStr.includes('2') || dowStr.includes('hai')) targetDow = 1;
        else if (dowStr.includes('3') || dowStr.includes('ba')) targetDow = 2;
        else if (dowStr.includes('4') || dowStr.includes('tư')) targetDow = 3;
        else if (dowStr.includes('5') || dowStr.includes('năm')) targetDow = 4;
        else if (dowStr.includes('6') || dowStr.includes('sáu')) targetDow = 5;
        else if (dowStr.includes('7') || dowStr.includes('bảy')) targetDow = 6;
        else if (dowStr.includes('nhật') || dowStr.includes('cn')) targetDow = 0;

        if (targetDow !== -1) {
          const currentDow = referenceDate.getDay();
          const currNorm = currentDow === 0 ? 7 : currentDow;
          const targetNorm = targetDow === 0 ? 7 : targetDow;

          let diff = targetNorm - currNorm;
          if (weekMod.includes('sau') || weekMod.includes('tới')) {
            diff = 7 - currNorm + targetNorm;
          } else if (weekMod.includes('này')) {
            diff = targetNorm - currNorm;
          } else {
            if (diff <= 0) {
              diff += 7;
            }
          }

          targetDate = new Date(referenceDate);
          targetDate.setDate(targetDate.getDate() + diff);
          dateFound = true;
          clean = clean.replace(dowMatch[0], ' ');
        }
      }
    }

    // Extract Time
    let startHour = 9;
    let startMin = 0;
    let endHour = 10;
    let endMin = 0;
    let timeFound = false;

    // Range: "từ 13h - 17h", "13h-17h", "13h đến 17h", "13:00 - 17:00", etc.
    const rangeRegex = /(?:từ\s+)?(\d{1,2})(?:[h:](\d{2})?|h)\s*(?:-|đến|tới|\.\.\.)\s*(\d{1,2})(?:[h:](\d{2})?|h)/i;
    const rangeMatch = clean.match(rangeRegex);

    if (rangeMatch) {
      startHour = parseInt(rangeMatch[1], 10);
      startMin = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : 0;
      endHour = parseInt(rangeMatch[3], 10);
      endMin = rangeMatch[4] ? parseInt(rangeMatch[4], 10) : 0;
      timeFound = true;
      clean = clean.replace(rangeMatch[0], ' ');
    } else {
      // Single time
      const singleRegex = /(?:lúc|vào|khoảng)?\s*(\d{1,2})(?:[h:](\d{2})?|h)\s*(sáng|trưa|chiều|tối)?/i;
      const singleMatch = clean.match(singleRegex);
      if (singleMatch && (clean.includes('h') || clean.includes(':') || singleMatch[1])) {
        startHour = parseInt(singleMatch[1], 10);
        startMin = singleMatch[2] ? parseInt(singleMatch[2], 10) : 0;
        const period = (singleMatch[3] || '').toLowerCase();
        if ((period === 'chiều' || period === 'tối') && startHour < 12) {
          startHour += 12;
        }
        endHour = startHour + 1;
        endMin = startMin;
        timeFound = true;
        clean = clean.replace(singleMatch[0], ' ');
      }
    }

    // If neither date nor time was found, not an event
    if (!dateFound && !timeFound) {
      return null;
    }

    const startTime = new Date(targetDate);
    startTime.setHours(startHour, startMin, 0, 0);

    const endTime = new Date(targetDate);
    endTime.setHours(endHour, endMin, 0, 0);
    if (endTime <= startTime) {
      endTime.setHours(startTime.getHours() + 1);
    }

    let summary = clean
      .replace(/\b(từ|ngày|lúc|vào|đến|tới|khoảng|lịch|buổi|sáng|trưa|chiều|tối)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (summary) {
      summary = summary.charAt(0).toUpperCase() + summary.slice(1);
    } else {
      summary = 'Sự kiện mới';
    }

    return {
      summary,
      startTime,
      endTime,
      location,
      description: undefined,
    };
  }

  /**
   * Analyze calendar events using Eisenhower Matrix and provide AI evaluations & recommendations
   */
  async analyzeEisenhowerMatrix(
    events: CalendarEvent[],
    scopeTitle = 'Sắp tới',
  ): Promise<string> {
    if (events.length === 0) {
      return (
        `🧠 <b>QUẢN LÝ LỊCH TRÌNH BẰNG AI (MA TRẬN EISENHOWER)</b>\n\n` +
        `📅 <i>Phạm vi: ${scopeTitle}</i>\n\n` +
        `📭 Hiện tại bạn chưa có sự kiện nào trong danh sách.\n` +
        `💡 <i>Hãy thêm lịch mới (ví dụ: "mai 9h họp chiến lược", "học tiếng Anh 19h") để AI phân tích và tối ưu quỹ thời gian cho bạn nhé!</i>`
      );
    }

    // Format events list for Gemini prompt
    const eventsFormatted = events
      .map((e, idx) => {
        const start = new Date(e.startTime).toLocaleString('vi-VN', {
          timeZone: 'Asia/Ho_Chi_Minh',
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
        const end = new Date(e.endTime).toLocaleTimeString('vi-VN', {
          timeZone: 'Asia/Ho_Chi_Minh',
          hour: '2-digit',
          minute: '2-digit',
        });
        return `${idx + 1}. "${e.summary}" (${start} → ${end})${e.location ? ' tại ' + e.location : ''}${e.description ? ' - ' + e.description : ''}`;
      })
      .join('\n');

    const prompt = `
Bạn là chuyên gia cố vấn năng suất hàng đầu về quản lý thời gian và quản trị cá nhân.
Nhiệm vụ: Phân tích danh sách lịch trình sau đây của người dùng theo Phương pháp Ma trận Eisenhower (Eisenhower Matrix) và đưa ra đánh giá, nhận xét, lời khuyên tối ưu lịch.

Danh sách sự kiện (${scopeTitle}):
${eventsFormatted}

Yêu cầu định dạng phản hồi:
- Sử dụng chuẩn HTML của Telegram (CHỈ dùng <b>, <i>, <code>). TUYỆT ĐỐI KHÔNG dùng markdown (không dùng **, ##, \`\`\`).
- TUYỆT ĐỐI KHÔNG dùng các thẻ <p>, </p>, <br>, <ul>, </ul>, <ol>, </ol>, <li>, </li>, <div>, </div>. Chỉ dùng dấu xuống dòng bình thường và ký hiệu đầu dòng •.
- Cấu trúc phản hồi rõ ràng, mạch lạc, đẹp mắt, có emoji sinh động:
  1. Tiêu đề: 🧠 <b>PHÂN TÍCH LỊCH TRÌNH (MA TRẬN EISENHOWER)</b>\n📅 <i>Phạm vi: ${scopeTitle} (${events.length} sự kiện)</i>
  2. Phân loại từng sự kiện vào đúng 4 góc phần tư:
     🔴 <b>Q1: Khẩn cấp & Quan trọng (Làm ngay)</b>: Các deadline sát nút, họp quan trọng với đối tác/sếp/team, sự cố cần giải quyết ngay.
     🔵 <b>Q2: Không khẩn cấp nhưng Quan trọng (Lên kế hoạch & Đầu tư)</b>: Học tập phát triển kỹ năng (học lái xe, học tập), rèn luyện sức khỏe, đào tạo/training, công việc chiến lược dài hạn, xây dựng mối quan hệ.
     🟡 <b>Q3: Khẩn cấp nhưng Không quan trọng (Ủy quyền / Giảm thiểu)</b>: Việc phát sinh gấp, họp sự vụ định kỳ, việc có thể giao người khác.
     ⚪ <b>Q4: Không khẩn cấp & Không quan trọng (Loại bỏ)</b>: Việc tốn thời gian, giải trí thừa thãi.
     (Ghi chú ngắn lý do vì sao xếp sự kiện vào góc đó).
  3. 📊 <b>ĐÁNH GIÁ CHẤT LƯỢNG LỊCH TRÌNH:</b>
     - Nhận xét tỷ lệ phân bổ thời gian. Bạn có đang bị quá tải bởi việc gấp (chữa cháy Q1) hay đang chủ động đầu tư cho tương lai (Q2)?
     - Mức độ cân bằng giữa công việc, học tập và cuộc sống.
  4. 💡 <b>LỜI KHUYÊN & ĐỀ XUẤT TỐI ƯU CỦA AI:</b>
     - 2-3 đề xuất cụ thể (ví dụ: cần chuẩn bị gì trước các buổi hẹn quan trọng, nên dành thêm thời gian nghỉ ngơi hoặc dời lịch nào).

Hãy trả lời bằng tiếng Việt chuyên nghiệp, súc tích và truyền cảm hứng.
`;

    if (this.genAI) {
      try {
        const preferredModel =
          this.configService.get<string>('GEMINI_MODEL') ||
          process.env.GEMINI_MODEL ||
          'gemini-3-flash-preview';

        let response;
        try {
          response = await this.genAI.models.generateContent({
            model: preferredModel,
            contents: prompt,
          });
        } catch (err: any) {
          response = await this.genAI.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
          });
        }

        const reply = response.text?.trim();
        if (reply) {
          return this.sanitizeTelegramHtml(reply);
        }
      } catch (err) {
        this.logger.error('Error generating Eisenhower analysis with Gemini:', err);
      }
    }

    // Fallback rule-based if AI not reachable
    return this.sanitizeTelegramHtml(this.fallbackEisenhowerAnalysis(events, scopeTitle));
  }

  public sanitizeTelegramHtml(text: string): string {
    if (!text) return '';
    return text
      .replace(/<p\b[^>]*>/gi, '')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<ul\b[^>]*>/gi, '')
      .replace(/<\/ul>/gi, '\n')
      .replace(/<ol\b[^>]*>/gi, '')
      .replace(/<\/ol>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '• ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<div\b[^>]*>/gi, '')
      .replace(/<\/div>/gi, '\n')
      .replace(/<h[1-6]\b[^>]*>/gi, '\n<b>')
      .replace(/<\/h[1-6]>/gi, '</b>\n')
      // Strip any tags not supported by Telegram HTML
      .replace(/<(?!\/?(?:b|strong|i|em|u|ins|s|strike|del|code|pre|a|blockquote|tg-spoiler)\b)[^>]*>/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private fallbackEisenhowerAnalysis(events: CalendarEvent[], scopeTitle: string): string {
    const q1: CalendarEvent[] = []; // Urgent & Important (Do First)
    const q2: CalendarEvent[] = []; // Not Urgent & Important (Schedule)
    const q3: CalendarEvent[] = []; // Urgent & Not Important (Delegate)
    const q4: CalendarEvent[] = []; // Not Urgent & Not Important (Eliminate)

    for (const ev of events) {
      const titleLower = ev.summary.toLowerCase();
      if (/họp|khẩn|gấp|sự cố|deadline|báo cáo|quan trọng|power team/i.test(titleLower)) {
        q1.push(ev);
      } else if (/học|training|đào tạo|chiến lược|phát triển|sách|sức khỏe|tập|gym/i.test(titleLower)) {
        q2.push(ev);
      } else if (/gọi|trả lời|nhờ|hỗ trợ|mua|giao/i.test(titleLower)) {
        q3.push(ev);
      } else {
        q2.push(ev);
      }
    }

    let out = `🧠 <b>PHÂN TÍCH LỊCH TRÌNH THEO MA TRẬN EISENHOWER</b>\n`;
    out += `📅 <i>Phạm vi: ${scopeTitle} (${events.length} sự kiện)</i>\n\n`;

    out += `🔴 <b>Q1: KHẨN CẤP & QUAN TRỌNG (Làm ngay)</b>\n`;
    if (q1.length === 0) {
      out += `• <i>Không có sự kiện khẩn cấp gây áp lực. Tốt!</i>\n`;
    } else {
      q1.forEach((e) => {
        const timeStr = new Date(e.startTime).toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Ho_Chi_Minh',
        });
        out += `• <b>${e.summary}</b> (lúc ${timeStr}) — Cuộc họp/công việc trọng tâm cần tập trung xử lý.\n`;
      });
    }
    out += `\n`;

    out += `🔵 <b>Q2: QUAN TRỌNG & KHÔNG KHẨN CẤP (Lên kế hoạch)</b>\n`;
    if (q2.length === 0) {
      out += `• <i>Chưa có sự kiện đầu tư phát triển dài hạn.</i>\n`;
    } else {
      q2.forEach((e) => {
        const timeStr = new Date(e.startTime).toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Ho_Chi_Minh',
        });
        out += `• <b>${e.summary}</b> (lúc ${timeStr}) — Hoạt động phát triển bản thân, kỹ năng và chiến lược.\n`;
      });
    }
    out += `\n`;

    out += `🟡 <b>Q3: KHẨN CẤP & KHÔNG QUAN TRỌNG (Ủy quyền / Rút gọn)</b>\n`;
    if (q3.length === 0) {
      out += `• <i>Không có công việc vụn vặt gây gián đoạn.</i>\n`;
    } else {
      q3.forEach((e) => {
        out += `• <b>${e.summary}</b> — Cân nhắc rút ngắn thời gian hoặc bàn giao nếu có thể.\n`;
      });
    }
    out += `\n`;

    out += `⚪ <b>Q4: KHÔNG KHẨN CẤP & KHÔNG QUAN TRỌNG (Loại bỏ)</b>\n`;
    out += `• <i>Không phát hiện lịch gây lãng phí thời gian.</i>\n\n`;

    out += `📊 <b>ĐÁNH GIÁ TỔNG QUAN:</b>\n`;
    const q2Percent = Math.round((q2.length / events.length) * 100);
    out += `• <b>Mức độ tập trung:</b> Bạn đang dành khoảng <b>${q2Percent}%</b> thời gian cho nhóm Q2 (các mục tiêu quan trọng và phát triển bản thân). Đây là dấu hiệu của người quản lý thời gian rất chủ động!\n`;
    out += `• <b>Áp lực thời gian:</b> ${q1.length > 2 ? '⚠️ Có một số việc khẩn cấp, bạn nên chuẩn bị tài liệu sớm để tránh quá tải.' : '✅ Mức độ khẩn cấp thấp, lịch trình rất cân bằng.'}\n\n`;

    out += `💡 <b>GỢI Ý TỐI ƯU CỦA AI:</b>\n`;
    out += `1. Dành 15-30 phút đầu ngày rà soát các việc trong Q1 để hoàn thành dứt điểm.\n`;
    out += `2. Bảo vệ các khung giờ học tập & phát triển trong Q2, tránh bị các việc đột xuất chen ngang.\n`;

    return out;
  }
}
