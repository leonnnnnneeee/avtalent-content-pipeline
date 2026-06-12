const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
app.use(express.json({ limit: '10mb' }));

const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
console.log('Loaded:', HTML.length, 'bytes');

const SYSTEM_PROMPT = `Bạn là AVTalent Content Pipeline Assistant - trợ lý sản xuất nội dung chuyên nghiệp cho AVTalent.

AVTalent là đơn vị chuyên cung cấp dịch vụ đào tạo và giải pháp nhân sự chuyên sâu tại Việt Nam (avtalent.vn).
Slogan: "Đối tác phát triển nguồn năng lực cho doanh nghiệp toàn cầu"

Dịch vụ chính:
- Đào tạo kỹ năng bán hàng chuyên nghiệp
- Đào tạo phong thái doanh nhân  
- Đào tạo kỹ năng thuyết trình & pitching gọi vốn
- Đào tạo kỹ năng chăm sóc & tư vấn bán hàng qua chat
- Phân tích & trực quan hóa dữ liệu trên Power BI
- Tuyển dụng và phát triển nhân sự doanh nghiệp
- Các chương trình đào tạo nội bộ tailor-made

Target audience: HR Manager, L&D Manager, Training Manager, C-level, Department Head
Tone: Professional, practical, insightful - không quá formal, không promotional
Ngôn ngữ: Tiếng Việt có dấu đầy đủ là mặc định
LinkedIn: Luôn thêm bản EN phía dưới, note [English below], max 3000 ký tự
Image website: 852x568px, footer bắt buộc: avtalent.vn | info@avtalent.vn | 0364 202 992
Không viết quá salesy - educational-first, solution-oriented`;

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
    height: 1024,
    width: 1024,
    samples: count || 2,
    steps: 30
  });

  const options = {
    hostname: 'api.stability.ai',
    path: '/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
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


app.post('/api/generate-image-ideogram', (req, res) => {
  const { prompt, style } = req.body;
  const key = process.env.IDEOGRAM_API_KEY;

  if (!key) {
    return res.json({ error: 'IDEOGRAM_API_KEY chua duoc set tren Railway' });
  }

  const styleMap = {
    'Modern Corporate': 'DESIGN',
    'Minimalist Professional': 'DESIGN',
    'Bold & Dynamic': 'DESIGN',
    'Warm & Human': 'REALISTIC',
    'Blue & Gold Premium': 'DESIGN'
  };

  const aspectMap = {
    'Website (852x568px)': 'ASPECT_16_9',
    'Facebook': 'ASPECT_1_1',
    'Ca hai': 'ASPECT_1_1'
  };

  const body = JSON.stringify({
    image_request: {
      prompt: prompt,
      aspect_ratio: aspectMap[req.body.channel] || 'ASPECT_1_1',
      model: 'V_2',
      style_type: styleMap[style] || 'DESIGN',
      magic_prompt_option: 'AUTO',
      num_images: 2
    }
  });

  const options = {
    hostname: 'api.ideogram.ai',
    path: '/generate',
    method: 'POST',
    headers: {
      'Api-Key': key,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const apiReq = https.request(options, (apiRes) => {
    let raw = '';
    apiRes.on('data', chunk => raw += chunk.toString());
    apiRes.on('end', () => {
      try {
        console.log('Ideogram status:', apiRes.statusCode, raw.slice(0, 200));
        const parsed = JSON.parse(raw);
        if (parsed.error || (parsed.detail && !parsed.data)) {
          return res.json({ error: JSON.stringify(parsed.detail || parsed.error) });
        }
        const images = (parsed.data || []).map(function(img) {
          return { url: img.url, prompt: img.prompt };
        });
        res.json({ images: images });
      } catch(e) {
        res.json({ error: 'Parse error: ' + raw.slice(0, 300) });
      }
    });
  });

  apiReq.on('error', (e) => res.json({ error: e.message }));
  apiReq.write(body);
  apiReq.end();
});


app.post('/api/generate-image-hf', async (req, res) => {
  const { prompt } = req.body;
  const key = process.env.HF_API_KEY;

  if (!key) {
    return res.json({ error: 'HF_API_KEY chua duoc set tren Railway' });
  }

  const body = JSON.stringify({ inputs: prompt });

  const options = {
    hostname: 'api-inference.huggingface.co',
    path: '/models/black-forest-labs/FLUX.1-dev',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const apiReq = https.request(options, (apiRes) => {
    const chunks = [];
    apiRes.on('data', chunk => chunks.push(chunk));
    apiRes.on('end', () => {
      const raw = Buffer.concat(chunks);
      console.log('HF status:', apiRes.statusCode, 'size:', raw.length);
      
      // Check if response is JSON (error) or binary (image)
      const contentType = apiRes.headers['content-type'] || '';
      if (contentType.includes('application/json') || contentType.includes('text')) {
        try {
          const parsed = JSON.parse(raw.toString());
          if (parsed.error) return res.json({ error: parsed.error });
          return res.json({ error: 'Unknown response: ' + raw.toString().slice(0, 200) });
        } catch(e) {
          return res.json({ error: raw.toString().slice(0, 200) });
        }
      }
      
      // Binary image response - convert to base64
      const base64 = raw.toString('base64');
      res.json({ images: [{ base64: base64, type: 'image/jpeg' }] });
    });
  });

  apiReq.on('error', (e) => res.json({ error: e.message }));
  apiReq.write(body);
  apiReq.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('AVTalent Groq port ' + PORT));
