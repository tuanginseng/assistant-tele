import { Module } from '@nestjs/common';
import { BotUpdate } from './bot.update';
import { BotService } from './bot.service';
import { AiModule } from '../ai/ai.module';
import { ReminderModule } from '../reminder/reminder.module';
import { ReportModule } from '../report/report.module';

@Module({
  imports: [AiModule, ReminderModule, ReportModule],
  providers: [BotUpdate, BotService],
  exports: [BotService],
})
export class BotModule {}
