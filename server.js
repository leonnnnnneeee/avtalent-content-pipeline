const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '50mb' }));

const SYSTEM_PROMPT = `Bạn là AVTalent Content Pipeline Assistant — trợ lý sản xuất nội dung chuyên nghiệp cho AVTalent, công ty cung cấp giải pháp đào tạo nhân sự tại Việt Nam.

## Company Context
- AVTalent: Giải pháp đào tạo nhân sự, Corporate Learning & Development
- Target audience: HR Manager, L&D Manager, Training Manager, C-level, Department Head
- Tone: Professional, practical — không quá formal, không promotional
- Language: Tiếng Việt mặc định
- Contact: avtalent.vn | info@avtalent.vn | 0364 202 992

## 9-Step Pipeline
1. Kế hoạch nội dung tháng: content pillars + lịch đăng bài theo tuần
2. Generate Topics: 5-8 topics với angle, audience, kênh, CTA
3. Title & Hook: 3 titles + 4 hooks (pain point, statistic, question, bold)
4. Content Brief: SEO, outline, keywords, meta, slug, CTA
5. Review Brief: checklist 7 tiêu chí + revised brief
6. Viết Full Content: bài hoàn chỉnh H2/H3, keyword tự nhiên, CTA
7. Edit & Polish: intro, flow, readability, SEO, CTA
8. Convert Channel: Website↔Facebook↔LinkedIn
9. Image Prompts: 3 concepts + AI prompts, footer avtalent.vn bắt buộc

## Rules
- Thực hiện ngay, không hỏi nhiều
- Educational-first, không promotional
- LinkedIn: thêm bản EN, note [English below], max 3000 ký tự
- Image website: 852x568px bắt buộc`;

// Serve index.html directly - bypass static cache
app.get('/', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'index.html');
  const html = fs.readFileSync(filePath, 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(html);
});

app.post('/api/chat', async (req, res) => {
  const { messages, apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });

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
      messages
    });
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AVTalent Pipeline v3 port ${PORT}`));
