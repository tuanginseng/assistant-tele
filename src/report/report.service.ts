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
  defaultTarget?: number; // monthly DT target applied to shops without their own target
  shopTargets?: Record<string, number>; // "tiktok:Bánh TQ" → target (0 = không tính KPI)
}

export type ShopChannel = 'tiktok' | 'shopee';
export interface ShopTargetInfo {
  key: string; // "tiktok:Bánh TQ"
  channel: ShopChannel;
  name: string;
  target: number; // effective target (0 = không tính KPI)
  isCustom: boolean;
}

const DEFAULT_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1Twb27SPpDt5_ygPu-1Oai_tY-wYkD07bmWNV4Aiptig/edit?gid=1025022338#gid=1025022338';

const SHOP_NAME_MAP: Record<string, string> = {
  'bánh trương quý': 'Bánh TQ',
  'sagonest': 'sagonest',
  'peaboo store': 'PEA STO',
  'peaboo': 'PEA STO',
  'mỹ phẩm úc (g&m': 'mỹ phẩm',
  'mỹ phẩm úc': 'mỹ phẩm',
  'mỹ phẩm': 'mỹ phẩm',
  'bông tẩy trang': 'Bông tẩy TT',
  'trà an diệp': 'Trà An Diệp',
  'trà an diệp ': 'Trà An Diệp',
  'mướp eco': 'Mướp ECO',
  'litbook': 'Litbook',
  'hayar tino': 'Hayar Tino',
  'vpp eras': 'VPP Eras',
  'bunkids': 'Bunkids',
  'nho': 'Nho',
  'zest home': 'Zest Home',
  'bigtech': 'BigTech',
};

// KPI: default monthly revenue target per shop (each shop can override via /target)
const DEFAULT_MONTHLY_TARGET = 500_000_000;
const SHOPEE_SHOPS = ['mỹ phẩm'];
// Pace = month-to-date revenue / revenue expected by today (target × day / daysInMonth)

// Desired display order for TikTok shops to match user sample
const PREFERRED_TIKTOK_ORDER = [
  'Bánh TQ',
  'sagonest',
  'PEA STO',
  'Trà An Diệp',
  'Bông tẩy TT',
  'Mướp ECO',
  'Litbook',
  'Hayar Tino',
  'VPP Eras',
  'Bunkids',
];

@Injectable()
export class ReportService implements OnModuleInit {
  private readonly logger = new Logger(ReportService.name);
  private sheetUrl = DEFAULT_SHEET_URL;
  private reportTime = '15:00';
  private enabled = true;
  private lastReportSentDate = '';
  private chatIds: Set<number> = new Set();
  private defaultTarget = DEFAULT_MONTHLY_TARGET;
  private shopTargets: Record<string, number> = {};
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
        if (typeof data.defaultTarget === 'number' && data.defaultTarget >= 0) this.defaultTarget = data.defaultTarget;
        if (data.shopTargets && typeof data.shopTargets === 'object') this.shopTargets = { ...data.shopTargets };
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
        defaultTarget: this.defaultTarget,
        shopTargets: this.shopTargets,
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

  // =============================================
  //  SHOP KPI TARGETS
  // =============================================

  static shopKey(channel: ShopChannel, name: string): string {
    return `${channel}:${name}`;
  }

  getDefaultTarget(): number {
    return this.defaultTarget;
  }

  setDefaultTarget(amount: number) {
    this.defaultTarget = Math.max(0, Math.round(amount));
    this.saveSettings();
  }

  /** Effective target of a shop: its own target if set, else the default */
  getShopTarget(key: string): number {
    return key in this.shopTargets ? this.shopTargets[key] : this.defaultTarget;
  }

  setShopTarget(key: string, amount: number) {
    this.shopTargets[key] = Math.max(0, Math.round(amount));
    this.saveSettings();
  }

  /** Remove a shop's own target so it falls back to the default */
  resetShopTarget(key: string) {
    delete this.shopTargets[key];
    this.saveSettings();
  }

