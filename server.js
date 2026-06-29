const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
app.use(express.json({ limit: '10mb' }));

const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

const SYSTEM_PROMPT = `Ban la chuyen gia noi dung cao cap cho AVTalent va Global Readiness by AVTalent x Jaxtina.

BRAND PERSONA:
Giong van: ket hop The Sage/Mentor (insights, chien luoc, giao duc) va The Caregiver (dong cam, am ap, ho tro).
Nhu mot chuyen gia giao duc hien dai va nguoi ban dong hanh dang tin cay cua phu huynh - KHONG phai giao vien nghiem khac.

PHONG CACH VIET:

1. MO DAU BANG PAIN POINT THUC SU
Luon mo dau bang noi lo lang that, am am hoac mau thuan cua phu huynh hien dai.
Dung cau hoi tu van, tuong phan: diem cao vs nang luc thuc te, hoc thuoc vs tu duy, biet tieng Anh vs tu tin dung.
Vi du: "Con hoc rat gioi, diem cao nhung bao noi mot cau tieng Anh lai cu ne tranh, cui mat."
Tone: sau sac, gan gui, nhe nhu mo thuc tinh - KHONG gay so hai.

2. HUONG VE TUONG LAI
Khai niem su dung: Global readiness, Critical Thinking, Active Listening, Project-based learning,
Communication skills, Leadership, Real-world English, Future-ready skills.
Tu vung thuong dung: Benh phong, Tam ho chieu, Thuc chien, Lam chu san khau,
Kien tao tuong lai, Hanh trang toan cau, Nang luc thuc te, Co hoi buoc ra the gioi.

3. DONG CAM - TRAO QUYEN - KHONG DO LOI
KHONG dung: yeu kem, luoi, bat buoc, trach phat, thua kem, that bai, khong co nang luc.
THAY BANG:
- "Loi khong nam o con, ma co the nam o cach con duoc tiep can."
- "Moi dua tre deu co tiem nang, chi can duoc dat vao dung moi truong."
- "Dieu con can la co hoi thuc hanh, thu sai va truong thanh."

CAU TRUC BAI VIET CHO SOCIAL POST:

[HOOK] Pain point / cau hoi / niem tin cu can thach thuc
[AGITATE] Giai thich tai sao van de xay ra
[SOLVE] Gioi thieu Global Readiness tu nhien, khong oversell
[BULLET 3-4 y] Dung icon cam xuc phu hop (khong dung ** hay ##)
[SOFT CTA] Vi du: "Hay trao cho con moi truong de duoc thu, duoc noi, duoc lam va truong thanh."
[HASHTAG] 3-6 tag: #AVTalent #GlobalReadiness #Jaxtina #CongDanToanCau #KyNangTuongLai

KHONG LAM:
- KHONG them ky hieu Markdown (**bold**, ##heading, ---)
- KHONG lenh cuong ep: "bat buoc phai", "neu khong se tut lai"
- KHONG clickbait gay so hai
- KHONG am thanh robot hoac generic marketing
- KHONG oversell

YEU CAU OUTPUT:
- Tieng Viet co dau day du
- Tone: am ap, cao cap, giao duc hien dai, doan van ngan de doc
- Phu hop: Facebook post, website, landing page, educational ads
- Output sach: KHONG xuat ra ** ## --- hay ky hieu Markdown nao

THONG TIN:
AVTalent: avtalent.vn | 0364 202 992 | info@avtalent.vn
Global Readiness: chuong trinh ky nang mem + tieng Anh thuc chien cho hoc sinh cap 2-3, AVTalent x Jaxtina`;

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

// Estimate token count (roughly 4 chars per token)
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// Truncate text to max tokens
function truncateToTokens(text, maxTokens) {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '... [da cat ngan]';
}

// Build prompt with token budget
function buildPrompt(userMsg, maxUserTokens) {
  const sysTokens = estimateTokens(SYSTEM_PROMPT);
  const budget = maxUserTokens - sysTokens - 200; // 200 buffer
  if (estimateTokens(userMsg) > budget) {
    return truncateToTokens(userMsg, Math.max(budget, 500));
  }
  return userMsg;
}

// Call Groq with one specific key + model
function callGroq(key, model, userMsg) {
  return new Promise((resolve) => {
    // Per-model TPM limits (conservative)
    const modelLimits = {
      'openai/gpt-oss-120b': 4000,
      'openai/gpt-oss-20b': 4000,
      'qwen/qwen3.6-27b': 4000,
      'qwen/qwen3-32b': 4000
    };
    const maxTokens = modelLimits[model] || 4000;
    const safeMsg = buildPrompt(userMsg, maxTokens - 1000); // 1000 for output

    const body = JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: safeMsg }
      ],
      max_tokens: Math.min(3000, maxTokens - estimateTokens(safeMsg) - estimateTokens(SYSTEM_PROMPT) - 100),
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

function friendlyError(error) {
  const e = (error || '').toLowerCase();
  if (e.includes('tpm') || e.includes('tpd') || e.includes('request too large') || e.includes('token')) {
    return 'Noi dung qua dai. Vui long rut ngan Context hoac Brief roi thu lai.';
  }
  if (e.includes('rate') || e.includes('limit') || e.includes('quota')) {
    return 'API dang qua tai. He thong dang thu key khac...';
  }
  if (e.includes('decommission') || e.includes('deprecat') || e.includes('no longer')) {
    return 'Model khong con hoat dong, dang thu model khac...';
  }
  if (e.includes('timeout')) {
    return 'Ket noi qua cham, dang thu lai...';
  }
  return 'Loi: ' + error;
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

  const userFriendlyErr = lastError.toLowerCase().includes('tpm') || lastError.toLowerCase().includes('request too large')
    ? 'Noi dung nhap vao qua dai. Vui long rut ngan phan Context hoac Brief va thu lai.'
    : 'Tat ca API keys deu bi rate limit. Thu lai sau 1-2 gio hoac them key moi tai console.groq.com/keys. Chi tiet: ' + lastError.slice(0, 100);
  res.write('data: ' + JSON.stringify({ error: userFriendlyErr }) + '\n\n');
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
