import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  startTime: string; // ISO 8601
  endTime: string;   // ISO 8601
  location?: string;
  reminders?: number[]; // minutes before event
  htmlLink?: string;
  calendarId?: string;
  calendarName?: string;
}

export interface UserCalendar {
  id: string;
  summary: string;
  primary?: boolean;
}

@Injectable()
export class GoogleCalendarService implements OnModuleInit {
  private readonly logger = new Logger(GoogleCalendarService.name);
  private calendar: calendar_v3.Calendar;
  private oauth2Client: OAuth2Client;
  private calendarId: string;
  private timezone: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.calendarId = this.configService.get<string>('GOOGLE_CALENDAR_ID', 'primary');
    this.timezone = this.configService.get<string>('TIMEZONE', 'Asia/Ho_Chi_Minh');

    this.oauth2Client = new google.auth.OAuth2(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
      this.configService.get<string>('GOOGLE_CLIENT_SECRET'),
      this.configService.get<string>('GOOGLE_REDIRECT_URL'),
    );

    const refreshToken = this.configService.get<string>('GOOGLE_REFRESH_TOKEN');
    if (refreshToken) {
      this.oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });
      this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
      this.logger.log('✅ Google Calendar API initialized with OAuth2');
    } else {
      this.logger.warn('⚠️ GOOGLE_REFRESH_TOKEN not set. Use /auth command or run: npm run get-token');
    }
  }

  /**
   * Get the OAuth2 client (used by AuthModule to generate auth URL)
   */
  getOAuth2Client(): OAuth2Client {
    return this.oauth2Client;
  }

  /**
   * Set credentials after OAuth flow
   */
  setCredentials(tokens: any) {
    this.oauth2Client.setCredentials(tokens);
    this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
    this.logger.log('✅ Google Calendar credentials updated');
  }

  /**
   * Check if the calendar service is ready
   */
  isReady(): boolean {
    return !!this.calendar;
  }

  // =============================================
  //  LIST / GET EVENTS
  // =============================================

  /**
   * Get upcoming events across all calendars
   */
  async getUpcomingEvents(maxResults = 10): Promise<CalendarEvent[]> {
    const now = new Date();
    const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // next 30 days
    const events = await this.getEventsInRange(now, future);
    return events.slice(0, maxResults);
  }

  /**
   * Get events for a specific date across all calendars
   */
  async getEventsForDate(date: Date): Promise<CalendarEvent[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return this.getEventsInRange(startOfDay, endOfDay);
  }

  /**
   * Get events for today
   */
  async getTodayEvents(): Promise<CalendarEvent[]> {
    return this.getEventsForDate(new Date());
  }

  /**
   * Get events for tomorrow
   */
  async getTomorrowEvents(): Promise<CalendarEvent[]> {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return this.getEventsForDate(tomorrow);
  }

  /**
   * Get events for current week (Monday to Sunday)
   */
  async getThisWeekEvents(): Promise<CalendarEvent[]> {
    const now = new Date();
    const day = now.getDay();
    // In JS: 0 is Sunday, 1 is Monday ... 6 is Saturday
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    return this.getEventsInRange(monday, sunday);
  }

  /**
   * Get events for next week (Next Monday to Next Sunday)
   */
  async getNextWeekEvents(): Promise<CalendarEvent[]> {
    const now = new Date();
    const day = now.getDay();
    const diffToNextMonday = (day === 0 ? 1 : 8) - day;
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + diffToNextMonday);
    nextMonday.setHours(0, 0, 0, 0);

    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);
    nextSunday.setHours(23, 59, 59, 999);

    return this.getEventsInRange(nextMonday, nextSunday);
  }

  /**
   * Get events for current month (1st to last day of month)
   */
  async getThisMonthEvents(): Promise<CalendarEvent[]> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return this.getEventsInRange(startOfMonth, endOfMonth);
  }

  /**
   * Get events for next month (1st to last day of next month)
   */
  async getNextMonthEvents(): Promise<CalendarEvent[]> {
    const now = new Date();
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
    const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
    return this.getEventsInRange(startOfNextMonth, endOfNextMonth);
  }

  private cachedCalendars: UserCalendar[] = [];
  private lastCalendarFetch = 0;

  /**
   * Get all writable user calendars (tags) from Google Calendar
   */
  async getUserCalendars(forceRefresh = false): Promise<UserCalendar[]> {
    this.ensureReady();
    const now = Date.now();
    if (!forceRefresh && this.cachedCalendars.length > 0 && now - this.lastCalendarFetch < 300000) {
      return this.cachedCalendars;
    }

    try {
      const res = await this.calendar.calendarList.list();
      const items = res.data.items || [];
      this.cachedCalendars = items
        .filter((c) => {
          if (!c.id) return false;
          if (c.id.includes('holiday@group.v.calendar.google.com')) return false;
          if (c.id.includes('classroom')) return false;
          return c.accessRole === 'owner' || c.accessRole === 'writer';
        })
        .map((c) => ({
          id: c.id!,
          summary: (c.summary || '').trim(),
          primary: !!c.primary,
        }));
      this.lastCalendarFetch = now;
      return this.cachedCalendars;
    } catch (err: any) {
      this.logger.error('Failed to fetch user calendars:', err);
      return this.cachedCalendars.length > 0
        ? this.cachedCalendars
        : [{ id: this.calendarId, summary: '💻 Personal', primary: true }];
    }
  }

  /**
   * Find matching calendar by tag name or keyword
   */
  async findCalendarByTag(tagOrKeyword?: string): Promise<UserCalendar | null> {
    if (!tagOrKeyword) return null;
    const calendars = await this.getUserCalendars();
    const clean = tagOrKeyword.toLowerCase().trim();

    // 1. Direct or substring match on summary
    for (const cal of calendars) {
      const summaryClean = cal.summary.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim();
      const targetClean = clean.replace(/[^\p{L}\p{N}\s]/gu, '').trim();
      if (
        summaryClean &&
        targetClean &&
        (summaryClean === targetClean || summaryClean.includes(targetClean) || targetClean.includes(summaryClean))
      ) {
        return cal;
      }
    }

    // 2. Semantic keywords mapping
    if (/work|công\s*việc|họp|bni|dự\s*án|khách|đối\s*tác|bán\s*hàng|kinh\s*doanh|công\s*ty|quay\s*video|báo\s*cáo/i.test(clean)) {
      const found = calendars.find((c) => /work|công\s*việc/i.test(c.summary));
      if (found) return found;
    }
    if (/study|học|lái\s*xe|khóa\s*học|đào\s*tạo|lớp|ôn\s*thi|nghiên\s*cứu|training/i.test(clean)) {
      const found = calendars.find((c) => /study|học/i.test(c.summary));
      if (found) return found;
    }
    if (/read|đọc|sách/i.test(clean)) {
      const found = calendars.find((c) => /read|đọc/i.test(c.summary));
      if (found) return found;
    }
    if (/exercise|tập|thể\s*dục|gym|chạy|bơi|đạp\s*xe|thể\s*thao|workout/i.test(clean)) {
      const found = calendars.find((c) => /exercise|tập|thể/i.test(c.summary));
      if (found) return found;
    }
    if (/gia\s*đình|family|con|vợ|chồng|bố|mẹ|ông|bà|quê|giỗ/i.test(clean)) {
      const found = calendars.find((c) => /gia\s*đình|family/i.test(c.summary));
      if (found) return found;
    }
    if (/daily|hàng\s*ngày|sinh\s*hoạt|cafe|ăn\s*uống/i.test(clean)) {
      const found = calendars.find((c) => /daily/i.test(c.summary));
      if (found) return found;
    }

    return calendars.find((c) => c.primary || /personal/i.test(c.summary)) || calendars[0] || null;
  }

  /**
   * Get events within a time range across all user calendars (tags)
   */
  async getEventsInRange(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
    this.ensureReady();

    const calendars = await this.getUserCalendars();
    const eventPromises = calendars.map(async (cal) => {
      try {
        const response = await this.calendar.events.list({
          calendarId: cal.id,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          timeZone: this.timezone,
        });

        return (response.data.items || []).map((item) =>
          this.mapToCalendarEvent(item, cal.id, cal.summary),
        );
      } catch (err: any) {
        this.logger.warn(`Failed to fetch events from calendar ${cal.summary} (${cal.id}): ${err.message}`);
        return [];
      }
    });

    const results = await Promise.all(eventPromises);
    const allEvents = results.flat();
    allEvents.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    return allEvents;
  }

  /**
   * Get a single event by ID across calendars
   */
  async getEvent(eventId: string, calendarId?: string): Promise<CalendarEvent> {
    this.ensureReady();

    if (calendarId) {
      const response = await this.calendar.events.get({
        calendarId,
        eventId,
      });
      return this.mapToCalendarEvent(response.data, calendarId);
    }

    const calendars = await this.getUserCalendars();
    for (const cal of calendars) {
      try {
        const response = await this.calendar.events.get({
          calendarId: cal.id,
          eventId,
        });
        if (response.data) {
          return this.mapToCalendarEvent(response.data, cal.id, cal.summary);
        }
      } catch {}
    }

    throw new Error(`Event with ID ${eventId} not found`);
  }

  // =============================================
  //  CREATE EVENT WITH TAG / CALENDAR
  // =============================================

  /**
   * Create a new calendar event in a specified or tag-classified calendar
   */
  async createEvent(
    event: Omit<CalendarEvent, 'id' | 'htmlLink'>,
    targetCalendarId?: string,
  ): Promise<CalendarEvent> {
    this.ensureReady();

    let calId = targetCalendarId;
    let calName = event.calendarName;

    // If no targetCalendarId but calendarName/tag is provided, find calendar
    if (!calId && event.calendarName) {
      const found = await this.findCalendarByTag(event.calendarName);
      if (found) {
        calId = found.id;
        calName = found.summary;
      }
    }

    if (calId && !calName) {
      const calendars = await this.getUserCalendars();
      const found = calendars.find((c) => c.id === calId);
      if (found) calName = found.summary;
    }

    if (!calId) {
      const primaryCal = (await this.getUserCalendars()).find((c) => c.primary);
      calId = primaryCal ? primaryCal.id : this.calendarId;
      calName = primaryCal ? primaryCal.summary : '💻 Personal';
    }

    const eventBody: calendar_v3.Schema$Event = {
      summary: event.summary,
      description: event.description || '',
      location: event.location || '',
      start: {
        dateTime: event.startTime,
        timeZone: this.timezone,
      },
      end: {
        dateTime: event.endTime,
        timeZone: this.timezone,
      },
    };

    if (event.reminders && event.reminders.length > 0) {
      eventBody.reminders = {
        useDefault: false,
        overrides: event.reminders.map((minutes) => ({
          method: 'popup',
          minutes,
        })),
      };
    }

    const response = await this.calendar.events.insert({
      calendarId: calId,
      requestBody: eventBody,
    });

    this.logger.log(`✅ Created event in [${calName}]: ${response.data.summary} (${response.data.id})`);
    return this.mapToCalendarEvent(response.data, calId, calName);
  }

  // =============================================
  //  UPDATE EVENT
  // =============================================

  /**
   * Update an existing event across calendars
   */
  async updateEvent(
    eventId: string,
    updates: Partial<CalendarEvent>,
    calendarId?: string,
  ): Promise<CalendarEvent> {
    this.ensureReady();

    let targetCalId = calendarId;
    let targetCalName: string | undefined;

    if (!targetCalId) {
      const calendars = await this.getUserCalendars();
      for (const cal of calendars) {
        try {
          const test = await this.calendar.events.get({ calendarId: cal.id, eventId });
          if (test.data) {
            targetCalId = cal.id;
            targetCalName = cal.summary;
            break;
          }
        } catch {}
      }
    }

    if (!targetCalId) {
      targetCalId = this.calendarId;
    }

    // Get current event first
    const currentEvent = await this.calendar.events.get({
      calendarId: targetCalId,
      eventId,
    });

    const eventBody: calendar_v3.Schema$Event = {
      ...currentEvent.data,
    };

    if (updates.summary !== undefined) {
      eventBody.summary = updates.summary;
    }
    if (updates.description !== undefined) {
      eventBody.description = updates.description;
    }
    if (updates.location !== undefined) {
      eventBody.location = updates.location;
    }
    if (updates.startTime !== undefined) {
      eventBody.start = {
        dateTime: updates.startTime,
        timeZone: this.timezone,
      };
    }
    if (updates.endTime !== undefined) {
      eventBody.end = {
        dateTime: updates.endTime,
        timeZone: this.timezone,
      };
    }

    const response = await this.calendar.events.update({
      calendarId: targetCalId,
      eventId,
      requestBody: eventBody,
    });

    this.logger.log(`✅ Updated event: ${response.data.summary} (${eventId}) in [${targetCalName || targetCalId}]`);
    return this.mapToCalendarEvent(response.data, targetCalId, targetCalName);
  }

  // =============================================
  //  DELETE EVENT
  // =============================================

  /**
   * Delete an event by ID across calendars
   */
  async deleteEvent(eventId: string, calendarId?: string): Promise<void> {
    this.ensureReady();

    if (calendarId) {
      await this.calendar.events.delete({
        calendarId,
        eventId,
      });
      this.logger.log(`🗑️ Deleted event: ${eventId} from ${calendarId}`);
      return;
    }

    const calendars = await this.getUserCalendars();
    for (const cal of calendars) {
      try {
        await this.calendar.events.delete({
          calendarId: cal.id,
          eventId,
        });
        this.logger.log(`🗑️ Deleted event: ${eventId} from ${cal.summary}`);
        return;
      } catch {}
    }

    throw new Error(`Event with ID ${eventId} not found to delete`);
  }

  // =============================================
  //  SEARCH
  // =============================================

  /**
   * Search events by keyword across all user calendars
   */
  async searchEvents(query: string, maxResults = 10): Promise<CalendarEvent[]> {
    this.ensureReady();

    const calendars = await this.getUserCalendars();
    const searchPromises = calendars.map(async (cal) => {
      try {
        const response = await this.calendar.events.list({
          calendarId: cal.id,
          q: query,
          timeMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          maxResults,
          singleEvents: true,
          orderBy: 'startTime',
          timeZone: this.timezone,
        });
        return (response.data.items || []).map((item) =>
          this.mapToCalendarEvent(item, cal.id, cal.summary),
        );
      } catch (err: any) {
        return [];
      }
    });

    const results = await Promise.all(searchPromises);
    const allEvents = results.flat();
    allEvents.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    return allEvents.slice(0, maxResults);
  }

  // =============================================
  //  HELPERS
  // =============================================

  private ensureReady() {
    if (!this.calendar) {
      throw new Error(
        'Google Calendar chưa được cấu hình. Hãy thiết lập GOOGLE_REFRESH_TOKEN trong file .env hoặc dùng lệnh /auth để xác thực.',
      );
    }
  }

  private mapToCalendarEvent = (
    item: calendar_v3.Schema$Event,
    calendarId?: string,
    calendarName?: string,
  ): CalendarEvent => {
    return {
      id: item.id || undefined,
      summary: item.summary || '(Không có tiêu đề)',
      description: item.description || '',
      startTime: item.start?.dateTime || item.start?.date || '',
      endTime: item.end?.dateTime || item.end?.date || '',
      location: item.location || '',
      htmlLink: item.htmlLink || '',
      calendarId,
      calendarName,
    };
  };
}
