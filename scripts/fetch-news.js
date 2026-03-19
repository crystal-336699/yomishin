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
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
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
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
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

  const prompt = `今日(${date})の日本のニュースを https://news.web.nhk/newsweb/pl/news-nwa-latest-nationwide と https://news.livedoor.com/topics/rss/top.xml から20件以上収集し、以下のJSON配列のみ返してください。他テキスト不要。

[{"id":1,"src":"nhk","cat":"politics","date":"${date}","title":"タイトル","url":"URL","body":"本文3〜5段落（空行区切り）"}]

catは politics/economy/society/international/sports/science のいずれか。bodyは実際の記事内容、200字以上。`;

  let messages = [{ role: 'user', content: prompt }];
  let finalText = '';
  let rounds = 0;

  while (rounds < 6) {
    rounds++;
    const data = await callClaude(messages);
    messages.push({ role: 'assistant', content: data.content });

    if (data.stop_reason === 'end_turn') {
      const tb = data.content.find(b => b.type === 'text');
      if (tb) { finalText = tb.text; break; }
    } else if (data.stop_reason === 'tool_use') {
      const toolUses = data.content.filter(b => b.type === 'tool_use');
      const toolResults = toolUses.map(tu => ({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: '検索結果を元にJSON配列を作成してください。'
      }));
      messages.push({ role: 'user', content: toolResults });
    } else {
      const tb = data.content.find(b => b.type === 'text');
      if (tb) { finalText = tb.text; break; }
      break;
    }
  }

  const s = finalText.indexOf('[');
  const e = finalText.lastIndexOf(']');
  if (s === -1) { console.error('JSON not found'); process.exit(1); }

  const articles = JSON.parse(finalText.slice(s, e + 1))
    .filter(a => a.title && a.body && a.body.length > 50)
    .map((a, i) => ({ ...a, id: i + 1 }));

  console.log(`${articles.length}개 기사 수집 완료`);

  const out = path.join(__dirname, '../docs/articles.json');
  fs.writeFileSync(out, JSON.stringify({
    updated: new Date().toISOString(),
    date,
    count: articles.length,
    articles
  }, null, 2), 'utf8');

  console.log('docs/articles.json 저장 완료');
}

main().catch(e => { console.error(e); process.exit(1); });
