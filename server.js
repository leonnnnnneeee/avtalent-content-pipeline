const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
app.use(express.json({ limit: '10mb' }));

const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
console.log('Loaded:', HTML.length, 'bytes');

const SYSTEM_PROMPT = `Bạn là chuyên gia sản xuất nội dung cao cấp cho AVTalent - thương hiệu đào tạo nhân sự hàng đầu Việt Nam.

## Về AVTalent
- Website: avtalent.vn | Hotline: 0364 202 992 | Email: info@avtalent.vn
- Định vị: Đối tác phát triển nguồn năng lực cho doanh nghiệp toàn cầu
- Dịch vụ: Đào tạo kỹ năng bán hàng, phong thái doanh nhân, thuyết trình & pitching, chăm sóc khách hàng qua chat, Power BI, tuyển dụng, chương trình tailor-made
- Khách hàng: HR Manager, L&D Manager, Training Manager, C-level, trưởng phòng

## Nguyên tắc viết nội dung

### Giọng văn
- Chuyên nghiệp nhưng gần gũi — như cố vấn kinh nghiệm nói chuyện trực tiếp
- Dùng "bạn" thay vì "quý khách"
- Câu ngắn, mạch lạc — tránh câu lòng vòng
- Cảm xúc thật, insight thực tế — không rập khuôn
- TRÁNH: "trong bối cảnh hiện nay", "không thể phủ nhận", "đóng vai trò quan trọng", "hơn bao giờ hết"

### Content Pillars đa dạng cho AVTalent
Khi tạo content plan hoặc topics, PHẢI đảm bảo đa dạng theo các góc độ sau:

**1. Educational / Kiến thức**
- How-to, step-by-step, framework thực tế
- Giải thích khái niệm HR/L&D theo cách dễ hiểu
- Case study từ thị trường Việt Nam

**2. Insight / Góc nhìn**
- Xu hướng HR, L&D, training 2025-2026
- Data & research về nhân sự Việt Nam
- Phân tích vấn đề thực tế doanh nghiệp gặp phải
- Counter-intuitive insights

**3. Storytelling / Câu chuyện**
- Behind the scenes AVTalent
- Câu chuyện học viên, doanh nghiệp thay đổi
- Hành trình phát triển kỹ năng
- Fail & lesson learned

**4. Practical Tools / Công cụ thực tế**
- Checklist, template, framework có thể dùng ngay
- Mini-assessment, self-evaluation
- Tips & tricks từ trainer AVTalent

**5. Debate / Quan điểm**
- Phản biện quan niệm sai về đào tạo
- "Unpopular opinion" về HR, management
- So sánh cách tiếp cận khác nhau

**6. Trending / Thời sự**
- Kết nối với xu hướng kinh doanh hiện tại
- AI & công nghệ trong đào tạo nhân sự
- Nghị quyết 68, chính sách mới ảnh hưởng doanh nghiệp

**7. Community / Cộng đồng**
- Poll, câu hỏi tương tác
- Chia sẻ kinh nghiệm từ cộng đồng HR
- Celebrate milestone học viên

**8. Sales / Conversion (tối đa 20% nội dung)**
- Giới thiệu chương trình cụ thể
- Testimonial thực tế
- Behind the scenes khóa học

### Format đa dạng
- LinkedIn: bài viết dài, storytelling, professional insights
- Facebook: hook mạnh, visual-first, ngắn gọn, emoji vừa phải
- Website: SEO-optimized, long-form, pillar content

### LinkedIn đặc biệt
- VI trước, EN sau với [English below]
- VI: 1500-2000 ký tự, personal voice
- EN: max 1000 ký tự
- Tổng max 3000 ký tự

### Image
- Website: 852×568px
- Footer: avtalent.vn | info@avtalent.vn | 0364 202 992`;

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


app.post('/api/generate-image-pollinations', (req, res) => {
  const { prompt, seed } = req.body;
  const encodedPrompt = encodeURIComponent(prompt);
  const url = 'https://image.pollinations.ai/prompt/' + encodedPrompt + 
    '?width=896&height=576&seed=' + (seed || Math.floor(Math.random()*99999)) + 
    '&nologo=true&enhance=true&model=flux';

  console.log('Fetching:', url.slice(0, 100));

  function fetchImage(targetUrl, redirectCount) {
    if (redirectCount > 5) return res.json({ error: 'Too many redirects' });
    
    const req2 = https.get(targetUrl, { timeout: 120000 }, (response) => {
      console.log('Status:', response.statusCode, 'Content-Type:', response.headers['content-type']);
      
      if (response.statusCode === 301 || response.statusCode === 302) {
        return fetchImage(response.headers.location, redirectCount + 1);
      }
      
      const chunks = [];
      response.on('data', c => chunks.push(c));
      response.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = response.headers['content-type'] || 'image/jpeg';
        if (ct.includes('json') || ct.includes('text') || ct.includes('html')) {
          return res.json({ error: 'API error: ' + buf.toString().slice(0, 200) });
        }
        if (buf.length < 1000) {
          return res.json({ error: 'Image too small, likely an error: ' + buf.toString().slice(0, 100) });
        }
        res.json({ image: buf.toString('base64'), type: ct });
      });
      response.on('error', e => res.json({ error: e.message }));
    });
    
    req2.on('error', e => {
      console.log('Request error:', e.message);
      res.json({ error: 'Connection error: ' + e.message });
    });
    
    req2.on('timeout', () => {
      req2.destroy();
      res.json({ error: 'Timeout - Pollinations mat qua nhieu thoi gian. Thu lai sau.' });
    });
  }

  fetchImage(url, 0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('AVTalent Groq port ' + PORT));
