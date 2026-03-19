const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }

async function callClaude(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages,
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function today() {
  return new Date().toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-');
}

async function main() {
  const date = today();
  console.log('뉴스 업데이트 시작:', date);

  const prompt = `今日(${date})の日本の主要ニュースを20件、以下のJSON配列形式のみで返してください。他のテキストは一切不要です。

[
  {
    "id": 1,
    "src": "nhk",
    "cat": "politics",
    "date": "${date}",
    "title": "記事タイトル",
    "url": "https://...",
    "body": "本文段落1\\n\\n本文段落2\\n\\n本文段落3"
  }
]

ルール:
- srcは nhk/livedoor/jiji/kyodo のいずれか
- catは politics/economy/society/international/sports/science のいずれか  
- bodyは実際のニュース内容を3段落以上、各200字以上
- 今日の実際のニュースを使用すること
- JSON配列のみ返すこと（\`\`\`や説明文不要）`;

  const data = await callClaude([{ role: 'user', content: prompt }]);

  console.log('API 응답 stop_reason:', data.stop_reason);

  if (!data.content || !data.content.length) {
    console.error('API 응답 오류:', JSON.stringify(data));
    process.exit(1);
  }

  const tb = data.content.find(b => b.type === 'text');
  if (!tb) {
    console.error('텍스트 응답 없음:', JSON.stringify(data.content));
    process.exit(1);
  }

  const raw = tb.text.trim();
  console.log('응답 첫 100자:', raw.slice(0, 100));

  const s = raw.indexOf('[');
  const e = raw.lastIndexOf(']');
  if (s === -1) {
    console.error('JSON 배열 없음. 전체 응답:', raw.slice(0, 500));
    process.exit(1);
  }

  const articles = JSON.parse(raw.slice(s, e + 1))
    .filter(a => a.title && a.body && a.body.length > 30)
    .map((a, i) => ({ ...a, id: i + 1 }));

  console.log(`${articles.length}개 기사 수집 완료`);

  const out = path.join(__dirname, '../docs/articles.json');
  fs.writeFileSync(out, JSON.stringify({
    updated: new Date().toISOString(),
    date,
    count: articles.length,
    articles
  }, null, 2), 'utf8');

  console.log('저장 완료:', out);
}

main().catch(e => { console.error('오류:', e); process.exit(1); });
