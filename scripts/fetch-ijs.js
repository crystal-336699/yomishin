const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

function fetchUrl(url, maxRedirects=5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,ja;q=0.8',
        'Accept-Encoding': 'identity',
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchUrl(next, maxRedirects-1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function clean(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

function parseList(html) {
  const articles = [];
  const rowRx = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const linkRx = /href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
  const tagRx = /<[^>]+>/g;
  let rowM;
  while ((rowM = rowRx.exec(html)) !== null) {
    const rh = rowM[1];
    const cells = [];
    let cm; cellRx.lastIndex = 0;
    while ((cm = cellRx.exec(rh)) !== null) cells.push(cm[1].trim());
    if (cells.length >= 4) {
      const no = parseInt(cells[0].replace(tagRx,'').trim());
      if (isNaN(no) || no <= 0) continue;
      const type = cells[1].replace(tagRx,'').trim();
      const newspaper = cells[2].replace(tagRx,'').trim();
      const lm = linkRx.exec(cells[3]);
      if (!lm) continue;
      const link = lm[1].trim();
      const title = lm[2].replace(tagRx,'').trim();
      const date = cells[4] ? cells[4].replace(tagRx,'').trim() : '';
      if (title && link) articles.push({ no, type, newspaper, title, link, date, body:'' });
    }
  }
  return articles;
}

function extractBody(html) {
  // 본문 div 후보들 시도
  const selectors = [
    /class="[^"]*article[-_]body[^"]*"[^>]*>([\s\S]{200,5000}?)<\/(div|section)/i,
    /class="[^"]*articleBody[^"]*"[^>]*>([\s\S]{200,5000}?)<\/(div|section)/i,
    /id="article[-_]?body[^"]*"[^>]*>([\s\S]{200,5000}?)<\/(div|section)/i,
    /class="[^"]*main[-_]text[^"]*"[^>]*>([\s\S]{200,5000}?)<\/(div|section)/i,
    /class="[^"]*news[-_]text[^"]*"[^>]*>([\s\S]{200,5000}?)<\/(div|section)/i,
  ];
  for (const sel of selectors) {
    const m = html.match(sel);
    if (m && m[1]) {
      const t = clean(m[1]);
      if (t.length > 150) return t.slice(0, 2000);
    }
  }
  // fallback: <p> 태그 수집
  const paras = [];
  const pRx = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pm;
  while ((pm = pRx.exec(html)) !== null) {
    const t = clean(pm[1]).trim();
    if (t.length > 40 && !/cookie|javascript|ログイン|会員登録|購読|Copyright/i.test(t))
      paras.push(t);
  }
  return paras.slice(0, 8).join('\n\n').slice(0, 2000);
}

async function main() {
  console.log('IJS 스크래핑 시작...');
  const baseUrl = 'https://ijs.snu.ac.kr/social_contributions/real_time_japan_news/news';
  const allArticles = [];

  for (let page = 1; page <= 3; page++) {
    const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`;
    console.log(`목록 p${page}...`);
    try {
      const html = await fetchUrl(url);
      const arts = parseList(html);
      console.log(`  → ${arts.length}개`);
      if (arts.length === 0) break;
      allArticles.push(...arts);
      await new Promise(r => setTimeout(r, 800));
    } catch(e) { console.error(` 오류: ${e.message}`); break; }
  }

  const seen = new Set();
  const unique = allArticles.filter(a => { if(seen.has(a.no)) return false; seen.add(a.no); return true; });
  console.log(`\n${unique.length}개 수집. 본문 수집 시작...`);

  // 최신 30개 본문 수집
  for (let i = 0; i < Math.min(30, unique.length); i++) {
    const a = unique[i];
    process.stdout.write(`[${i+1}] ${a.newspaper} ${a.title.slice(0,25)}... `);
    try {
      const html = await fetchUrl(a.link);
      a.body = extractBody(html);
      console.log(`${a.body.length}자`);
    } catch(e) { console.log(`실패(${e.message})`); a.body = ''; }
    await new Promise(r => setTimeout(r, 600));
  }

  if (unique.length === 0) { console.error('기사 없음'); process.exit(1); }

  const out = path.join(__dirname, '../docs/ijs-data.json');
  fs.writeFileSync(out, JSON.stringify({ updated: new Date().toISOString(), count: unique.length, articles: unique }, null, 2), 'utf8');
  console.log(`\n저장 완료: ${unique.length}개`);
}

main().catch(e => { console.error(e); process.exit(1); });
