const https = require('https');
const fs = require('fs');
const path = require('path');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; yomishin-bot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9,ja;q=0.8',
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
}

function parseArticles(html) {
  const articles = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const linkRegex = /href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
  const tagRegex = /<[^>]+>/g;

  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    const cells = [];
    let cellMatch;
    cellRegex.lastIndex = 0;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1].trim());
    }
    if (cells.length >= 4) {
      const no = parseInt(cells[0].replace(tagRegex, '').trim());
      if (isNaN(no) || no <= 0) continue;
      const type = cells[1].replace(tagRegex, '').trim();
      const newspaper = cells[2].replace(tagRegex, '').trim();
      const linkMatch = linkRegex.exec(cells[3]);
      if (!linkMatch) continue;
      const link = linkMatch[1].trim();
      const title = linkMatch[2].replace(tagRegex, '').trim();
      const date = cells[4] ? cells[4].replace(tagRegex, '').trim() : '';
      if (title && link) {
        articles.push({ no, type, newspaper, title, link, date });
      }
    }
  }
  return articles;
}

async function main() {
  console.log('IJS 스크래핑 시작...');
  const baseUrl = 'https://ijs.snu.ac.kr/social_contributions/real_time_japan_news/news';
  const allArticles = [];

  for (let page = 1; page <= 3; page++) {
    const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`;
    console.log(`페이지 ${page}: ${url}`);
    try {
      const html = await fetchUrl(url);
      const articles = parseArticles(html);
      console.log(`  → ${articles.length}개 파싱`);
      if (articles.length === 0) break;
      allArticles.push(...articles);
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`  페이지 ${page} 오류:`, err.message);
      break;
    }
  }

  const seen = new Set();
  const unique = allArticles.filter(a => {
    if (seen.has(a.no)) return false;
    seen.add(a.no);
    return true;
  });

  console.log(`총 ${unique.length}개 수집`);
  if (unique.length === 0) {
    console.error('기사 없음');
    process.exit(1);
  }

  const out = path.join(__dirname, '../docs/ijs-data.json');
  fs.writeFileSync(out, JSON.stringify({
    updated: new Date().toISOString(),
    count: unique.length,
    articles: unique,
  }, null, 2), 'utf8');

  console.log('저장 완료:', out);
}

main().catch(e => { console.error(e); process.exit(1); });

