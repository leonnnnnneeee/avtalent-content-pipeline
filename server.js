const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
app.use(express.json({ limit: '10mb' }));

const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

const SYSTEM_PROMPT = `AVTalent content expert. avtalent.vn | 0364 202 992 | info@avtalent.vn. Dao tao nhan su VN. Viet tieng Viet co dau, giong tu nhien, khong sao rong.`;

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
