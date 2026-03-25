// content.js
// WSJ記事本文の抽出ロジック
// background.js から files: ['content.js'] で注入して使用する

window.__wsjExtract = function () {
  // ─── タイトル取得 ───────────────────────────────────────────────────────────
  const title =
    document.querySelector('h1')?.textContent?.trim() ||
    document.querySelector('[class*="StyledHeadline"]')?.textContent?.trim() ||
    document.querySelector('[class*="headline"]')?.textContent?.trim() ||
    document.querySelector('[data-testid*="headline"]')?.textContent?.trim() ||
    document.title;

  // ─── 本文エリアを特定する ────────────────────────────────────────────────────
  // 優先度順に試すセレクタ（WSJは動的クラス名が多いので data 属性も含める）
  const bodySelectors = [
    '[data-module="ArticleBody"]',
    '[data-testid="article-body"]',
    '[class*="article-body"]',
    '[class*="ArticleBody"]',
    '[class*="article-wrap"]',
    '[class*="articleBody"]',
    '[class*="body-content"]',
    '.article__body',
    'article[class]',
    'article',
    'main[class]',
    'main'
  ];

  let bodyEl = null;
  for (const sel of bodySelectors) {
    const el = document.querySelector(sel);
    // 段落が3つ以上あるものだけ採用
    if (el && el.querySelectorAll('p').length >= 3) {
      bodyEl = el;
      break;
    }
  }

  // セレクタが全滅した場合：ページ内で最も <p> が多い要素を自動検出
  if (!bodyEl) {
    let best = null;
    let bestCount = 0;
    for (const el of document.querySelectorAll('div, section, article, main')) {
      const count = el.querySelectorAll('p').length;
      if (count > bestCount) {
        bestCount = count;
        best = el;
      }
    }
    bodyEl = best || document.body;
  }

  // ─── 段落テキストを抽出 ──────────────────────────────────────────────────────
  // ナビ・フッター・広告などの短い断片を除外して本文らしい段落だけ残す
  const paragraphs = Array.from(bodyEl.querySelectorAll('p'));
  const text = paragraphs
    .map(p => p.textContent.trim())
    .filter(t => t.length > 40)          // 短すぎる行を除外
    .filter(t => !/^(Copyright|©|Subscribe|Sign in)/i.test(t)) // フッター除外
    .join('\n\n');

  // ─── 公開日時を取得 ──────────────────────────────────────────────────────────
  const publishedAt =
    // <meta property="article:published_time">
    document.querySelector('meta[property="article:published_time"]')?.content ||
    document.querySelector('meta[name="article.published"]')?.content ||
    document.querySelector('meta[name="pub_date"]')?.content ||
    // <time datetime="...">
    document.querySelector('time[datetime]')?.getAttribute('datetime') ||
    // data属性やクラス名にtimestampを含む要素
    document.querySelector('[data-testid*="timestamp"]')?.textContent?.trim() ||
    document.querySelector('[class*="timestamp"]')?.textContent?.trim() ||
    document.querySelector('[class*="Timestamp"]')?.textContent?.trim() ||
    '';

  return {
    title,
    text: text.slice(0, 6000),
    publishedAt
  };
};
