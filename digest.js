// digest.js

// 日付表示
document.getElementById('date-label').textContent = new Date().toLocaleDateString('ja-JP', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
});

// オプションページリンク
document.getElementById('options-link').addEventListener('click', e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// ─── 状態管理 ────────────────────────────────────────────────────────────────

let renderedCount = 0; // 既にカードを追加済みの件数

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2br(str) {
  return esc(str).replace(/\n/g, '<br>');
}

// ─── UI 更新 ─────────────────────────────────────────────────────────────────

function applyState(state) {
  if (!state) return;

  const progressWrap = document.getElementById('progress-wrap');
  const spinner      = document.getElementById('spinner');
  const statusText   = document.getElementById('status-text');
  const fillBar      = document.getElementById('progress-bar-fill');
  const countText    = document.getElementById('count-text');
  const errorBox     = document.getElementById('error-box');
  const doneBanner   = document.getElementById('done-banner');

  const { status, total, processed, articles, error } = state;

  // ─ 進捗バー
  if (status === 'collecting') {
    statusText.textContent = '記事URLを収集中...';
    fillBar.style.width = '0%';
    countText.textContent = '';
  } else if (status === 'processing') {
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
    statusText.textContent = `処理中... (${processed}/${total})`;
    fillBar.style.width = pct + '%';
    countText.textContent = pct + '%';
  } else if (status === 'done') {
    spinner.style.display = 'none';
    statusText.textContent = `完了 — ${(articles || []).length} 件処理しました`;
    fillBar.style.width = '100%';
    countText.textContent = '100%';

    doneBanner.style.display = 'block';
    document.getElementById('done-inner').textContent =
      `✅ ${(articles || []).length} 件の記事をすべて処理しました。`;
    document.getElementById('share-wrap').style.display = 'block';
  } else if (status === 'error') {
    spinner.style.display = 'none';
    statusText.textContent = 'エラーが発生しました';
    errorBox.style.display = 'block';
    errorBox.textContent = '❌ ' + (error || '不明なエラー');
  }

  // ─ 記事カードを増分追加（既存カードは再描画しない）
  if (articles && articles.length > renderedCount) {
    const container = document.getElementById('articles');
    for (let i = renderedCount; i < articles.length; i++) {
      container.appendChild(buildCard(articles[i], i));
    }
    renderedCount = articles.length;
  }
}

// ─── 記事カード生成 ───────────────────────────────────────────────────────────

function buildCard(article, index) {
  const card = document.createElement('div');
  card.className = 'article-card';
  card.id = `card-${index}`;

  // 公開日時
  if (article.publishedAt) {
    const dateDiv = document.createElement('div');
    dateDiv.className = 'article-date';
    // 日本時間（JST）に変換して表示
    try {
      const d = new Date(article.publishedAt);
      if (!isNaN(d.getTime())) {
        dateDiv.textContent = d.toLocaleString('ja-JP', {
          year: 'numeric', month: 'long', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
          timeZone: 'Asia/Tokyo'
        }) + '（日本時間）';
      } else {
        dateDiv.textContent = article.publishedAt;
      }
    } catch (_) {
      dateDiv.textContent = article.publishedAt;
    }
    card.appendChild(dateDiv);
  }

  // タイトル
  const h2 = document.createElement('h2');
  const a = document.createElement('a');
  a.href = article.url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = article.title || article.url;
  h2.appendChild(a);
  card.appendChild(h2);

  // 要約
  const summaryDiv = document.createElement('div');
  summaryDiv.className = 'summary';
  summaryDiv.innerHTML = nl2br(article.summary || '');
  card.appendChild(summaryDiv);

  // Why it matters
  if (article.whyItMatters) {
    const whyBox = document.createElement('div');
    whyBox.className = 'why-box';
    whyBox.innerHTML =
      `<div class="why-label">💡 Why it matters</div>` +
      `<p>${nl2br(article.whyItMatters)}</p>`;
    card.appendChild(whyBox);
  }

  // フッター（深掘りボタン）
  const footer = document.createElement('div');
  footer.className = 'card-footer';

  const btn = document.createElement('button');
  btn.className = 'btn-deep-dive';
  btn.textContent = '🔍 深掘りする';
  btn.addEventListener('click', () => deepDive(index, article, btn, card));
  footer.appendChild(btn);
  card.appendChild(footer);

  // 深掘り結果プレースホルダー
  const deepDiv = document.createElement('div');
  deepDiv.id = `deep-${index}`;
  card.appendChild(deepDiv);

  return card;
}

// ─── 深掘り ───────────────────────────────────────────────────────────────────

async function deepDive(index, article, btn, card) {
  btn.disabled = true;
  btn.textContent = '分析中...';

  const deepDiv = document.getElementById(`deep-${index}`);
  deepDiv.innerHTML = `
    <div class="loading-inline">
      <div class="spinner"></div>
      詳細分析中... しばらくお待ちください
    </div>`;

  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) {
    deepDiv.innerHTML = `<div class="deep-dive-result" style="background:#fff3f3;border-color:#f5c6c6">
      <p style="color:#c0392b">⚠️ APIキーが設定されていません。オプション画面から設定してください。</p>
    </div>`;
    btn.disabled = false;
    btn.textContent = '🔍 深掘りする';
    return;
  }

  if (!article.text) {
    deepDiv.innerHTML = `<div class="deep-dive-result" style="background:#fff3f3;border-color:#f5c6c6">
      <p style="color:#c0392b">⚠️ 記事本文が取得できていないため深掘りできません。</p>
    </div>`;
    btn.disabled = false;
    btn.textContent = '🔍 深掘りする';
    return;
  }

  const prompt =
    `以下のWSJ記事を詳細に分析してください。` +
    `背景・経緯、主要な論点、市場・経済への影響、日本への影響、今後の展望を含む` +
    `詳細な分析を日本語で提供してください。\n\n` +
    `記事タイトル: ${article.title}\n\n記事本文:\n${article.text}`;

  try {
    // 429 (レート制限) の場合は最大3回リトライする
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        const waitSec = attempt * 5;
        deepDiv.innerHTML = `
          <div class="loading-inline">
            <div class="spinner"></div>
            レート制限中... ${waitSec}秒後にリトライします (${attempt}/3)
          </div>`;
        await new Promise(r => setTimeout(r, waitSec * 1000));
      }

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
          temperature: 0.4
        })
      });

      if (res.status === 429) continue;
      break;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const analysis = data.choices[0].message.content.trim();

    deepDiv.innerHTML = `
      <div class="deep-dive-result">
        <h3>🔍 詳細分析</h3>
        <p>${nl2br(analysis)}</p>
      </div>`;
    btn.style.display = 'none';
  } catch (e) {
    deepDiv.innerHTML = `<div class="deep-dive-result" style="background:#fff3f3;border-color:#f5c6c6">
      <p style="color:#c0392b">⚠️ 分析エラー: ${esc(e.message)}</p>
    </div>`;
    btn.disabled = false;
    btn.textContent = '🔍 深掘りする';
  }
}

