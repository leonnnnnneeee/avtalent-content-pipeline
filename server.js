const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
app.use(express.json({ limit: '10mb' }));

const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
console.log('Loaded:', HTML.length, 'bytes');

const SYSTEM_PROMPT = `Ban la chuyen gia san xuat noi dung cao cap cho AVTalent - thuong hieu dao tao nhan su hang dau Viet Nam.

AVTalent: avtalent.vn | 0364 202 992 | info@avtalent.vn
Dinh vi: Doi tac phat trien nguon nang luc cho doanh nghiep toan cau
Dich vu: Dao tao ky nang ban hang, phong thai doanh nhan, thuyet trinh & pitching, cham soc khach hang, Power BI, tuyen dung, tailor-made
Khach hang: HR Manager, L&D Manager, Training Manager, C-level, truong phong

NGUYEN TAC VIET NOI DUNG:
- Giong van: chuyen nghiep nhung gan gui, nhu co van kinh nghiem noi chuyen truc tiep
- Dung "ban" thay vi "quy khach"
- Cau ngan, mach lac - tranh cau long vong
- Cam xuc that, insight thuc te - khong rap khuon
- TRANH: "trong boi canh hien nay", "khong the phu nhan", "dong vai tro quan trong", "hon bao gio het"

8 CONTENT PILLARS (phai mix du):
1. Educational/How-to: huong dan thuc te, step-by-step, framework
2. Insight/Xu huong: data, research, phan tich xu huong HR/L&D
3. Storytelling: cau chuyen hoc vien, behind the scenes, hanh trinh
4. Practical Tools: checklist, template, framework dung ngay
5. Debate/Quan diem: phan bien quan niem sai, unpopular opinion
6. Trending: AI trong dao tao, xu huong kinh doanh, chinh sach moi
7. Community: poll, cau hoi tuong tac, chia se cong dong
8. Conversion (toi da 20%): gioi thieu chuong trinh, testimonial

VIET TIENG VIET CO DAU DAY DU trong tat ca output.`;

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

const GROQ_KEYS = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3
].filter(Boolean);

const MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'llama-3.2-11b-vision-preview'
];

app.post('/api/chat', (req, res) => {
  const { messages } = req.body;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (GROQ_KEYS.length === 0) {
    res.write('data: ' + JSON.stringify({ error: 'Chua set GROQ_API_KEY tren Railway' }) + '\n\n');
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  const userMsg = messages[messages.length - 1].content;

  // Try each key x each model = max 9 combinations
  function tryCombo(keyIdx, modelIdx) {
    if (keyIdx >= GROQ_KEYS.length) {
      res.write('data: ' + JSON.stringify({ error: 'Tat ca API keys deu bi rate limit hom nay. Thu lai ngay mai hoac them key moi tai console.groq.com/keys' }) + '\n\n');
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    if (modelIdx >= MODELS.length) {
      return tryCombo(keyIdx + 1, 0); // next key, reset model
    }

    const key = GROQ_KEYS[keyIdx];
    const model = MODELS[modelIdx];
    console.log('Trying key', keyIdx + 1, 'model:', model);

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

    const apiReq = https.request(options, (apiRes) => {
      let raw = '';
      apiRes.on('data', chunk => raw += chunk.toString());
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) {
            const msg = parsed.error.message || '';
            if (msg.includes('rate_limit') || msg.includes('Rate limit') || msg.includes('TPD') || msg.includes('TPM') || msg.includes('decommissioned') || msg.includes('deprecated')) {
              console.log('Rate limit/deprecated key', keyIdx+1, 'model', model, '- trying next...');
              return tryCombo(keyIdx, modelIdx + 1); // try next model same key
            }
            res.write('data: ' + JSON.stringify({ error: msg }) + '\n\n');
            res.write('data: [DONE]\n\n');
            return res.end();
          }

          const text = parsed?.choices?.[0]?.message?.content || '';
          if (!text) {
            res.write('data: ' + JSON.stringify({ error: 'No response from ' + model }) + '\n\n');
            res.write('data: [DONE]\n\n');
            return res.end();
          }

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
          res.write('data: ' + JSON.stringify({ error: 'Parse error: ' + raw.slice(0, 100) }) + '\n\n');
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
  }

  tryCombo(0, 0);
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
app.listen(PORT, () => console.log('AVTalent v3 port ' + PORT));
