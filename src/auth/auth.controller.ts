import { Controller, Get, Query, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly calendarService: GoogleCalendarService) {}

  /**
   * OAuth2 callback endpoint
   * Google redirects here after user grants calendar access
   */
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    if (error) {
      this.logger.error(`OAuth2 error: ${error}`);
      return res.send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #e74c3c;">❌ Xác thực thất bại</h1>
            <p>Lỗi: ${error}</p>
            <p>Vui lòng thử lại bằng lệnh /auth trên Telegram.</p>
          </body>
        </html>
      `);
    }

    if (!code) {
      return res.send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #e74c3c;">❌ Không tìm thấy mã xác thực</h1>
            <p>Vui lòng thử lại bằng lệnh /auth trên Telegram.</p>
          </body>
        </html>
      `);
    }

    try {
      const oauth2Client = this.calendarService.getOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code);
      this.calendarService.setCredentials(tokens);

      this.logger.log('✅ Google OAuth2 authentication successful via callback');

      let refreshTokenInfo = '';
      if (tokens.refresh_token) {
        try {
          const fs = await import('fs');
          const path = await import('path');
          const envPath = path.resolve(process.cwd(), '.env');
          if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf8');
            if (/GOOGLE_REFRESH_TOKEN=.*/.test(envContent)) {
              envContent = envContent.replace(/GOOGLE_REFRESH_TOKEN=.*/, `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
            } else {
              envContent += `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
            }
            fs.writeFileSync(envPath, envContent, 'utf8');
            this.logger.log('✅ Automatically saved GOOGLE_REFRESH_TOKEN to .env');
          }
        } catch (e) {
          this.logger.error('Failed to auto-save .env:', e);
        }

        refreshTokenInfo = `
          <div style="background: #e8f8f5; border: 1px solid #2ecc71; padding: 15px; border-radius: 8px; margin-top: 20px; text-align: left;">
            <strong style="color: #27ae60;">🎉 Đã tự động lưu Refresh Token vào .env!</strong><br><br>
            <small style="color: #555;">Mã refresh token của bạn:</small><br>
            <code style="word-break: break-all; font-size: 12px; background: #fff; padding: 4px; border: 1px solid #ddd; border-radius: 4px;">${tokens.refresh_token}</code>
          </div>
        `;
      }

      return res.send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #27ae60;">✅ Xác thực thành công!</h1>
            <p>Google Calendar đã được kết nối với Telegram Bot.</p>
            <p>Bạn có thể quay lại Telegram và sử dụng các lệnh.</p>
            ${refreshTokenInfo}
          </body>
        </html>
      `);
    } catch (err) {
      this.logger.error('Error exchanging code for tokens:', err);
      return res.send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #e74c3c;">❌ Xác thực thất bại</h1>
            <p>Mã xác thực không hợp lệ hoặc đã hết hạn.</p>
            <p>Vui lòng thử lại bằng lệnh /auth trên Telegram.</p>
          </body>
        </html>
      `);
    }
  }
}
