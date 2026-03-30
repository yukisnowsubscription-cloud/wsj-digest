// background.js - Service Worker

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** タブの読み込み完了を待つ（タイムアウト付き） */
function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 20000);

    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/** storage の digestState を部分更新する（セッションID付き） */
async function updateState(sessionId, patch) {
  const key = `digest_${sessionId}`;
  const data = await chrome.storage.local.get(key);
  const current = data[key] || {};
  await chrome.storage.local.set({ [key]: { ...current, ...patch } });
}

/** 記事本文を抽出する（content.js を注入して呼び出す） */
async function extractArticle(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window.__wsjExtract ? window.__wsjExtract() : { title: document.title, text: '' })
    });
    return results[0]?.result || { title: '', text: '' };
  } catch (e) {
    return { title: '', text: '' };
  }
}

/** NHK 記事本文を抽出する（content_nhk.js を注入して呼び出す） */
async function extractArticleNhk(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content_nhk.js'] });
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window.__nhkExtract ? window.__nhkExtract() : { title: document.title, text: '', publishedAt: '' })
    });
    return results[0]?.result || { title: '', text: '', publishedAt: '' };
  } catch (e) {
    return { title: '', text: '', publishedAt: '' };
  }
}

/** カテゴリ一覧（ChatGPT に渡す選択肢） */
const CATEGORY_LIST = [
  '政治', '経済', '金融・マーケット', '国際情勢', '外交', '安全保障',
  '社会', '災害・事故', '科学・技術', '環境・気候', '医療・健康',
  '労働・雇用', '企業・産業', '司法・犯罪', 'スポーツ', '文化・エンタメ', 'その他'
];

