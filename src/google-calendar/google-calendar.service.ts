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
   * Get upcoming events
   */
  async getUpcomingEvents(maxResults = 10): Promise<CalendarEvent[]> {
    this.ensureReady();

    const response = await this.calendar.events.list({
      calendarId: this.calendarId,
      timeMin: new Date().toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
      timeZone: this.timezone,
    });

    return (response.data.items || []).map(this.mapToCalendarEvent);
  }

  /**
   * Get events for a specific date
   */
  async getEventsForDate(date: Date): Promise<CalendarEvent[]> {
    this.ensureReady();

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const response = await this.calendar.events.list({
      calendarId: this.calendarId,
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      timeZone: this.timezone,
    });

    return (response.data.items || []).map(this.mapToCalendarEvent);
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

  /**
   * Get events within a time range (used by reminder service)
   */
  async getEventsInRange(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
    this.ensureReady();

    const response = await this.calendar.events.list({
      calendarId: this.calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      timeZone: this.timezone,
    });

    return (response.data.items || []).map(this.mapToCalendarEvent);
  }

  /**
   * Get a single event by ID
   */
  async getEvent(eventId: string): Promise<CalendarEvent> {
    this.ensureReady();

    const response = await this.calendar.events.get({
      calendarId: this.calendarId,
      eventId,
    });

    return this.mapToCalendarEvent(response.data);
  }

  // =============================================
  //  CREATE EVENT
  // =============================================

  /**
   * Create a new calendar event
   */
  async createEvent(event: Omit<CalendarEvent, 'id' | 'htmlLink'>): Promise<CalendarEvent> {
    this.ensureReady();

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

    // Add custom reminders if specified
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
      calendarId: this.calendarId,
      requestBody: eventBody,
    });

    this.logger.log(`✅ Created event: ${response.data.summary} (${response.data.id})`);
    return this.mapToCalendarEvent(response.data);
  }

  // =============================================
  //  UPDATE EVENT
  // =============================================

  /**
   * Update an existing event
   */
  async updateEvent(eventId: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent> {
    this.ensureReady();

    // Get current event first
    const currentEvent = await this.calendar.events.get({
      calendarId: this.calendarId,
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
      calendarId: this.calendarId,
      eventId,
      requestBody: eventBody,
    });

    this.logger.log(`✅ Updated event: ${response.data.summary} (${eventId})`);
    return this.mapToCalendarEvent(response.data);
  }

  // =============================================
  //  DELETE EVENT
  // =============================================

  /**
   * Delete an event by ID
   */
  async deleteEvent(eventId: string): Promise<void> {
    this.ensureReady();

    await this.calendar.events.delete({
      calendarId: this.calendarId,
      eventId,
    });

    this.logger.log(`🗑️ Deleted event: ${eventId}`);
  }

  // =============================================
  //  SEARCH
  // =============================================

  /**
   * Search events by keyword
   */
  async searchEvents(query: string, maxResults = 10): Promise<CalendarEvent[]> {
    this.ensureReady();

    const response = await this.calendar.events.list({
      calendarId: this.calendarId,
      q: query,
      timeMin: new Date().toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
      timeZone: this.timezone,
    });

    return (response.data.items || []).map(this.mapToCalendarEvent);
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

  private mapToCalendarEvent = (item: calendar_v3.Schema$Event): CalendarEvent => {
    return {
      id: item.id,
      summary: item.summary || '(Không có tiêu đề)',
      description: item.description || '',
      startTime: item.start?.dateTime || item.start?.date || '',
      endTime: item.end?.dateTime || item.end?.date || '',
      location: item.location || '',
      htmlLink: item.htmlLink || '',
    };
  };
}
