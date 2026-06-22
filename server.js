const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
app.use(express.json({ limit: '10mb' }));

const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

const SYSTEM_PROMPT = `Ban la chuyen gia san xuat noi dung cao cap cho AVTalent - thuong hieu dao tao nhan su hang dau Viet Nam.

AVTalent: avtalent.vn | 0364 202 992 | info@avtalent.vn
Dinh vi: Doi tac phat trien nguon nang luc cho doanh nghiep toan cau
Dich vu: Dao tao ky nang ban hang, phong thai doanh nhan, thuyet trinh & pitching, cham soc khach hang, Power BI, tuyen dung, tailor-made
Khach hang: HR Manager, L&D Manager, Training Manager, C-level, truong phong

NGUYEN TAC:
- Giong van: chuyen nghiep, gan gui, nhu co van kinh nghiem noi truc tiep
- Dung "ban" thay "quy khach". Cau ngan, mach lac.
- TRANH: "trong boi canh hien nay", "khong the phu nhan", "dong vai tro quan trong"
- 8 Content Pillars: Educational, Insight, Storytelling, Practical Tools, Debate, Trending, Community, Conversion(<=20%)
- VIET TIENG VIET CO DAU DAY DU`;

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(HTML);
});

app.get('/debug', (req, res) => {
  const k1 = process.env.GROQ_API_KEY;
  const k2 = process.env.GROQ_API_KEY_2;
  const k3 = process.env.GROQ_API_KEY_3;
  res.json({
    keys: [k1,k2,k3].filter(Boolean).length,
    k1: k1 ? k1.slice(0,8)+'...' : 'missing',
    k2: k2 ? k2.slice(0,8)+'...' : 'missing',
    k3: k3 ? k3.slice(0,8)+'...' : 'missing',
    models: ['openai/gpt-oss-120b','openai/gpt-oss-20b','qwen/qwen3.6-27b','qwen/qwen3-32b']
  });
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

// Call Groq with one specific key + model
function callGroq(key, model, userMsg) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg }
      ],
      max_tokens: 8192,
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

    const req = https.request(options, (apiRes) => {
      let raw = '';
      apiRes.on('data', chunk => raw += chunk.toString());
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) {
            resolve({ ok: false, error: parsed.error.message || 'unknown error' });
          } else {
            const text = parsed?.choices?.[0]?.message?.content || '';
            resolve({ ok: !!text, text: text, error: text ? null : 'empty response' });
          }
        } catch(e) {
          resolve({ ok: false, error: 'parse error: ' + raw.slice(0, 100) });
        }
      });
    });

    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(60000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

function isRetryable(error) {
  const e = (error || '').toLowerCase();
  return e.includes('rate') || e.includes('limit') || e.includes('tpd') || e.includes('tpm') ||
    e.includes('decommission') || e.includes('deprecat') || e.includes('no longer') ||
    e.includes('not found') || e.includes('does not exist') || e.includes('timeout') ||
    e.includes('quota') || e.includes('capacity') || e.includes('overloaded');
}

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const KEYS = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3
  ].filter(Boolean);

  const MODELS = [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'qwen/qwen3.6-27b',
    'qwen/qwen3-32b'
  ];

  if (KEYS.length === 0) {
    res.write('data: ' + JSON.stringify({ error: 'Chua set GROQ_API_KEY' }) + '\n\n');
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  const userMsg = messages[messages.length - 1].content;
  let lastError = '';

  // Try every key + model combo until one works
  outer: for (let ki = 0; ki < KEYS.length; ki++) {
    for (let mi = 0; mi < MODELS.length; mi++) {
      console.log('Try key' + (ki+1) + ' model:' + MODELS[mi]);
      const result = await callGroq(KEYS[ki], MODELS[mi], userMsg);
      console.log('Result:', result.ok, result.error || 'OK');

      if (result.ok && result.text) {
        // Stream the text in chunks
        const text = result.text;
        const chunkSize = 80;
        for (let i = 0; i < text.length; i += chunkSize) {
          res.write('data: ' + JSON.stringify({ text: text.slice(i, i + chunkSize) }) + '\n\n');
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      lastError = result.error || 'unknown';
      if (!isRetryable(lastError)) {
        // Non-retryable error - stop trying
        break outer;
      }
      // Retryable - try next combo
    }
  }

  res.write('data: ' + JSON.stringify({ error: 'Loi: ' + lastError }) + '\n\n');
  res.write('data: [DONE]\n\n');
  res.end();
});

app.post('/api/generate-image-pollinations', (req, res) => {
  const { prompt, seed } = req.body;
  const encodedPrompt = encodeURIComponent(prompt);
  const url = 'https://image.pollinations.ai/prompt/' + encodedPrompt +
    '?width=896&height=576&seed=' + (seed || Math.floor(Math.random()*99999)) +
    '&nologo=true&enhance=true&model=flux';

  function fetchImage(targetUrl, redirectCount) {
    if (redirectCount > 5) return res.json({ error: 'Too many redirects' });
    const req2 = https.get(targetUrl, { timeout: 120000 }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        return fetchImage(response.headers.location, redirectCount + 1);
      }
      const chunks = [];
      response.on('data', c => chunks.push(c));
      response.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = response.headers['content-type'] || 'image/jpeg';
        if (ct.includes('json') || ct.includes('text') || ct.includes('html') || buf.length < 1000) {
          return res.json({ error: buf.toString().slice(0, 200) });
        }
        res.json({ image: buf.toString('base64'), type: ct });
      });
      response.on('error', e => res.json({ error: e.message }));
    });
    req2.on('error', e => res.json({ error: e.message }));
    req2.on('timeout', () => { req2.destroy(); res.json({ error: 'Timeout' }); });
  }
  fetchImage(url, 0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const keys = [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY_3].filter(Boolean);
  console.log('AVTalent port ' + PORT + ' | Groq keys: ' + keys.length);
});
