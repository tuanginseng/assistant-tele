import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf, Context } from 'telegraf';
import * as fs from 'fs';
import * as path from 'path';

export interface ReportSettings {
  sheetUrl: string;
  reportTime: string; // "15:00"
  enabled: boolean;
  lastReportSentDate?: string; // "YYYY-MM-DD"
  chatIds: number[];
}

const DEFAULT_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1Twb27SPpDt5_ygPu-1Oai_tY-wYkD07bmWNV4Aiptig/edit?gid=1025022338#gid=1025022338';

const SHOP_NAME_MAP: Record<string, string> = {
  'bánh trương quý': 'Bánh TQ',
  'sagonest': 'sagonest',
  'peaboo store': 'PEA STO',
  'mỹ phẩm úc (g&m': 'mỹ phẩm',
  'mỹ phẩm úc': 'mỹ phẩm',
  'mỹ phẩm': 'mỹ phẩm',
  'bông tẩy trang': 'bông tẩy trang',
  'trà an diệp': 'Trà An Diệp',
  'mướp eco': 'Mướp ECO',
  'litbook': 'Litbook',
};

// Desired display order for TikTok shops to match user sample
const PREFERRED_TIKTOK_ORDER = [
  'Bánh TQ',
  'sagonest',
  'PEA STO',
  'mỹ phẩm',
  'Trà An Diệp',
  'bông tẩy trang',
  'Mướp ECO',
  'Litbook',
];

@Injectable()
export class ReportService implements OnModuleInit {
  private readonly logger = new Logger(ReportService.name);
  private sheetUrl = DEFAULT_SHEET_URL;
  private reportTime = '15:00';
  private enabled = true;
  private lastReportSentDate = '';
  private chatIds: Set<number> = new Set();
  private readonly settingsFilePath = path.resolve(process.cwd(), 'data', 'report-settings.json');

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.logger.log('📊 Report Service initialized');
    this.loadSettings();

