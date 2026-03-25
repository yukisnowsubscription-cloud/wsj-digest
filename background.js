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
    // content.js を注入して window.__wsjExtract を定義させる
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window.__wsjExtract ? window.__wsjExtract() : { title: document.title, text: '' })
    });

    return results[0]?.result || { title: '', text: '' };
  } catch (e) {
    return { title: '', text: '' };
  }
}

/** ChatGPT API で要約する */
async function summarize(apiKey, title, text) {
  const prompt =
    `以下の記事を日本語で要約してください。Why it mattersも含めて。\n` +
    `回答は必ず次のJSON形式のみで返してください（余分なテキスト不要）:\n` +
    `{"summary":"要約本文","why_it_matters":"なぜ重要か"}\n\n` +
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
        max_tokens: 800,
        temperature: 0.3
      })
    });

    if (res.status === 429) {
      // レート制限 → 待ってリトライ（5秒, 10秒, 15秒と段階的に）
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
        summary: parsed.summary || raw,
        whyItMatters: parsed.why_it_matters || ''
      };
    }
  } catch (_) {
    // fallthrough
  }
  return { summary: raw, whyItMatters: '' };
}

// ─── メインハンドラ ────────────────────────────────────────────────────────────

chrome.action.onClicked.addListener(async tab => {
  if (!tab.url || !tab.url.includes('wsj.com')) {
    return; // WSJ以外では何もしない
  }

  const { apiKey } = await chrome.storage.local.get('apiKey');

  // セッションIDを生成（複数同時実行を可能にする）
  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // 初期状態をセット（digest.html はこれを読んで「収集中」を表示する）
  await chrome.storage.local.set({
    [`digest_${sessionId}`]: {
      status: 'collecting',
      articles: [],
      total: 0,
      processed: 0,
      startTime: Date.now()
    }
  });

  // ダイジェストページを先に開く（セッションIDをURLパラメータで渡す）
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`digest.html?session=${sessionId}`)
  });

  // ページが storage を読めるよう少し待つ
  await sleep(600);

  // ─── 記事URL収集 ─────────────────────────────────────────────────────────────
  let articleUrls = [];
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // 除外するパス（セクションページ、動画、ポッドキャスト等）
        const excludePaths = [
          '/video/', '/podcasts/', '/livecoverage/', '/live-coverage/',
          '/news/types/', '/news/author/', '/buyside/', '/coupons/',
          '/market-data/', '/graphics/', '/story/'
        ];

        // 記事URLの判定: wsj.com 上で、パスが3セグメント以上あるもの
        // 例: /economy/trade/article-title-hash → 3セグメント = 記事
        //     /economy/ → 1セグメント = セクションページ
        function isArticleUrl(href) {
          try {
            const u = new URL(href);
            if (!u.hostname.includes('wsj.com')) return false;

            const path = u.pathname;

            // 旧形式: /articles/... は常にOK
            if (path.startsWith('/articles/')) return true;

            // 除外パスチェック
            for (const ex of excludePaths) {
              if (path.includes(ex)) return false;
            }

            // 新形式: パスセグメントが3つ以上（/category/sub/slug-hash）
            const segments = path.split('/').filter(Boolean);
            if (segments.length >= 3) return true;

            // 2セグメントでもスラッグが十分長ければ記事
            // 例: /politics/article-title-with-long-slug-a1b2c3d4
            if (segments.length === 2 && segments[1].length > 30) return true;

            return false;
          } catch (_) {
            return false;
          }
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
    articleUrls = results[0]?.result || [];
  } catch (e) {
    console.error('URL収集エラー:', e);
  }

  if (articleUrls.length === 0) {
    await updateState(sessionId, {
      status: 'error',
      error: '記事URLが見つかりませんでした。WSJのトップページで実行してください。'
    });
    return;
  }

  await updateState(sessionId, { status: 'processing', total: articleUrls.length, processed: 0 });

  // ─── 各記事を処理 ─────────────────────────────────────────────────────────────
  const articles = [];

  for (let i = 0; i < articleUrls.length; i++) {
    const url = articleUrls[i];
    await updateState(sessionId, { processed: i });

    let entry = { url, title: url, text: '', summary: '', whyItMatters: '' };

    // バックグラウンドタブで記事を開いて本文取得
    let articleTabId = null;
    try {
      const newTab = await chrome.tabs.create({ url, active: false });
      articleTabId = newTab.id;
      await waitForTabLoad(articleTabId);
      // WSJはReactで動的レンダリングするため、complete後もDOMが更新される
      // 2秒待って確実に本文が描画されるのを待つ
      await sleep(2000);

      let content = await extractArticle(articleTabId);

      // 本文が短すぎる場合は追加で2秒待ってリトライ（遅延レンダリング対策）
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

    // ChatGPT で要約
    if (entry.text && apiKey) {
      try {
        const result = await summarize(apiKey, entry.title, entry.text);
        entry.summary = result.summary;
        entry.whyItMatters = result.whyItMatters;
      } catch (e) {
        entry.summary = `⚠️ 要約エラー: ${e.message}`;
      }
    } else if (!apiKey) {
      entry.summary = '⚠️ APIキーが設定されていません。右クリック → 拡張機能のオプションから設定してください。';
    } else {
      entry.summary = '⚠️ 本文の取得に失敗しました（ペイウォールの可能性があります）。';
    }

    articles.push(entry);
    // 記事を1件追加するたびに即時反映
    await updateState(sessionId, { articles: [...articles], processed: i + 1 });

    // 記事間に1秒の間隔を入れてレート制限を予防
    if (i < articleUrls.length - 1) {
      await sleep(1000);
    }
  }

  await updateState(sessionId, { status: 'done', processed: articleUrls.length });
});
