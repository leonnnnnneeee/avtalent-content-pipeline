# AVTalent Content Pipeline

Webapp AI hỗ trợ toàn bộ quy trình sản xuất nội dung 9 bước cho AVTalent.

## Deploy lên Railway (tự động)

### Bước 1: Push lên GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/avtalent-content-pipeline.git
git push -u origin main
```

### Bước 2: Deploy trên Railway

1. Vào [railway.app](https://railway.app) → New Project
2. Chọn **Deploy from GitHub repo**
3. Chọn repo `avtalent-content-pipeline`
4. Railway tự detect Node.js và deploy
5. Vào **Settings → Networking → Generate Domain** để có URL công khai

### Bước 3: Sử dụng

- Mở URL Railway cấp
- Nhập Anthropic API Key ở góc dưới trái
- Bắt đầu tạo nội dung!

## Chạy local

```bash
npm install
npm start
# Mở http://localhost:3000
```

## Tech Stack

- **Backend**: Node.js + Express
- **AI**: Claude Sonnet via Anthropic SDK (streaming)
- **Frontend**: Vanilla HTML/CSS/JS
- **Deploy**: Railway (auto-deploy từ GitHub)

## Tính năng

- ✅ 9-step content pipeline cho AVTalent
- ✅ Streaming response (real-time)
- ✅ Markdown rendering (bảng, heading, code)
- ✅ Quick action buttons cho từng bước
- ✅ Copy nội dung 1 click
- ✅ Lịch sử hội thoại trong session
- ✅ Dark mode professional UI