  /**
   * Parse an amount typed by the user: "300tr", "300 triệu", "1.2 tỷ", "1,5ty", "800k",
   * "500.000.000", "500000000", "0". Returns null if not understood.
   */
  parseTargetAmount(input: string): number | null {
    const t = input.trim().toLowerCase().replace(/\s+/g, '').replace(/đ|vnd|₫/g, '');
    const m = t.match(/^(\d+(?:[.,]\d+)*)(tỷ|ty|tỉ|ti|b|triệu|trieu|tr|m|củ|cu|nghìn|nghin|ngàn|ngan|k)?$/);
    if (!m) return null;
    const unit = m[2] || '';
    let numStr = m[1];
    if (!unit) {
      // Plain number: dots/commas are thousand separators ("500.000.000")
      numStr = numStr.replace(/[.,]/g, '');
    } else {
      // With unit: last separator is the decimal point ("1,5tỷ", "1.2 tỷ")
      numStr = numStr.replace(/[.,](?=.*[.,])/g, '').replace(',', '.');
    }
    const num = parseFloat(numStr);
    if (isNaN(num)) return null;
    const mult = /^(tỷ|ty|tỉ|ti|b)$/.test(unit)
      ? 1e9
      : /^(triệu|trieu|tr|m|củ|cu)$/.test(unit)
        ? 1e6
        : /^(nghìn|nghin|ngàn|ngan|k)$/.test(unit)
          ? 1e3
          : 1;
    return Math.round(num * mult);
  }

