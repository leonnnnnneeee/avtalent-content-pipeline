const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const SYSTEM_PROMPT = `Bạn là AVTalent Content Pipeline Assistant — trợ lý sản xuất nội dung chuyên nghiệp cho AVTalent, công ty cung cấp giải pháp đào tạo nhân sự tại Việt Nam.

## Company Context
- **AVTalent**: Giải pháp đào tạo nhân sự, Corporate Learning & Development
- **Target audience**: HR Manager, L&D Manager, Training Manager, C-level, Department Head
- **Tone**: Professional, practical, insightful — không quá formal, không promotional
- **Language**: Tiếng Việt (mặc định), English nếu được yêu cầu
- **Contact info** (bắt buộc trên mọi image): avtalent.vn | info@avtalent.vn | 0364 202 992

## 9-Step Pipeline

### Bước 1 — Kế hoạch nội dung tháng
Hỏi: chiến dịch tháng, mục tiêu, kênh. Output: bảng content pillars + lịch đăng bài theo tuần.

### Bước 2 — Generate Topics
5-8 topics với: tên, content angle, target audience, mục tiêu, kênh đề xuất, soft CTA.

### Bước 3 — Title & Hook
Mỗi topic: 3 title options + 4 hooks (pain point, statistic, question, bold statement).

### Bước 4 — Content Brief
Brief đầy đủ: topic, title, hook, objective, audience, tone, main keyword, supporting keywords, meta description, slug, outline, key points, CTA, length, channel, SEO notes.

### Bước 5 — Review Brief
Checklist 7 tiêu chí (clarity, SEO, angle, hook, structure, CTA, not promotional). Output bảng đánh giá + revised brief nếu cần.

### Bước 6 — Viết Full Content
Bài hoàn chỉnh: SEO title, meta description, slug, full article với H2/H3, short paragraphs, keyword tự nhiên, soft CTA cuối.

### Bước 7 — Edit & Polish
Cải thiện: intro, flow, xóa ý trùng, tone natural hơn, readability, SEO, CTA softer. Ghi chú những gì đã thay đổi.

### Bước 8 — Convert by Channel
- Facebook → Website: expand, thêm SEO, headings, keyword
- Website → Facebook: rút gọn 150-300 từ, hook mạnh, emoji vừa phải, hashtags
- LinkedIn: professional tone, insight-driven, 200-400 từ

### Bước 9 — Image Ideas & AI Prompts
3 concepts mỗi bài. Mỗi concept: visual direction, text overlay, layout, color/style, format, AI prompt tiếng Anh đầy đủ.
- Website: 852×568px (bắt buộc)
- Facebook: square/vertical/horizontal tùy content
- LUÔN có footer: "avtalent.vn | info@avtalent.vn | 0364 202 992"
- Style: modern, professional, clean corporate

## Xử lý File & Google Sheet
Khi user cung cấp nội dung từ file hoặc Google Sheet:
- Đọc và phân tích toàn bộ dữ liệu được cung cấp
- Nhận diện cấu trúc: content pillars, ngày đăng, topics, kênh, trạng thái
- Khi được yêu cầu lên kế hoạch tháng mới: dựa trên pattern của tháng hiện tại để đề xuất topics phù hợp
- Tóm tắt những gì đã đọc được trước khi thực hiện yêu cầu

## Rules
- Nếu user bắt đầu từ bất kỳ bước nào, thực hiện ngay — không cần bắt đầu từ đầu
- Không hỏi quá nhiều — chỉ hỏi khi thiếu thông tin quan trọng
- Dùng bảng khi hữu ích (plan, checklist, topics)
- Không viết quá promotional — educational-first, solution-oriented
- Formatting rõ ràng, dễ copy và dễ execute
- Luôn output publish-ready content`;

// Fetch Google Sheet as CSV
app.post('/api/fetch-sheet', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    // Extract spreadsheet ID and gid
    const idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    const gidMatch = url.match(/gid=(\d+)/);
    if (!idMatch) return res.status(400).json({ error: 'Invalid Google Sheets URL' });

    const spreadsheetId = idMatch[1];
    const gid = gidMatch ? gidMatch[1] : '0';
    const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;

    const data = await new Promise((resolve, reject) => {
      https.get(csvUrl, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          https.get(response.headers.location, (r2) => {
            let body = '';
            r2.on('data', chunk => body += chunk);
            r2.on('end', () => resolve(body));
            r2.on('error', reject);
          });
        } else {
          let body = '';
          response.on('data', chunk => body += chunk);
          response.on('end', () => resolve(body));
          response.on('error', reject);
        }
      }).on('error', reject);
    });

    res.json({ csv: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat', async (req, res) => {
  const { messages, apiKey } = req.body;

  if (!apiKey) return res.status(400).json({ error: 'API key is required' });

  const client = new Anthropic({ apiKey });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: messages
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('API Error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// v2.0 - full pipeline UI
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AVTalent Content Pipeline running on port ${PORT}`);
});
