import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { ScheduleModule } from '@nestjs/schedule';
import { GoogleCalendarModule } from './google-calendar/google-calendar.module';
import { BotModule } from './bot/bot.module';
import { ReminderModule } from './reminder/reminder.module';
import { AuthModule } from './auth/auth.module';
import { ReportModule } from './report/report.module';

@Module({
  imports: [
    // Load environment variables globally
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Telegraf (Telegram Bot) configuration
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        token: configService.get<string>('TELEGRAM_BOT_TOKEN'),
      }),
    }),

    // Cron / Interval scheduler for reminders
    ScheduleModule.forRoot(),

    // App modules
    GoogleCalendarModule,
    BotModule,
    ReminderModule,
    AuthModule,
    ReportModule,
  ],
})
export class AppModule {}
