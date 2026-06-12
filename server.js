const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
app.use(express.json({ limit: '10mb' }));

const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
console.log('Loaded:', HTML.length, 'bytes');

const SYSTEM_PROMPT = 'Ban la AVTalent Content Pipeline Assistant. AVTalent la cong ty chuyen cung cap dich vu dao tao va giai phap nhan su tai Viet Nam (avtalent.vn). Dich vu: dao tao ky nang ban hang, phong thai doanh nhan, thuyet trinh & pitching, cham soc khach hang, Power BI, tuyen dung. Target: HR Manager, L&D Manager, C-level. Tone: professional, practical. Viet tieng Viet co dau day du. Contact: avtalent.vn | info@avtalent.vn | 0364 202 992';

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(HTML);
});

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
        r2.on('data', c => body += c);
        r2.on('end', () => res.json({ csv: body }));
      });
    } else {
      let body = '';
      response.on('data', c => body += c);
      response.on('end', () => res.json({ csv: body }));
    }
  }).on('error', e => res.status(500).json({ error: e.message }));
});

app.post('/api/chat', (req, res) => {
  const { messages } = req.body;
  const key = process.env.GROQ_API_KEY;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (!key) {
    res.write('data: ' + JSON.stringify({ error: 'GROQ_API_KEY chua duoc set tren Railway' }) + '\n\n');
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  const userMsg = messages[messages.length - 1].content;

  const body = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMsg }
    ],
    max_tokens: 4096,
    temperature: 0.7,
    stream: false
  });

  const options = {
    hostname: 'api.groq.com',
    path: '/openai/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key,
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const apiReq = https.request(options, (apiRes) => {
    let raw = '';
    apiRes.on('data', chunk => raw += chunk.toString());
    apiRes.on('end', () => {
      try {
        console.log('Groq status:', apiRes.statusCode);
        const parsed = JSON.parse(raw);

        if (parsed.error) {
          res.write('data: ' + JSON.stringify({ error: parsed.error.message }) + '\n\n');
          res.write('data: [DONE]\n\n');
          return res.end();
        }

        const text = parsed?.choices?.[0]?.message?.content || '';
        if (!text) {
          res.write('data: ' + JSON.stringify({ error: 'Khong co ket qua: ' + raw.slice(0, 200) }) + '\n\n');
          res.write('data: [DONE]\n\n');
          return res.end();
        }

        // Stream chunks for UX
        const chunkSize = 80;
        let i = 0;
        const interval = setInterval(() => {
          if (i >= text.length) {
            clearInterval(interval);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          res.write('data: ' + JSON.stringify({ text: text.slice(i, i + chunkSize) }) + '\n\n');
          i += chunkSize;
        }, 15);

      } catch(e) {
        res.write('data: ' + JSON.stringify({ error: 'Parse error: ' + raw.slice(0, 200) }) + '\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      }
    });
  });

  apiReq.on('error', (e) => {
    res.write('data: ' + JSON.stringify({ error: e.message }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });

  apiReq.write(body);
  apiReq.end();
});


app.post('/api/generate-image', (req, res) => {
  const { prompt, count } = req.body;
  const key = process.env.STABILITY_API_KEY;

  if (!key) {
    return res.json({ error: 'STABILITY_API_KEY chua duoc set tren Railway' });
  }

  const body = JSON.stringify({
    text_prompts: [
      { text: prompt, weight: 1 },
      { text: 'blurry, low quality, text, watermark, ugly, distorted', weight: -1 }
    ],
    cfg_scale: 7,
    height: 568,
    width: 896,
    samples: count || 2,
    steps: 30
  });

  const options = {
    hostname: 'api.stability.ai',
    path: '/v1/generation/stable-diffusion-v1-6/text-to-image',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key,
      'Accept': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const apiReq = https.request(options, (apiRes) => {
    let raw = '';
    apiRes.on('data', chunk => raw += chunk.toString());
    apiRes.on('end', () => {
      try {
        console.log('Stability status:', apiRes.statusCode, raw.slice(0, 100));
        const parsed = JSON.parse(raw);
        if (parsed.message || parsed.name) {
          return res.json({ error: parsed.message || parsed.name });
        }
        const images = (parsed.artifacts || []).map(function(a) { return a.base64; });
        res.json({ images: images });
      } catch(e) {
        res.json({ error: 'Parse error: ' + raw.slice(0, 200) });
      }
    });
  });

  apiReq.on('error', (e) => res.json({ error: e.message }));
  apiReq.write(body);
  apiReq.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('AVTalent Groq port ' + PORT));
