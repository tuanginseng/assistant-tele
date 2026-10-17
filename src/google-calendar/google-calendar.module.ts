import { Module, Global } from '@nestjs/common';
import { GoogleCalendarService } from './google-calendar.service';

@Global()
@Module({
  providers: [GoogleCalendarService],
  exports: [GoogleCalendarService],
})
export class GoogleCalendarModule {}