    // Register active chat IDs
    this.bot.on('message', (ctx, next) => {
      if (ctx.chat) {
        this.addChatId(ctx.chat.id);
      }
      return next();
    });
  }

  private loadSettings() {
    try {
      if (fs.existsSync(this.settingsFilePath)) {
        const raw = fs.readFileSync(this.settingsFilePath, 'utf8');
        const data: ReportSettings = JSON.parse(raw);
        if (data.sheetUrl) this.sheetUrl = data.sheetUrl;
        if (data.reportTime) this.reportTime = data.reportTime;
        if (data.enabled !== undefined) this.enabled = data.enabled;
        if (data.lastReportSentDate) this.lastReportSentDate = data.lastReportSentDate;
        if (Array.isArray(data.chatIds)) {
          data.chatIds.forEach((id) => this.chatIds.add(id));
        }
        this.logger.log(`⚙️ Loaded report settings: time=${this.reportTime}, enabled=${this.enabled}, chats=${this.chatIds.size}`);
      }
    } catch (err) {
      this.logger.error('Failed to load report settings:', err);
    }
  }

  private saveSettings() {
    try {
      const dir = path.dirname(this.settingsFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: ReportSettings = {
        sheetUrl: this.sheetUrl,
        reportTime: this.reportTime,
        enabled: this.enabled,
        lastReportSentDate: this.lastReportSentDate,
        chatIds: Array.from(this.chatIds),
      };
      fs.writeFileSync(this.settingsFilePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      this.logger.error('Failed to save report settings:', err);
    }
  }

  addChatId(chatId: number) {
    if (!this.chatIds.has(chatId)) {
      this.chatIds.add(chatId);
      this.saveSettings();
    }
  }

  getSheetUrl(): string {
    return this.sheetUrl;
  }

  setSheetUrl(url: string): { success: boolean; spreadsheetId?: string; error?: string } {
    const trimmed = url.trim();
    const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) {
      return { success: false, error: 'Link không phải là URL Google Sheets hợp lệ.' };
    }
    this.sheetUrl = trimmed;
    this.saveSettings();
    this.logger.log(`🔗 Updated Google Sheet URL: ${this.sheetUrl}`);
    return { success: true, spreadsheetId: match[1] };
  }

  getReportTime(): string {
    return this.reportTime;
  }

  setReportTime(timeInput: string): string | null {
    const clean = timeInput.trim().toLowerCase();
    let hour = -1;
    let minute = 0;

    const hMatch = clean.match(/^(\d{1,2})h(\d{1,2})?$/i);
    if (hMatch) {
      hour = parseInt(hMatch[1], 10);
      minute = hMatch[2] ? parseInt(hMatch[2], 10) : 0;
    } else {
      const colonMatch = clean.match(/^(\d{1,2})[:\.](\d{1,2})$/);
      if (colonMatch) {
        hour = parseInt(colonMatch[1], 10);
        minute = parseInt(colonMatch[2], 10);
      } else {
        const singleMatch = clean.match(/^(\d{1,2})$/);
        if (singleMatch) {
          hour = parseInt(singleMatch[1], 10);
          minute = 0;
        }
      }
    }

    if (/chiều|tối/i.test(clean) && hour < 12 && hour !== -1) {
      hour += 12;
    }

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      const formatted = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      this.reportTime = formatted;
      this.enabled = true;
      this.saveSettings();
      this.logger.log(`⏰ Updated daily report time to: ${formatted}`);
      return formatted;
    }

    return null;
  }

  isReportEnabled(): boolean {
    return this.enabled;
  }

  toggleReportEnabled(): boolean {
    this.enabled = !this.enabled;
    this.saveSettings();
    return this.enabled;
  }

  setReportEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.saveSettings();
  }

  /**
   * Helper to parse CSV text into 2D array
   */
  private parseCsv(csvText: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentVal = '';
    let insideQuote = false;

    for (let i = 0; i < csvText.length; i++) {
      const char = csvText[i];
      const nextChar = csvText[i + 1];

      if (char === '"' && insideQuote && nextChar === '"') {
        currentVal += '"';
        i++;
      } else if (char === '"') {
        insideQuote = !insideQuote;
      } else if (char === ',' && !insideQuote) {
        currentRow.push(currentVal.trim());
        currentVal = '';
      } else if ((char === '\r' || char === '\n') && !insideQuote) {
        if (char === '\r' && nextChar === '\n') i++;
        currentRow.push(currentVal.trim());
        if (currentRow.some((c) => c !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
    if (currentVal || currentRow.length > 0) {
      currentRow.push(currentVal.trim());
      rows.push(currentRow);
    }
    return rows;
  }

  private formatMoney(val: string): string {
    if (!val || val === '#DIV/0!' || val === '-' || val.trim() === '') return '0 đ';
    const clean = val.replace(/[^\d]/g, '');
    if (!clean || parseInt(clean, 10) === 0) return '0 đ';
    const num = parseInt(clean, 10);
    return num.toLocaleString('vi-VN').replace(/,/g, '.') + ' đ';
  }

  private formatPercent(val: string): string {
    if (!val || val.includes('#DIV') || val === '-' || val.trim() === '') return '0 %';
    const clean = val.replace(/%/g, '').trim();
    return clean + '%';
  }

  /**
   * Extract spreadsheet ID from current sheetUrl
   */
  private extractSpreadsheetId(): string | null {
    const match = this.sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  }

  /**
   * Fetch all sheet metadata (sheet names and gids) from spreadsheet
   */
  private async fetchSpreadsheetMetadata(spreadsheetId: string): Promise<Array<{ gid: string; name: string }>> {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
    if (!res.ok) {
      throw new Error(`Không thể kết nối đến Google Sheets (HTTP ${res.status}). Vui lòng kiểm tra quyền chia sẻ link!`);
    }
    const html = await res.text();

    const regex = /\[21350203,"\[\d+,\d+,\\"(\d+)\\",\[\{\\"1\\":\[\[0,0,\\"([^"\\]*(?:\\.[^"\\]*)*)\\"\]/g;
    let m;
    const sheets: Array<{ gid: string; name: string }> = [];
    while ((m = regex.exec(html)) !== null) {
      const gid = m[1];
      let rawName = m[2];
      rawName = rawName.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      rawName = rawName.replace(/\\"/g, '"').trim();
      sheets.push({ gid, name: rawName });
    }
    return sheets;
  }

  /**
   * Generate daily operational report
   * By default targetDate = yesterday (e.g. at 15:00 today, reports yesterday's figures)
   */
  async generateDailyReport(targetDate?: Date): Promise<{ text: string; success: boolean; error?: string }> {
    try {
      const spreadsheetId = this.extractSpreadsheetId();
      if (!spreadsheetId) {
        return { success: false, text: '', error: 'Chưa cài đặt link Google Sheets hợp lệ!' };
      }

      // Default date: Yesterday
      let date = targetDate;
      if (!date) {
        date = new Date();
        date.setDate(date.getDate() - 1);
      }

      const d = date.getDate().toString();
      const mStr = (date.getMonth() + 1).toString();
      const dPad = d.padStart(2, '0');
      const mPad = mStr.padStart(2, '0');

      // 1. Fetch metadata to find sheets
      const sheets = await this.fetchSpreadsheetMetadata(spreadsheetId);

      const baoCaoTong =
        sheets.find((s) => s.name.toUpperCase().includes('BÁO CÁO TỔNG')) ||
        sheets.find((s) => s.name.toUpperCase().includes('TỔNG')) ||
        { gid: '803202326' };

      const shopeeSheet =
        sheets.find((s) => s.name.toUpperCase().includes('SHOPEE')) ||
        { gid: '1025022338' };

      // 2. Fetch CSVs
      const tiktokRes = await fetch(
        `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${baoCaoTong.gid}`,
      );
      if (!tiktokRes.ok) {
        throw new Error(`Không thể tải sheet TikTok / Báo Cáo Tổng (HTTP ${tiktokRes.status})`);
      }
      const tiktokCsv = await tiktokRes.text();

      const shopeeRes = await fetch(
        `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${shopeeSheet.gid}`,
      );
      if (!shopeeRes.ok) {
        throw new Error(`Không thể tải sheet Shopee (HTTP ${shopeeRes.status})`);
      }
      const shopeeCsv = await shopeeRes.text();

      const tiktokRows = this.parseCsv(tiktokCsv);
      const shopeeRows = this.parseCsv(shopeeCsv);

      if (tiktokRows.length === 0) {
        return { success: false, text: '', error: 'Sheet TikTok rỗng hoặc không có dữ liệu.' };
      }

      // 3. Parse TikTok shops
      const headerRow = tiktokRows[0];
      const shops: Array<{ colIndex: number; name: string }> = [];
      for (let c = 1; c < headerRow.length; c += 4) {
        const rawName = headerRow[c];
        if (rawName) {
          const lower = rawName.toLowerCase().trim();
          const displayName = SHOP_NAME_MAP[lower] || rawName.trim();
          shops.push({ colIndex: c, name: displayName });
        }
      }

      // Sort shops according to preferred order if match
      shops.sort((a, b) => {
        const idxA = PREFERRED_TIKTOK_ORDER.indexOf(a.name);
        const idxB = PREFERRED_TIKTOK_ORDER.indexOf(b.name);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.colIndex - b.colIndex;
      });

      // Find data row for target date in TikTok
      // Formats: "16/10" or "1/10" or "16-10"
      const dataRow = tiktokRows.find((r) => {
        const rowDate = r[0]?.trim();
        return (
          rowDate === `${d}/${mStr}` ||
          rowDate === `${dPad}/${mPad}` ||
          rowDate === `${d}-${mStr}` ||
          rowDate === `${dPad}-${mPad}`
        );
      });

      let report = `>Báo Cáo vận hành ngày ${d} / ${mStr}\n`;
      report += `1: tiktok    CP          DT          %HH\n`;

      for (const shop of shops) {
        let cp = '0 đ';
        let dt = '0 đ';
        let hh = '0 %';

        if (dataRow) {
          cp = this.formatMoney(dataRow[shop.colIndex]);
          dt = this.formatMoney(dataRow[shop.colIndex + 1]);
          // Column 4 is CP Đã Trừ Hoàn Hủy (%HH), fallback to Column 3 (Chi Phí/Doanh Số)
          hh = this.formatPercent(dataRow[shop.colIndex + 3] || dataRow[shop.colIndex + 2]);
        }

        report += `${shop.name}: ${cp} - ${dt} - ${hh}\n`;
      }

      report += `\n____________________\n`;
      report += `2: SHOPEE\n`;

      // 4. Parse Shopee data
      // Shopee date format: "16-10-2026" or "16/10/2026"
      const shopeeRow = shopeeRows.find((r) => {
        const rowDate = r[0]?.trim();
        return (
          rowDate &&
          (rowDate.startsWith(`${dPad}-${mPad}`) ||
            rowDate.startsWith(`${d}-${mStr}`) ||
            rowDate.startsWith(`${dPad}/${mPad}`) ||
            rowDate.startsWith(`${d}/${mStr}`))
        );
      });

      if (shopeeRow) {
        // Col 1: Tổng doanh số (DT)
        // Col 4: Chi phí quảng cáo (CP)
        // Col 6: %(QC+AFF)/Tổng Doanh Thu (%HH)
        const dt = this.formatMoney(shopeeRow[1]);
        const cp = this.formatMoney(shopeeRow[4]);
        const hh = this.formatPercent(shopeeRow[6] || shopeeRow[5]);
        report += `mỹ phẩm: ${cp} - ${dt} - ${hh}\n`;
      } else {
        report += `mỹ phẩm: 0 đ - 0 đ - 0 %\n`;
      }

      return { success: true, text: report.trim() };
    } catch (err: any) {
      this.logger.error('Error generating daily report:', err);
      return { success: false, text: '', error: err.message };
    }
  }

  /**
   * Send daily report message (to targetChatId or all registered chats)
   */
  async sendDailyReport(targetChatId?: number, date?: Date): Promise<boolean> {
    const res = await this.generateDailyReport(date);
    if (!res.success || !res.text) {
      const errorMsg = `❌ <b>Không thể tạo báo cáo tự động:</b>\n\n${res.error || 'Lỗi không xác định'}`;
      if (targetChatId) {
        await this.bot.telegram.sendMessage(targetChatId, errorMsg, { parse_mode: 'HTML' });
      }
      return false;
    }

    const recipients = targetChatId ? [targetChatId] : Array.from(this.chatIds);
    for (const chatId of recipients) {
      try {
        await this.bot.telegram.sendMessage(chatId, res.text);
      } catch (err) {
        this.logger.error(`Failed to send report to chat ${chatId}:`, err);
      }
    }
    this.logger.log(`📊 Sent daily report to ${recipients.length} chat(s)`);
    return true;
  }

  /**
   * Minute-by-minute cron check to trigger daily report at configured time (default 15:00)
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleMinuteReportCheck() {
    if (!this.enabled) return;
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

      if (currentHHmm === this.reportTime && this.lastReportSentDate !== todayDateStr) {
        this.lastReportSentDate = todayDateStr;
        this.saveSettings();
        this.logger.log(`⏰ Triggering daily operational report at ${currentHHmm} for ${todayDateStr}`);
        await this.sendDailyReport();
      }
    } catch (err) {
      this.logger.error('Error in handleMinuteReportCheck:', err);
    }
  }
}