/** ChatGPT API で分析する */
async function summarize(apiKey, title, text) {
  const prompt =
    `以下の記事を分析してください。\n` +
    `要約ではなく、以下を明確にしてください。\n` +
    `- このニュースは結局何の話か\n` +
    `- なぜ今それが起きているのか\n` +
    `- 誰のどういうインセンティブが働いているのか\n` +
    `- 誰が得をして誰が不利になるのか\n` +
    `- 今後どこを見ればよいのか\n\n` +
    `【重要な指示】\n` +
    `- 単なる要約や和訳にしない\n` +
    `- 表面的な説明で終わらせない\n` +
    `- 業界構造、制度変更、プレイヤーの思惑、資金の流れ、競争環境の変化があれば必ず触れる\n` +
    `- 「建前」と「本音」が違う場合は分けて書く\n` +
    `- 記事の内容と、そこから読み取れる分析を混同しない\n` +
    `- 読み手は、情報の圧縮よりも"解像度の高い理解"を求めている\n` +
    `- 中学生でもわかる導入にしつつ、中身は浅くしない\n` +
    `- 重要なニュアンスは落とさない\n` +
    `- 曖昧な場合は「推測だが」と明示する\n\n` +
    `回答は必ず次のJSON形式のみで返してください（余分なテキスト不要）:\n` +
    `{\n` +
    `  "categories": ["カテゴリ1", "カテゴリ2"],\n` +
    `  "one_liner": "① 一言で言うと（1文で本質を突く）",\n` +
    `  "why_it_matters": "② Why it matters（なぜ重要か、2-3文）",\n` +
    `  "key_points": ["③ 要点1", "要点2", "要点3"],\n` +
    `  "essence": "④ 本質（表面的な話の裏にある構造、1-2文）",\n` +
    `  "background": "⑤ 背景・構造（なぜ今これが起きているか）",\n` +
    `  "winners_losers": "⑥ 勝者 / 敗者（誰が得をし、誰が不利か）",\n` +
    `  "watch_next": "⑦ 今後の注目点",\n` +
    `  "comment": "⑧ 一言コメント（読者への示唆）"\n` +
    `}\n\n` +
    `categoriesは次の中から1〜3つ選んでください: ${CATEGORY_LIST.join('、')}\n\n` +
    `記事タイトル: ${title}\n\n記事本文:\n${text}`;

  // 429 (レート制限) の場合は最大3回リトライする
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1500,
        temperature: 0.3
      })
    });

    if (res.status === 429) {
      await sleep((attempt + 1) * 5000);
      continue;
    }
    break;
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err}`);
  }

  const data = await res.json();
  const raw = data.choices[0].message.content.trim();

  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      return {
        categories: parsed.categories || [],
        oneLiner: parsed.one_liner || '',
        whyItMatters: parsed.why_it_matters || '',
        keyPoints: parsed.key_points || [],
        essence: parsed.essence || '',
        background: parsed.background || '',
        winnersLosers: parsed.winners_losers || '',
        watchNext: parsed.watch_next || '',
        comment: parsed.comment || '',
        summary: parsed.one_liner || raw
      };
    }
  } catch (_) {
    // fallthrough
  }
  return { categories: [], oneLiner: '', whyItMatters: '', keyPoints: [], essence: '', background: '', winnersLosers: '', watchNext: '', comment: '', summary: raw };
}

// ─── 共有テキスト生成 ─────────────────────────────────────────────────────────

function buildShareText(articles) {
  const dateStr = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });
  let text = `📰 WSJ Daily Digest\n${dateStr}\n`;
  text += '━'.repeat(20) + '\n\n';
  articles.forEach((a, i) => {
    const cats = (a.categories || []).join(' / ');
    text += `【${i + 1}】${cats ? `[${cats}] ` : ''}${a.title || '(タイトルなし)'}\n`;
    if (a.publishedAt) {
      try {
        const d = new Date(a.publishedAt);
        if (!isNaN(d.getTime())) {
          text += `📅 ${d.toLocaleString('ja-JP', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}\n`;
        }
      } catch (_) {}
    }
    if (a.oneLiner) text += `\n① ${a.oneLiner}\n`;
    if (a.whyItMatters) text += `\n💡 Why it matters\n${a.whyItMatters}\n`;
    if (a.keyPoints && a.keyPoints.length > 0) {
      text += `\n③ 要点\n`;
      a.keyPoints.forEach(p => { text += `・${p}\n`; });
    }
    if (a.essence) text += `\n④ 本質\n${a.essence}\n`;
    if (a.winnersLosers) text += `\n⑥ 勝者/敗者\n${a.winnersLosers}\n`;
    if (a.watchNext) text += `\n⑦ 注目点\n${a.watchNext}\n`;
    text += `\n🔗 ${a.url}\n`;
    text += '\n' + '─'.repeat(20) + '\n\n';
  });
  return text;
}

/** LINE Notify API で送信 */
async function sendToLine(token, text) {
  const res = await fetch('https://notify-api.line.me/api/notify', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'message=' + encodeURIComponent(text)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LINE Notify ${res.status}: ${err}`);
  }
}

/** Slack Block Kit ペイロードを生成 */
function buildSlackPayload(articles) {
  const dateStr = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '📰 WSJ Daily Digest', emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `${dateStr}　全 ${articles.length} 件` }] },
    { type: 'divider' }
  ];
  articles.forEach((a, i) => {
    let dateTag = '';
    if (a.publishedAt) {
      try {
        const d = new Date(a.publishedAt);
        if (!isNaN(d.getTime())) {
          dateTag = d.toLocaleString('ja-JP', {
            timeZone: 'Asia/Tokyo',
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
          }) + ' JST';
        }
      } catch (_) {}
    }
    const cats = (a.categories || []).map(c => `\`${c}\``).join(' ');
    const titleLine = `*${i + 1}. <${a.url}|${a.title || '(タイトルなし)'}>*${dateTag ? `　🕐 ${dateTag}` : ''}`;
    let body = cats ? cats + '\n' : '';
    if (a.oneLiner) body += `① ${a.oneLiner}\n`;
    if (a.whyItMatters) body += `\n💡 *Why it matters*\n${a.whyItMatters}\n`;
    if (a.keyPoints && a.keyPoints.length > 0) {
      body += `\n*③ 要点*\n`;
      a.keyPoints.forEach(p => { body += `• ${p}\n`; });
    }
    if (a.winnersLosers) body += `\n*⑥ 勝者/敗者*\n${a.winnersLosers}\n`;
    if (a.watchNext) body += `\n*⑦ 注目点*\n${a.watchNext}`;
    if (body.length > 2800) body = body.slice(0, 2800) + '…';
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${titleLine}\n${body}` }
    });
    blocks.push({ type: 'divider' });
  });
  return { blocks };
}

/** Slack Incoming Webhook で送信（任意ペイロード） */
async function sendSlackPayload(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Slack webhook ${res.status}`);
}

