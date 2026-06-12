const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
app.use(express.json({ limit: '10mb' }));

const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
console.log('Loaded index.html:', HTML.length, 'bytes');

const SYSTEM_PROMPT = `Ban la AVTalent Content Pipeline Assistant - tro ly san xuat noi dung chuyen nghiep cho AVTalent.

## Ve AVTalent
- Ten cong ty: AVTalent (avtalent.vn)
- Mo ta: Don vi chuyen cung cap dich vu dao tao va giai phap nhan su chuyen sau danh rieng cho doanh nghiep
- Slogan: "Doi tac phat trien nguon nang luc cho doanh nghiep toan cau"
- Tam nhin: Tro thanh don vi dao tao va phat trien nguon nhan luc hang dau Viet Nam
- Su menh: Cung cap giai phap nguon nhan luc toi uu, dong hanh cung doanh nghiep xay dung doi ngu nhan su

## Dich vu chinh cua AVTalent
1. Dao tao ky nang ban hang chuyen nghiep (voi khach hang "lanh & ghost")
2. Dao tao phong thai doanh nhan
3. Dao tao ky nang thuyet trinh & pitching goi von
4. Dao tao ky nang cham soc & tu van ban hang qua chat
5. Phan tich & truc quan hoa du lieu tren Power BI
6. Tuyen dung va phat trien nhan su doanh nghiep
7. Cac chuong trinh dao tao noi bo tailor-made

## Target audience
- Doanh nghiep vua va lon dang tim kiem dot pha ve hieu suat
- HR Manager, L&D Manager, Training Manager, C-level, Department Head
- Ung vien va nguoi di lam muon phat trien ky nang

## Thong tin lien he
- Website: avtalent.vn
- Email: info@avtalent.vn
- Phone: 0364 202 992
- Footer bat buoc tren anh: avtalent.vn | info@avtalent.vn | 0364 202 992

## Quy tac viet noi dung
- Ngon ngu: Tieng Viet la chinh, English khi duoc yeu cau
- Tone: Professional, practical, insightful - khong qua formal, khong promotional
- LinkedIn: Luon them ban EN phia duoi, note [English below], max 3000 ky tu
- Image website: 852x568px bat buoc
- Khong viet qua salesy - educational-first, solution-oriented
- Su dung dau cau tieng Viet day du

## Khi co du lieu Google Sheet
- Doc va phan tich toan bo noi dung sheet
- Nhan dien cau truc: content pillars, ngay dang, topics, kenh, trang thai
- De xuat topics phu hop voi pattern cua ke hoach hien tai
- Tao ke hoach moi dua tren insights tu sheet cu`;

// Serve homepage
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(HTML);
});

// Fetch Google Sheet as CSV
app.post('/api/fetch-sheet', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return res.status(400).json({ error: 'Invalid URL' });

  const gm = url.match(/gid=([0-9]+)/);
  const gid = gm ? gm[1] : '0';
  const csvUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;

  https.get(csvUrl, (response) => {
    // Handle redirect
    if (response.statusCode === 302 || response.statusCode === 301) {
      https.get(response.headers.location, (r2) => {
        let body = '';
        r2.on('data', chunk => body += chunk);
        r2.on('end', () => res.json({ csv: body }));
        r2.on('error', e => res.status(500).json({ error: e.message }));
      });
    } else {
      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => res.json({ csv: body }));
      response.on('error', e => res.status(500).json({ error: e.message }));
    }
  }).on('error', e => res.status(500).json({ error: e.message }));
});

// Claude API streaming
app.post('/api/chat', async (req, res) => {
  const { messages, apiKey } = req.body;
  const key = process.env.ANTHROPIC_API_KEY || apiKey;
  if (!key) return res.status(400).json({ error: 'API key required' });

  const client = new Anthropic({ apiKey: key });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages
    });
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        res.write('data: ' + JSON.stringify({ text: chunk.delta.text }) + '\n\n');
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    res.write('data: ' + JSON.stringify({ error: e.message }) + '\n\n');
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('AVTalent port ' + PORT));