// ─── 共有（クリップボードコピー） ────────────────────────────────────────────

document.getElementById('btn-share').addEventListener('click', async () => {
  const storageData = await chrome.storage.local.get(storageKey);
  const state = storageData[storageKey];
  if (!state || !state.articles || state.articles.length === 0) return;

  const dateStr = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });

  let text = `📰 WSJ Daily Digest\n${dateStr}\n`;
  text += '━'.repeat(20) + '\n\n';

  state.articles.forEach((a, i) => {
    text += `【${i + 1}】${a.title || '(タイトルなし)'}\n`;
    if (a.publishedAt) {
      try {
        const d = new Date(a.publishedAt);
        if (!isNaN(d.getTime())) {
          text += `📅 ${d.toLocaleString('ja-JP', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}\n`;
        }
      } catch (_) {}
    }
    text += `\n${a.summary || ''}\n`;
    if (a.whyItMatters) {
      text += `\n💡 Why it matters\n${a.whyItMatters}\n`;
    }

    // 深掘り結果があれば含める
    const deepDiv = document.getElementById(`deep-${i}`);
    if (deepDiv) {
      const deepResult = deepDiv.querySelector('.deep-dive-result p');
      if (deepResult) {
        text += `\n🔍 詳細分析\n${deepResult.textContent}\n`;
      }
    }

    text += `\n🔗 ${a.url}\n`;
    text += '\n' + '─'.repeat(20) + '\n\n';
  });

  try {
    await navigator.clipboard.writeText(text);
    const toast = document.getElementById('share-toast');
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 2500);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    const toast = document.getElementById('share-toast');
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 2500);
  }
});

// ─── 初期化 ───────────────────────────────────────────────────────────────────

// URLパラメータからセッションIDを取得
const sessionId = new URLSearchParams(location.search).get('session');
const storageKey = sessionId ? `digest_${sessionId}` : 'digestState';

// ページロード時に現在の状態を読み込む
chrome.storage.local.get(storageKey, (data) => {
  applyState(data[storageKey] || { status: 'collecting', articles: [], total: 0, processed: 0 });
});

// 以降の変更をリアルタイムで受け取る（自分のセッションだけ）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[storageKey]) {
    applyState(changes[storageKey].newValue);
  }
});
