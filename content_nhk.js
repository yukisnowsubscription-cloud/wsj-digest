// content.js
// NHKニュース記事本文の抽出ロジック
// 新ドメイン (news.web.nhk — Next.js/RSC) と旧ドメイン (www3.nhk.or.jp) の両方に対応

window.__nhkExtract = function () {

  // ─── JSON-LD からメタデータを取得（新ドメインで有効） ────────────────────────
  let jsonLd = null;
  for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(el.textContent);
      if (data['@type'] === 'NewsArticle' || data['@type'] === 'Article') {
        jsonLd = data;
        break;
      }
    } catch (_) {}
  }

  // ─── タイトル取得 ───────────────────────────────────────────────────────────
  // JSON-LDの headline は {"@value": "...", "@language": "ja"} 形式の場合がある
  const ldHeadline = jsonLd?.headline;
  const headlineText = typeof ldHeadline === 'string' ? ldHeadline
    : (ldHeadline?.['@value'] || null);

  const title =
    headlineText ||
    document.querySelector('h1')?.textContent?.trim() ||
    document.querySelector('[class*="title"]')?.textContent?.trim() ||
    document.querySelector('.content--detail-title')?.textContent?.trim() ||
    document.querySelector('#news_title')?.textContent?.trim() ||
    document.title;

  // ─── 本文エリアを特定する ────────────────────────────────────────────────────
  // 新ドメイン (Next.js) ではCSS Modulesのハッシュ化クラス名のため
  // セマンティックタグとp要素の数で判定する
  const bodySelectors = [
    'article',
    '[role="article"]',
    'main article',
    '.content--detail-body',
    '#news_textbody',
    '.body-text',
    '.article-body',
    'main',
    '[class*="detail"]',
    '[class*="article"]'
  ];

  let bodyEl = null;
  for (const sel of bodySelectors) {
    const el = document.querySelector(sel);
    if (el && el.querySelectorAll('p').length >= 2) {
      bodyEl = el;
      break;
    }
  }

  // フォールバック：最も <p> が多い要素を自動検出
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
  const paragraphs = Array.from(bodyEl.querySelectorAll('p'));
  const text = paragraphs
    .map(p => p.textContent.trim())
    .filter(t => t.length > 20)
    .filter(t => !/^(Copyright|©|NHKサイト|このページ|NHKについて|受信料)/i.test(t))
    .join('\n\n');

  // ─── 公開日時を取得 ──────────────────────────────────────────────────────────
  const publishedAt =
    jsonLd?.datePublished ||
    document.querySelector('meta[property="article:published_time"]')?.content ||
    document.querySelector('meta[name="pub_date"]')?.content ||
    document.querySelector('time[datetime]')?.getAttribute('datetime') ||
    document.querySelector('.content--detail-date')?.textContent?.trim() ||
    document.querySelector('#news_date')?.textContent?.trim() ||
    document.querySelector('[class*="date"]')?.textContent?.trim() ||
    '';

  return {
    title,
    text: text.slice(0, 6000),
    publishedAt
  };
};
