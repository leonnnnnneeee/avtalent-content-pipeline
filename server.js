const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'));
});

app.post('/api/chat', async (req, res) => {
  const { messages, apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  const client = new Anthropic({ apiKey });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  try {
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6', max_tokens: 4096,
      system: `Bạn là AVTalent Content Pipeline Assistant. AVTalent là công ty giải pháp đào tạo nhân sự VN. Tone: professional, practical. Tiếng Việt. Contact: avtalent.vn | info@avtalent.vn | 0364 202 992`,
      messages
    });
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta')
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AVTalent v4 port ${PORT}`));
