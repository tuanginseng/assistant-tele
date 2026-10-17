/**
 * Script để lấy Google OAuth2 Refresh Token
 *
 * Chạy: npm run get-token
 *
 * Script sẽ:
 * 1. Mở browser để bạn đăng nhập Google
 * 2. Sau khi đăng nhập, copy URL redirect về
 * 3. Paste URL vào terminal
 * 4. Script sẽ hiển thị refresh_token để lưu vào .env
 */

import { google } from 'googleapis';
import * as readline from 'readline';
import * as dotenv from 'dotenv';

dotenv.config();

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

async function getRefreshToken() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URL || 'http://localhost:3000/auth/google/callback',
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n🔗 Mở link sau trong trình duyệt để đăng nhập Google:\n');
  console.log(authUrl);
  console.log('\n---');
  console.log('Sau khi đăng nhập, Google sẽ redirect về URL callback.');
  console.log('Copy phần "code" từ URL (sau ?code= và trước &scope=)');
  console.log('Hoặc paste toàn bộ URL redirect:\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('Nhập code hoặc URL redirect: ', async (input) => {
    rl.close();

    let code = input.trim();

    // Extract code from URL if full URL was pasted
    if (code.includes('code=')) {
      const url = new URL(code);
      code = url.searchParams.get('code') || code;
    }

    try {
      const { tokens } = await oauth2Client.getToken(code);

      console.log('\n✅ Xác thực thành công!\n');
      console.log('='.repeat(60));
      console.log('Lưu thông tin sau vào file .env:\n');

      if (tokens.refresh_token) {
        console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      }

      console.log('\n' + '='.repeat(60));
      console.log('\nSau khi lưu, khởi động lại bot: npm run start:dev\n');
    } catch (error) {
      console.error('\n❌ Lỗi xác thực:', error.message);
      console.error('Vui lòng thử lại.');
    }
  });
}

getRefreshToken();
