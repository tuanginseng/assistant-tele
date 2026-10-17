# 🤖 Trợ Lý Lịch Google Calendar - Telegram Bot

Bot Telegram giúp bạn quản lý Google Calendar ngay trên Telegram. Thêm, sửa, xóa sự kiện và nhận nhắc nhở tự động.

## ✨ Tính năng

- 📋 **Xem lịch**: Hôm nay, ngày mai, hoặc bất kỳ ngày nào
- ➕ **Thêm sự kiện**: Tạo nhanh sự kiện với tiêu đề, thời gian, mô tả
- ✏️ **Sửa sự kiện**: Cập nhật tiêu đề, thời gian, mô tả, địa điểm
- 🗑️ **Xóa sự kiện**: Xóa sự kiện theo ID
- 🔍 **Tìm kiếm**: Tìm sự kiện theo từ khóa
- 🔔 **Nhắc nhở tự động**: Nhắc trước 15 phút khi có sự kiện
- ☀️ **Tóm tắt hàng ngày**: Gửi lịch hôm nay lúc 7:00 sáng
- 🇻🇳 **Hỗ trợ tiếng Việt**: Nhập thời gian bằng tiếng Việt

## 🚀 Cài đặt

### 1. Chuẩn bị

#### Tạo Telegram Bot
1. Mở Telegram, tìm [@BotFather](https://t.me/BotFather)
2. Gõ `/newbot` và làm theo hướng dẫn
3. Lưu lại **Bot Token**

#### Thiết lập Google Calendar API
1. Truy cập [Google Cloud Console](https://console.cloud.google.com/)
2. Tạo project mới (hoặc chọn project có sẵn)
3. Bật **Google Calendar API** tại [Library](https://console.cloud.google.com/apis/library)
4. Vào **APIs & Services > Credentials**
5. Nhấn **Create Credentials > OAuth 2.0 Client ID**
6. Chọn loại **Web application**
7. Thêm Redirect URI: `http://localhost:3000/auth/google/callback`
8. Lưu lại **Client ID** và **Client Secret**

### 2. Cấu hình

```bash
# Clone project
cd "Trợ lý AI - Tele"

# Copy file env mẫu
cp .env.example .env

# Điền thông tin vào .env
nano .env
```

Nội dung file `.env`:
```env
TELEGRAM_BOT_TOKEN=your_bot_token
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URL=http://localhost:3000/auth/google/callback
GOOGLE_CALENDAR_ID=primary
TIMEZONE=Asia/Ho_Chi_Minh
PORT=3000
```

### 3. Cài đặt dependencies

```bash
npm install --legacy-peer-deps
```

### 4. Lấy Google Refresh Token

**Cách 1: Qua script (khuyên dùng)**
```bash
npm run get-token
```
Làm theo hướng dẫn trên terminal, sau đó lưu `GOOGLE_REFRESH_TOKEN` vào `.env`

**Cách 2: Qua Telegram Bot**
1. Chạy bot: `npm run start:dev`
2. Mở bot trên Telegram
3. Gõ `/auth` → bấm link đăng nhập Google
4. Bot sẽ trả về refresh token

### 5. Chạy bot

```bash
# Development (có hot-reload)
npm run start:dev

# Production
npm run build
npm run start:prod
```

## 📖 Hướng dẫn sử dụng

### Các lệnh có sẵn

| Lệnh | Mô tả | Ví dụ |
|-------|--------|-------|
| `/start` | Bắt đầu bot | `/start` |
| `/help` | Xem hướng dẫn | `/help` |
| `/today` | Lịch hôm nay | `/today` |
| `/tomorrow` | Lịch ngày mai | `/tomorrow` |
| `/events` | 10 sự kiện sắp tới | `/events` |
| `/date` | Lịch ngày cụ thể | `/date 20/10/2026` |
| `/search` | Tìm kiếm sự kiện | `/search họp nhóm` |
| `/add` | Thêm sự kiện | Xem bên dưới |
| `/edit` | Sửa sự kiện | Xem bên dưới |
| `/delete` | Xóa sự kiện | `/delete eventId` |
| `/auth` | Kết nối Google | `/auth` |
| `/status` | Kiểm tra kết nối | `/status` |

### Thêm sự kiện

```
/add Tiêu đề | Bắt đầu | Kết thúc
/add Tiêu đề | Bắt đầu | Kết thúc | Mô tả
/add Tiêu đề | Bắt đầu | Kết thúc | Mô tả | Địa điểm
```

**Ví dụ:**
```
/add Họp nhóm | hôm nay 14:00 | hôm nay 15:00
/add Ăn trưa với team | ngày mai 12:00 | ngày mai 13:00 | Team lunch | Nhà hàng ABC
/add Meeting | 20/10 09:00 | 20/10 10:30
/add Sprint Review | 2026-10-20T15:00:00 | 2026-10-20T16:00:00
```

### Sửa sự kiện

```
/edit eventId | field=value
```

Các field có thể sửa: `title`, `start`, `end`, `desc`, `location`

(Cũng hỗ trợ tiếng Việt: `tiêu đề`, `bắt đầu`, `kết thúc`, `mô tả`, `địa điểm`)

**Ví dụ:**
```
/edit abc123 | title=Họp nhóm mới
/edit abc123 | start=ngày mai 14:00 | end=ngày mai 15:30
/edit abc123 | title=Meeting | location=Phòng họp A
```

### Định dạng thời gian hỗ trợ

| Định dạng | Ví dụ |
|-----------|-------|
| Hôm nay + giờ | `hôm nay 14:00` |
| Ngày mai + giờ | `ngày mai 9:30` |
| DD/MM + giờ | `20/10 15:00` |
| DD/MM/YYYY + giờ | `20/10/2026 15:00` |
| ISO 8601 | `2026-10-20T15:00:00` |
| Chỉ giờ | `14:00` (mặc định hôm nay) |

## 🏗️ Kiến trúc

```
src/
├── main.ts                          # Entry point
├── app.module.ts                    # Root module
├── auth/
│   ├── auth.module.ts               # Auth module
│   └── auth.controller.ts           # OAuth2 callback handler
├── bot/
│   ├── bot.module.ts                # Bot module
│   ├── bot.update.ts                # Telegram command handlers
│   └── bot.service.ts               # Message formatting & parsing
├── google-calendar/
│   ├── google-calendar.module.ts    # Calendar module (global)
│   └── google-calendar.service.ts   # Google Calendar API service
├── reminder/
│   ├── reminder.module.ts           # Reminder module
│   └── reminder.service.ts          # Cron-based reminder service
└── scripts/
    └── get-google-token.ts          # CLI token retrieval script
```

## 🔔 Hệ thống nhắc nhở

- **Nhắc 15 phút trước**: Bot tự động nhắc trước 15 phút khi có sự kiện
- **Nhắc ngay khi bắt đầu**: Gửi thông báo khi sự kiện bắt đầu
- **Tóm tắt buổi sáng**: Lúc 7:00 AM mỗi ngày, bot gửi tóm tắt lịch trong ngày

## 📝 License

MIT