/** Slack Incoming Webhook で送信（Block Kit） */
async function sendToSlack(webhookUrl, articles) {
  await sendSlackPayload(webhookUrl, buildSlackPayload(articles));
}

// ─── NHK RSS 取得・送信 ───────────────────────────────────────────────────────

/** NHK トップニュース RSS を取得してパース */
async function fetchNhkArticles(maxItems = 10) {
  const res = await fetch('https://www3.nhk.or.jp/rss/news/cat0.xml');
  if (!res.ok) throw new Error(`NHK RSS ${res.status}`);
  const text = await res.text();

  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(text)) !== null && items.length < maxItems) {
    const block = m[1];
    const get = (tag) => {
      const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
      const match = r.exec(block);
      return match ? match[1].trim() : '';
    };
    items.push({
      title: get('title'),
      description: get('description'),
      url: get('link'),
      publishedAt: get('pubDate')
    });
  }
  return items;
}

/** NHK 用 Slack Block Kit ペイロードを生成 */
function buildNhkSlackPayload(articles) {
  const dateStr = new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    hour: '2-digit', minute: '2-digit'
  });
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '📺 NHK ニュース速報', emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `${dateStr} JST　全 ${articles.length} 件` }] },
    { type: 'divider' }
  ];
  articles.forEach((a, i) => {
    let dateTag = '';
    if (a.publishedAt) {
      try {
        const d = new Date(a.publishedAt);
        if (!isNaN(d.getTime())) {
          dateTag = d.toLocaleString('ja-JP', {
            timeZone: 'Asia/Tokyo',
            month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
          }) + ' JST';
        }
      } catch (_) {}
    }
    const titleLine = `*${i + 1}. <${a.url}|${a.title || '(タイトルなし)'}>*${dateTag ? `　🕐 ${dateTag}` : ''}`;
    let body = a.description || '';
    if (body.length > 2800) body = body.slice(0, 2800) + '…';
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${titleLine}\n${body}` }
    });
    blocks.push({ type: 'divider' });
  });
  return { blocks };
}

// ─── NHK ダイジェスト本体ロジック ────────────────────────────────────────────

async function collectNhkArticleUrls(tabId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2000);
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          function isArticleUrl(href) {
            try {
              const u = new URL(href);
              const host = u.hostname;
              const path = u.pathname;
              if (host.indexOf('nhk') < 0) return false;
              if (/\/newsweb\/na\/na-/.test(path)) return true;
              if (/\/news\/html\/\d{8}\//.test(path)) return true;
              return false;
            } catch (_) { return false; }
          }
          const seen = new Set();
          const urls = [];
          for (const a of document.querySelectorAll('a[href]')) {
            const url = a.href.split('?')[0];
            if (!seen.has(url) && isArticleUrl(url)) {
              seen.add(url);
              urls.push(url);
            }
            if (urls.length >= 20) break;
          }
          return urls;
        }
      });
      const urls = results[0]?.result || [];
      if (urls.length > 0) return urls;
    } catch (e) { console.error('NHK URL収集エラー:', e); }
  }
  return [];
}

async function runNhkDigest(nhkTabId, sessionId, apiKey, presetUrls = null) {
  let articleUrls = presetUrls || await collectNhkArticleUrls(nhkTabId);

  // 既読記事を除外
  const { readArticles } = await chrome.storage.local.get('readArticles');
  const readSet = new Set((readArticles || []).map(a => a.url));
  const skipped = articleUrls.filter(url => readSet.has(url)).length;
  articleUrls = articleUrls.filter(url => !readSet.has(url));

  if (articleUrls.length === 0) {
    await updateState(sessionId, {
      status: 'error',
      error: skipped > 0
        ? `${skipped} 件の記事が見つかりましたが、すべて既読です。既読記事を管理ページからクリアしてください。`
        : '記事URLが見つかりませんでした。NHKニュースのトップページで実行してください。'
    });
    return [];
  }

  await updateState(sessionId, { status: 'processing', total: articleUrls.length, processed: 0, skipped });

  const articles = [];
  for (let i = 0; i < articleUrls.length; i++) {
    const url = articleUrls[i];
    await updateState(sessionId, { processed: i });

    let entry = { url, title: url, text: '', summary: '', whyItMatters: '', publishedAt: '', categories: [], oneLiner: '', keyPoints: [], essence: '', background: '', winnersLosers: '', watchNext: '', comment: '' };
    let articleTabId = null;
    // タブ操作エラー（ドラッグ中など）は最大3回リトライ
    for (let tabAttempt = 0; tabAttempt < 3; tabAttempt++) {
      if (tabAttempt > 0) await sleep(2000);
      try {
        const newTab = await chrome.tabs.create({ url, active: false });
        articleTabId = newTab.id;
        await waitForTabLoad(articleTabId);
        await sleep(3000);
        let content = await extractArticleNhk(articleTabId);
        // Next.js/RSC のハイドレーション完了を待ちながら最大2回リトライ
        for (let retry = 0; retry < 2 && (!content.text || content.text.length < 100); retry++) {
          await sleep(3000);
          content = await extractArticleNhk(articleTabId);
        }
        entry.title = content.title || url;
        entry.text = content.text || '';
        entry.publishedAt = content.publishedAt || '';
        break; // 成功したらループを抜ける
      } catch (e) {
        const isTabBusy = e.message && e.message.includes('Tabs cannot be edited');
        console.error(`NHK記事読み込みエラー (attempt ${tabAttempt + 1}):`, url, e);
        if (!isTabBusy || tabAttempt === 2) break;
      } finally {
        if (articleTabId !== null) {
          try { await chrome.tabs.remove(articleTabId); } catch (_) {}
          articleTabId = null;
        }
      }
    }

    if (entry.text && apiKey) {
      try {
        const result = await summarize(apiKey, entry.title, entry.text);
        Object.assign(entry, result);
      } catch (e) {
        entry.summary = `⚠️ 要約エラー: ${e.message}`;
      }
    } else if (!apiKey) {
      entry.summary = '⚠️ APIキーが設定されていません。';
    } else {
      entry.summary = '⚠️ 本文の取得に失敗しました。';
    }

    articles.push(entry);
    await updateState(sessionId, { articles: [...articles], processed: i + 1 });
    if (i < articleUrls.length - 1) await sleep(1000);
  }

  await updateState(sessionId, { status: 'done', processed: articleUrls.length });
  return articles;
}

// ─── 記事URL収集（タブから）────────────────────────────────────────────────────

async function collectArticleUrls(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const excludePaths = [
        '/video/', '/podcasts/', '/livecoverage/', '/live-coverage/',
        '/news/types/', '/news/author/', '/buyside/', '/coupons/',
        '/market-data/', '/graphics/', '/story/'
      ];
      function isArticleUrl(href) {
        try {
          const u = new URL(href);
          if (!u.hostname.includes('wsj.com')) return false;
          const path = u.pathname;
          if (path.startsWith('/articles/')) return true;
          for (const ex of excludePaths) {
            if (path.includes(ex)) return false;
          }
          const segments = path.split('/').filter(Boolean);
          if (segments.length >= 3) return true;
          if (segments.length === 2 && segments[1].length > 30) return true;
          return false;
        } catch (_) { return false; }
      }
      const seen = new Set();
      const urls = [];
      for (const a of document.querySelectorAll('a[href]')) {
        const url = a.href.split('?')[0];
        if (!seen.has(url) && isArticleUrl(url)) {
          seen.add(url);
          urls.push(url);
        }
        if (urls.length >= 20) break;
      }
      return urls;
    }
  });
  return results[0]?.result || [];
}

// ─── ダイジェスト本体ロジック ─────────────────────────────────────────────────

async function runDigest(wsjTabId, sessionId, apiKey, presetUrls = null) {
  let articleUrls = [];
  if (presetUrls) {
    articleUrls = presetUrls;
  } else {
    try {
      articleUrls = await collectArticleUrls(wsjTabId);
    } catch (e) {
      console.error('URL収集エラー:', e);
    }
  }

  // 既読記事を除外
  const { readArticles } = await chrome.storage.local.get('readArticles');
  const readSet = new Set((readArticles || []).map(a => a.url));
  const skipped = articleUrls.filter(url => readSet.has(url)).length;
  articleUrls = articleUrls.filter(url => !readSet.has(url));

  if (articleUrls.length === 0) {
    await updateState(sessionId, {
      status: 'error',
      error: skipped > 0
        ? `${skipped} 件の記事が見つかりましたが、すべて既読です。既読記事を管理ページからクリアしてください。`
        : '記事URLが見つかりませんでした。WSJのトップページで実行してください。'
    });
    return [];
  }

  await updateState(sessionId, { status: 'processing', total: articleUrls.length, processed: 0, skipped });

  const articles = [];
  for (let i = 0; i < articleUrls.length; i++) {
    const url = articleUrls[i];
    await updateState(sessionId, { processed: i });

    let entry = { url, title: url, text: '', summary: '', whyItMatters: '', publishedAt: '', categories: [], oneLiner: '', keyPoints: [], essence: '', background: '', winnersLosers: '', watchNext: '', comment: '' };
    let articleTabId = null;
    try {
      const newTab = await chrome.tabs.create({ url, active: false });
      articleTabId = newTab.id;
      await waitForTabLoad(articleTabId);
      await sleep(2000);
      let content = await extractArticle(articleTabId);
      if (!content.text || content.text.length < 200) {
        await sleep(2000);
        content = await extractArticle(articleTabId);
      }
      entry.title = content.title || url;
      entry.text = content.text || '';
      entry.publishedAt = content.publishedAt || '';
    } catch (e) {
      console.error('記事読み込みエラー:', url, e);
    } finally {
      if (articleTabId !== null) {
        try { await chrome.tabs.remove(articleTabId); } catch (_) {}
      }
    }

    if (entry.text && apiKey) {
      try {
        const result = await summarize(apiKey, entry.title, entry.text);
        Object.assign(entry, result);
      } catch (e) {
        entry.summary = `⚠️ 要約エラー: ${e.message}`;
      }
    } else if (!apiKey) {
      entry.summary = '⚠️ APIキーが設定されていません。';
    } else {
      entry.summary = '⚠️ 本文の取得に失敗しました（ペイウォールの可能性があります）。';
    }

    articles.push(entry);
    await updateState(sessionId, { articles: [...articles], processed: i + 1 });
    if (i < articleUrls.length - 1) await sleep(1000);
  }

  await updateState(sessionId, { status: 'done', processed: articleUrls.length });
  return articles;
}

// ─── アラーム管理 ─────────────────────────────────────────────────────────────

function setupAlarm(enabled, timeStr) {
  chrome.alarms.clear('wsj-auto-digest');
  if (!enabled || !timeStr) return;

  const [hh, mm] = timeStr.split(':').map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(hh, mm, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  chrome.alarms.create('wsj-auto-digest', {
    when: next.getTime(),
    periodInMinutes: 24 * 60
  });
  console.log(`[WSJ Digest] アラーム設定: ${next.toLocaleString('ja-JP')}`);
}

// オプション画面からの設定更新を受け取る
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'updateAlarm') {
    setupAlarm(msg.autoSendEnabled, msg.autoSendTime);
  } else if (msg.type === 'testNhkSlack') {
    (async () => {
      try {
        const articles = await fetchNhkArticles(5);
        if (articles.length === 0) throw new Error('NHK記事が取得できませんでした');
        await sendSlackPayload(msg.webhookUrl, buildNhkSlackPayload(articles));
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true; // 非同期レスポンス
  }
});

// 起動時にアラームを復元
chrome.storage.local.get(['autoSendEnabled', 'autoSendTime'], ({ autoSendEnabled, autoSendTime }) => {
  if (autoSendEnabled && autoSendTime) setupAlarm(true, autoSendTime);
});

// ─── アラームイベント（自動送信）─────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'wsj-auto-digest') return;

  const { apiKey, autoSendEnabled, lineToken, slackWebhook } =
    await chrome.storage.local.get(['apiKey', 'autoSendEnabled', 'lineToken', 'slackWebhook']);

  if (!autoSendEnabled) return;

  console.log('[WSJ Digest] 自動送信開始');

  // WSJ トップを開く（バックグラウンド）
  let wsjTab;
  try {
    wsjTab = await chrome.tabs.create({ url: 'https://jp.wsj.com/', active: false });
    await waitForTabLoad(wsjTab.id);
    await sleep(3000);
  } catch (e) {
    console.error('[WSJ Digest] WSJページ読み込みエラー:', e);
    return;
  }

  const sessionId = 'auto_' + Date.now().toString(36);
  await chrome.storage.local.set({
    [`digest_${sessionId}`]: {
      status: 'collecting', articles: [], total: 0, processed: 0, startTime: Date.now()
    }
  });

  let articles = [];
  try {
    articles = await runDigest(wsjTab.id, sessionId, apiKey);
  } finally {
    try { await chrome.tabs.remove(wsjTab.id); } catch (_) {}
  }

  if (articles.length === 0) return;

  const errors = [];

  if (lineToken) {
    const text = buildShareText(articles);
    try { await sendToLine(lineToken, text); }
    catch (e) { errors.push('LINE: ' + e.message); }
  }
  if (slackWebhook) {
    try { await sendToSlack(slackWebhook, articles); }
    catch (e) { errors.push('Slack(WSJ): ' + e.message); }

    // NHK ニュースも送信
    try {
      const nhkArticles = await fetchNhkArticles(10);
      if (nhkArticles.length > 0) {
        await sendSlackPayload(slackWebhook, buildNhkSlackPayload(nhkArticles));
      }
    } catch (e) { errors.push('Slack(NHK): ' + e.message); }
  }

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'WSJ Daily Digest',
    message: errors.length > 0
      ? `送信エラー: ${errors.join(', ')}`
      : `${articles.length}件の記事を送信しました`
  });
});

// ─── 拡張アイコンクリック ─────────────────────────────────────────────────────

// 現在のURLが WSJ 個別記事かどうか判定
function isSingleWsjArticle(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('wsj.com')) return false;
    const path = u.pathname;
    if (path.startsWith('/articles/')) return true;
    const excludePaths = ['/video/', '/podcasts/', '/livecoverage/', '/live-coverage/',
      '/news/types/', '/news/author/', '/buyside/', '/coupons/', '/market-data/', '/graphics/', '/story/'];
    for (const ex of excludePaths) { if (path.includes(ex)) return false; }
    const segments = path.split('/').filter(Boolean);
    if (segments.length >= 3) return true;
    if (segments.length === 2 && segments[1].length > 30) return true;
    return false;
  } catch (_) { return false; }
}

// 現在のURLが NHK 個別記事かどうか判定
function isSingleNhkArticle(url) {
  try {
    const u = new URL(url);
    const path = u.pathname;
    if (/\/newsweb\/na\/na-/.test(path)) return true;
    if (/\/news\/html\/\d{8}\//.test(path)) return true;
    return false;
  } catch (_) { return false; }
}

chrome.action.onClicked.addListener(async tab => {
  const url = tab.url || '';
  const isWsj = url.includes('wsj.com');
  const isNhk = url.includes('nhk.or.jp') || url.includes('.nhk/') || url.includes('nhk/newsweb');

  if (!isWsj && !isNhk) return;

  const { apiKey } = await chrome.storage.local.get('apiKey');
  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  await chrome.storage.local.set({
    [`digest_${sessionId}`]: {
      status: 'collecting', articles: [], total: 0, processed: 0, startTime: Date.now()
    }
  });

  const digestPage = isNhk ? 'digest_nhk.html' : 'digest.html';
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`${digestPage}?session=${sessionId}`)
  });

  await sleep(600);

  if (isNhk) {
    // 個別記事ページなら1件だけ処理
    const singleUrl = isSingleNhkArticle(url) ? [url.split('?')[0]] : null;
    await runNhkDigest(tab.id, sessionId, apiKey, singleUrl);
  } else {
    // 個別記事ページなら1件だけ処理
    const singleUrl = isSingleWsjArticle(url) ? [url.split('?')[0]] : null;
    await runDigest(tab.id, sessionId, apiKey, singleUrl);
  }
});