  /**
   * Current shop list (read from the sheet) with each shop's effective target
   */
  async getShopTargets(): Promise<{ success: boolean; shops: ShopTargetInfo[]; error?: string }> {
    try {
      const spreadsheetId = this.extractSpreadsheetId();
      if (!spreadsheetId) return { success: false, shops: [], error: 'Chưa cài đặt link Google Sheets hợp lệ!' };
      const sheets = await this.fetchSpreadsheetMetadata(spreadsheetId);
      const baoCaoTong = this.findTiktokSheet(sheets);
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${baoCaoTong.gid}`);
      if (!res.ok) throw new Error(`Không thể tải sheet TikTok / Báo Cáo Tổng (HTTP ${res.status})`);
      const tiktokShops = this.detectTiktokShops(this.parseCsv(await res.text()));
      const list: Array<{ channel: ShopChannel; name: string }> = [
        ...tiktokShops.map((s) => ({ channel: 'tiktok' as ShopChannel, name: s.name })),
        ...SHOPEE_SHOPS.map((name) => ({ channel: 'shopee' as ShopChannel, name })),
      ];
      return {
        success: true,
        shops: list.map(({ channel, name }) => {
          const key = ReportService.shopKey(channel, name);
          return { key, channel, name, target: this.getShopTarget(key), isCustom: key in this.shopTargets };
        }),
      };
    } catch (err: any) {
      this.logger.error('Error loading shop targets:', err);
      return { success: false, shops: [], error: err.message };
    }
  }

  private findTiktokSheet(sheets: Array<{ gid: string; name: string }>): { gid: string } {
    return (
      sheets.find((s) => s.name.toUpperCase().includes('BÁO CÁO TỔNG')) ||
      sheets.find((s) => s.name.toUpperCase().includes('TỔNG')) || { gid: '803202326' }
    );
  }

  /**
   * Detect TikTok shop columns from the "Báo cáo tổng" sheet (4 columns per shop), sorted by preferred order
   */
  private detectTiktokShops(tiktokRows: string[][]): Array<{ colIndex: number; name: string }> {
    // Auto-detect header row: first row where col[1] looks like a shop name (not a sub-header keyword)
    const SUB_HEADER_KEYWORDS = ['chi phí', 'doanh số', 'doanh thu', 'chi phi/doanh so', 'cp đã trừ', 'tổng', 'target', '%', 'người quản lý'];
    let headerRowIndex = 0;
    for (let ri = 0; ri < Math.min(tiktokRows.length, 5); ri++) {
      const cell = (tiktokRows[ri][1] || '').toLowerCase().trim();
      if (!cell) continue;
      if (!SUB_HEADER_KEYWORDS.some((kw) => cell.includes(kw))) {
        headerRowIndex = ri;
        break;
      }
    }
    const headerRow = tiktokRows[headerRowIndex] || [];
    const shops: Array<{ colIndex: number; name: string }> = [];
    for (let c = 1; c < headerRow.length; c += 4) {
      const rawName = headerRow[c];
      if (rawName) {
        const lower = rawName.toLowerCase().trim();
        shops.push({ colIndex: c, name: SHOP_NAME_MAP[lower] || rawName.trim() });
      }
    }
    shops.sort((a, b) => {
      const idxA = PREFERRED_TIKTOK_ORDER.indexOf(a.name);
      const idxB = PREFERRED_TIKTOK_ORDER.indexOf(b.name);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.colIndex - b.colIndex;
    });
    return shops;
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

  private parseMoney(val: string | undefined): number {
    if (!val || val.includes('#') || val.trim() === '-') return 0;
    const clean = val.replace(/[^\d]/g, '');
    if (!clean) return 0;
    const num = parseInt(clean, 10);
    return val.trim().startsWith('-') ? -num : num;
  }

  private formatNumber(num: number): string {
    return Math.round(num).toLocaleString('vi-VN').replace(/,/g, '.') + ' đ';
  }

  /**
   * Parse a row's date cell ("16/10", "16-10", "16-10-2026", "16/10/2026") into { day, month }
   */
  private parseRowDate(cell: string | undefined): { day: number; month: number } | null {
    const m = (cell || '').trim().match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-]\d{2,4})?$/);
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    return { day, month };
  }

  private formatPercent(val: string | undefined): string {
    if (!val || val.includes('#') || val.trim() === '-' || val.trim() === '') return '0 %';
    return val.replace(/%/g, '').trim() + '%';
  }

  /** Short money: 45,2tr · 500tr · 1,25tỷ · 850k */
  private formatShort(num: number): string {
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    const fmt = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',');
    if (abs >= 1e9) return `${sign}${(Math.round((abs / 1e9) * 100) / 100).toString().replace('.', ',')}tỷ`;
    if (abs >= 1e6) return `${sign}${fmt(abs / 1e6)}tr`;
    if (abs >= 1e3) return `${sign}${Math.round(abs / 1e3)}k`;
    return `${sign}${abs}`;
  }

  private formatPct(ratio: number): string {
    return `${(Math.round(ratio * 1000) / 10).toString().replace('.', ',')}%`;
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

      const baoCaoTong = this.findTiktokSheet(sheets);

      // For Shopee: prefer the G&M cosmetics shop sheet (not individual shop sheets)
      const shopeeSheet =
        sheets.find((s) => s.name.toUpperCase().includes('SHOPEE G') || s.name.toUpperCase().includes('SHOPEE G&M')) ||
        sheets.find((s) => s.name.toUpperCase().includes('SHOPEE') && !s.name.toUpperCase().includes('TRƯƠNG')) ||
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
      const shops = this.detectTiktokShops(tiktokRows);

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

      type ShopLine = { name: string; cp: number; dt: number; hh: string };

      // TikTok lines for the selected day
      const tiktokLines: ShopLine[] = dataRow
        ? shops.map((shop) => ({
            name: shop.name,
            cp: this.parseMoney(dataRow[shop.colIndex]),
            dt: this.parseMoney(dataRow[shop.colIndex + 1]),
            // Column 4 is CP Đã Trừ Hoàn Hủy (%HH), fallback to Column 3 (Chi Phí/Doanh Số)
            hh: dataRow[shop.colIndex + 3] || dataRow[shop.colIndex + 2],
          }))
        : [];

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
      // Col 1: Tổng doanh số (DT) · Col 4: Chi phí quảng cáo (CP) · Col 6: %(QC+AFF)/Tổng Doanh Thu (%HH)
      const shopeeLines: ShopLine[] = [
        {
          name: 'mỹ phẩm',
          cp: this.parseMoney(shopeeRow?.[4]),
          dt: this.parseMoney(shopeeRow?.[1]),
          hh: shopeeRow ? shopeeRow[6] || shopeeRow[5] : '',
        },
      ];

      // 5. Revenue totals: selected day + month-to-date (day 1 → selected day)
      const targetDay = date.getDate();
      const targetMonth = date.getMonth() + 1;
      let tiktokDay = 0;
      let tiktokMonth = 0;
      const shopMonthDt = new Map<string, number>(); // shop name → month-to-date DT
      for (const row of tiktokRows) {
        const rd = this.parseRowDate(row[0]);
        if (!rd || rd.month !== targetMonth || rd.day > targetDay) continue;
        for (const shop of shops) {
          const val = this.parseMoney(row[shop.colIndex + 1]);
          shopMonthDt.set(shop.name, (shopMonthDt.get(shop.name) || 0) + val);
          tiktokMonth += val;
          if (rd.day === targetDay) tiktokDay += val;
        }
      }
      let shopeeDay = 0;
      let shopeeMonth = 0;
      for (const row of shopeeRows) {
        const rd = this.parseRowDate(row[0]);
        if (!rd || rd.month !== targetMonth || rd.day > targetDay) continue;
        const val = this.parseMoney(row[1]);
        shopeeMonth += val;
        if (rd.day === targetDay) shopeeDay += val;
      }

      // 6. KPI per shop: month-to-date DT vs each shop's own monthly target, judged on pace
      const daysInMonth = new Date(date.getFullYear(), targetMonth, 0).getDate();
      const monthShare = targetDay / daysInMonth; // share of the month elapsed
      type Kpi = {
        name: string;
        channel: string;
        mtd: number;
        target: number;
        expected: number;
        done: number;
        pace: number;
        forecast: number;
      };
      const kpiOf = (channel: ShopChannel, name: string, mtd: number): Kpi | null => {
        const target = this.getShopTarget(ReportService.shopKey(channel, name));
        if (target <= 0) return null; // target 0 → shop không tính KPI
        const expected = target * monthShare;
        const pace = expected > 0 ? mtd / expected : 0;
        return {
          name,
          channel: channel === 'tiktok' ? 'TikTok' : 'Shopee',
          mtd,
          target,
          expected,
          done: mtd / target,
          pace,
          forecast: (mtd / targetDay) * daysInMonth,
        };
      };
      const kpiLine = (k: Kpi | null) =>
        k
          ? `   🎯 KPI: ${this.formatShort(k.mtd)}/${this.formatShort(k.target)} (${this.formatPct(k.done)}) · tiến độ ${this.formatPct(k.pace)}\n`
          : `   🎯 KPI: <i>không đặt target</i>\n`;

      // 7. Build message (Telegram HTML) — bold shop names, blank line between shops
      const shopBlock = (l: ShopLine, k: Kpi | null) =>
        `<b>${this.escapeHtml(l.name)}</b>: ${this.formatNumber(l.cp)} - ${this.formatNumber(l.dt)} - ${this.formatPercent(l.hh)}\n` +
        kpiLine(k) +
        `\n`;

      let report = `&gt;Báo Cáo vận hành ngày ${d} / ${mStr}\n`;
      report += `1: tiktok    CP          DT          %HH\n`;
      report += `<i>(Tiến độ = DT lũy kế / mức cần đạt đến ${d}/${mStr} = ${targetDay}/${daysInMonth} target tháng · /target để cài target)</i>\n\n`;
      if (!dataRow) {
        report += `⚠️ Không tìm thấy dữ liệu ngày ${d}/${mStr} trong sheet TikTok.\n`;
        report += `(Có thể sheet chưa cập nhật hoặc sai tháng)\n\n`;
      } else {
        for (const l of tiktokLines) {
          const k = kpiOf('tiktok', l.name, shopMonthDt.get(l.name) || 0);
          report += shopBlock(l, k);
        }
      }

      report += `____________________\n`;
      report += `2: SHOPEE\n\n`;
      for (const l of shopeeLines) {
        const k = kpiOf('shopee', l.name, shopeeMonth);
        report += shopBlock(l, k);
      }

      report += `____________________\n`;
      report += `💰 <b>Tổng DT ngày ${d}/${mStr}: ${this.formatNumber(tiktokDay + shopeeDay)}</b>\n`;
      report += `   (TikTok: ${this.formatNumber(tiktokDay)} | Shopee: ${this.formatNumber(shopeeDay)})\n`;
      report += `📈 <b>Tổng DT tháng ${mStr} (1/${mStr} → ${d}/${mStr}): ${this.formatNumber(tiktokMonth + shopeeMonth)}</b>\n`;
      report += `   (TikTok: ${this.formatNumber(tiktokMonth)} | Shopee: ${this.formatNumber(shopeeMonth)})\n`;

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
        await this.bot.telegram.sendMessage(chatId, res.text, { parse_mode: 'HTML' });
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
