const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const https = require('https');

const app = express();
app.use(express.json({ limit: '50mb' }));

// Serve static files with NO cache to ensure latest version always loads
app.use(express.static('public', {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

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

## Rules
- Nếu user bắt đầu từ bất kỳ bước nào, thực hiện ngay
- Không hỏi quá nhiều — chỉ hỏi khi thiếu thông tin quan trọng
- Dùng bảng khi hữu ích
- Không viết quá promotional — educational-first
- Luôn output publish-ready content`;

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
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// v2.0 - full pipeline UI
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AVTalent Content Pipeline v2.0 running on port ${PORT}`));
