const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
app.use(express.json({ limit: '10mb' }));

const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
console.log('Loaded index.html:', HTML.length, 'bytes');

const SYSTEM_PROMPT = `Ban la AVTalent Content Pipeline Assistant - tro ly san xuat noi dung chuyen nghiep cho AVTalent.

Ve AVTalent:
- Ten: AVTalent (avtalent.vn) - Don vi dao tao va giai phap nhan su chuyen sau
- Slogan: Doi tac phat trien nguon nang luc cho doanh nghiep toan cau
- Dich vu: Dao tao ky nang ban hang, phong thai doanh nhan, thuyet trinh & pitching, cham soc khach hang qua chat, Power BI, tuyen dung nhan su, chuong trinh dao tao tailor-made
- Target: Doanh nghiep vua lon, HR Manager, L&D Manager, Training Manager, C-level
- Contact: avtalent.vn | info@avtalent.vn | 0364 202 992

Quy tac:
- Viet tieng Viet co dau day du
- Tone professional, practical, khong promotional
- LinkedIn: them ban EN phia duoi, [English below], max 3000 ky tu
- Image website: 852x568px, footer bat buoc: avtalent.vn | info@avtalent.vn | 0364 202 992
- Educational-first, solution-oriented`;

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
  const csvUrl = 'https://docs.google.com/spreadsheets/d/' + m[1] + '/export?format=csv&gid=' + gid;
  https.get(csvUrl, (response) => {
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

// Gemini API streaming
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(400).json({ error: 'GEMINI_API_KEY not set' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // Build Gemini request
    const userMsg = messages[messages.length - 1].content;
    const fullPrompt = SYSTEM_PROMPT + '\n\nYeu cau: ' + userMsg;

    const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=' + key;
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.7 }
    });

    const urlObj = new URL(geminiUrl);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };

    const apiReq = https.request(options, (apiRes) => {
      apiRes.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') { res.write('data: [DONE]\n\n'); return; }
            try {
              const parsed = JSON.parse(data);
              const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) res.write('data: ' + JSON.stringify({ text }) + '\n\n');
            } catch(e) {}
          }
        }
      });
      apiRes.on('end', () => { res.write('data: [DONE]\n\n'); res.end(); });
      apiRes.on('error', (e) => { res.write('data: ' + JSON.stringify({ error: e.message }) + '\n\n'); res.end(); });
    });

    apiReq.on('error', (e) => { res.write('data: ' + JSON.stringify({ error: e.message }) + '\n\n'); res.end(); });
    apiReq.write(body);
    apiReq.end();

  } catch (e) {
    res.write('data: ' + JSON.stringify({ error: e.message }) + '\n\n');
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('AVTalent port ' + PORT));
