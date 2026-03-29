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

// ─── 既読管理 ────────────────────────────────────────────────────────────────

let _readSet = new Set();

async function loadReadArticles() {
  const { readArticles } = await chrome.storage.local.get('readArticles');
  _readSet = new Set((readArticles || []).map(a => a.url));
  return readArticles || [];
}

async function toggleRead(url, title) {
  const { readArticles } = await chrome.storage.local.get('readArticles');
  const list = readArticles || [];
  const idx = list.findIndex(a => a.url === url);
  if (idx >= 0) {
    list.splice(idx, 1);
    _readSet.delete(url);
  } else {
    list.push({ url, title, checkedAt: new Date().toISOString() });
    _readSet.add(url);
  }
  await chrome.storage.local.set({ readArticles: list });
}

// 初期ロード
loadReadArticles();

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

// ─── カテゴリバッジ定義 ──────────────────────────────────────────────────────

const BADGE_STYLES = {
  '政治':         { emoji: '🏛️', bg: '#EEF2FF', color: '#3730A3', border: '#C7D2FE' },
  '経済':         { emoji: '📈', bg: '#ECFDF5', color: '#065F46', border: '#6EE7B7' },
  '金融・マーケット': { emoji: '💹', bg: '#FFFBEB', color: '#92400E', border: '#FCD34D' },
  '国際情勢':     { emoji: '🌏', bg: '#FFF7ED', color: '#9A3412', border: '#FDBA74' },
  '外交':         { emoji: '🤝', bg: '#FDF4FF', color: '#6B21A8', border: '#D8B4FE' },
  '安全保障':     { emoji: '🛡️', bg: '#FEF2F2', color: '#991B1B', border: '#FCA5A5' },
  '社会':         { emoji: '👥', bg: '#F0F9FF', color: '#0C4A6E', border: '#7DD3FC' },
  '災害・事故':   { emoji: '🚨', bg: '#FFF1F2', color: '#881337', border: '#FDA4AF' },
  '科学・技術':   { emoji: '🔬', bg: '#F0FDF4', color: '#14532D', border: '#86EFAC' },
  '環境・気候':   { emoji: '🌿', bg: '#ECFDF5', color: '#064E3B', border: '#34D399' },
  '医療・健康':   { emoji: '🏥', bg: '#EFF6FF', color: '#1E3A5F', border: '#93C5FD' },
  '労働・雇用':   { emoji: '💼', bg: '#FAFAF9', color: '#374151', border: '#D1D5DB' },
  '企業・産業':   { emoji: '🏭', bg: '#F8FAFC', color: '#1E293B', border: '#CBD5E1' },
  '司法・犯罪':   { emoji: '⚖️', bg: '#FEF3C7', color: '#78350F', border: '#F59E0B' },
  'スポーツ':     { emoji: '🏅', bg: '#ECFEFF', color: '#164E63', border: '#67E8F9' },
  '文化・エンタメ': { emoji: '🎭', bg: '#FDF4FF', color: '#701A75', border: '#E879F9' },
  'その他':       { emoji: '📰', bg: '#F9FAFB', color: '#4B5563', border: '#D1D5DB' }
};

function createBadge(category) {
  const style = BADGE_STYLES[category] || BADGE_STYLES['その他'];
  const span = document.createElement('span');
  span.className = 'badge';
  span.textContent = `${style.emoji} ${category}`;
  span.style.cssText = `background:${style.bg};color:${style.color};border:1px solid ${style.border}`;
  return span;
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
    document.getElementById('share-wrap').style.display = 'flex';
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

  // カテゴリバッジ
  if (article.categories && article.categories.length > 0) {
    const badgeRow = document.createElement('div');
    badgeRow.className = 'badge-row';
    article.categories.forEach(cat => badgeRow.appendChild(createBadge(cat)));
    card.appendChild(badgeRow);
  }

  // 公開日時
  if (article.publishedAt) {
    const dateDiv = document.createElement('div');
    dateDiv.className = 'article-date';
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

  // タイトル行（チェックボックス + タイトル）
  const titleRow = document.createElement('div');
  titleRow.className = 'title-row';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'read-check';
  checkbox.title = '既読にする';
  if (_readSet.has(article.url)) {
    checkbox.checked = true;
    card.classList.add('read');
  }
  checkbox.addEventListener('change', async () => {
    await toggleRead(article.url, article.title || '');
    card.classList.toggle('read', checkbox.checked);
  });
  titleRow.appendChild(checkbox);

  const h2 = document.createElement('h2');
  const a = document.createElement('a');
  a.href = article.url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = article.title || article.url;
  h2.appendChild(a);
  titleRow.appendChild(h2);
  card.appendChild(titleRow);

  // ① 一言で言うと
  if (article.oneLiner) {
    const oneLiner = document.createElement('div');
    oneLiner.className = 'summary';
    oneLiner.innerHTML = `<span class="section-head">① 一言で言うと</span>${nl2br(article.oneLiner)}`;
    card.appendChild(oneLiner);
  }

  // ② Why it matters
  if (article.whyItMatters) {
    const whyBox = document.createElement('div');
    whyBox.className = 'why-box';
    whyBox.innerHTML =
      `<div class="why-label">💡 Why it matters</div>` +
      `<p>${nl2br(article.whyItMatters)}</p>`;
    card.appendChild(whyBox);
  }

  // ③ 要点
  if (article.keyPoints && article.keyPoints.length > 0) {
    const kpDiv = document.createElement('div');
    kpDiv.className = 'summary';
    let html = '<span class="section-head">③ 要点</span><ul class="key-points">';
    article.keyPoints.forEach(p => { html += `<li>${esc(p)}</li>`; });
    html += '</ul>';
    kpDiv.innerHTML = html;
    card.appendChild(kpDiv);
  }

  // ④ 本質
  if (article.essence) {
    const essDiv = document.createElement('div');
    essDiv.className = 'summary';
    essDiv.innerHTML = `<span class="section-head">④ 本質</span>${nl2br(article.essence)}`;
    card.appendChild(essDiv);
  }

  // ⑤ 背景・構造
  if (article.background) {
    const bgDiv = document.createElement('div');
    bgDiv.className = 'summary';
    bgDiv.innerHTML = `<span class="section-head">⑤ 背景・構造</span>${nl2br(article.background)}`;
    card.appendChild(bgDiv);
  }

  // ⑥ 勝者 / 敗者
  if (article.winnersLosers) {
    const wlDiv = document.createElement('div');
    wlDiv.className = 'summary';
    wlDiv.innerHTML = `<span class="section-head">⑥ 勝者 / 敗者</span>${nl2br(article.winnersLosers)}`;
    card.appendChild(wlDiv);
  }

  // ⑦ 今後の注目点
  if (article.watchNext) {
    const wnDiv = document.createElement('div');
    wnDiv.className = 'summary';
    wnDiv.innerHTML = `<span class="section-head">⑦ 今後の注目点</span>${nl2br(article.watchNext)}`;
    card.appendChild(wnDiv);
  }

  // ⑧ 一言コメント
  if (article.comment) {
    const cmDiv = document.createElement('div');
    cmDiv.className = 'summary';
    cmDiv.style.cssText = 'font-style:italic;color:#aaa;border-top:1px solid #333;padding-top:10px;margin-top:6px';
    cmDiv.innerHTML = `<span class="section-head">⑧ 一言コメント</span>${nl2br(article.comment)}`;
    card.appendChild(cmDiv);
  }

  // フォールバック: 旧形式の summary のみ
  if (!article.oneLiner && article.summary) {
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'summary';
    summaryDiv.innerHTML = nl2br(article.summary);
    card.appendChild(summaryDiv);
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
    const deepDiv = document.getElementById(`deep-${i}`);
    if (deepDiv) {
      const deepResult = deepDiv.querySelector('.deep-dive-result p');
      if (deepResult) text += `\n🔍 詳細分析\n${deepResult.textContent}\n`;
    }
    text += `\n🔗 ${a.url}\n`;
    text += '\n' + '─'.repeat(20) + '\n\n';
  });
  return text;
}

function showToast(msg) {
  const toast = document.getElementById('share-toast');
  toast.textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

async function getArticles() {
  const storageData = await chrome.storage.local.get(storageKey);
  const state = storageData[storageKey];
  return (state && state.articles && state.articles.length > 0) ? state.articles : null;
}

// ─── コピー ───────────────────────────────────────────────────────────────────

document.getElementById('btn-copy').addEventListener('click', async () => {
  const articles = await getArticles();
  if (!articles) return;
  const text = buildShareText(articles);
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  showToast('📋 コピーしました！');
});

// ─── LINE 送信 ────────────────────────────────────────────────────────────────

async function lineNotify(token, message) {
  const res = await fetch('https://notify-api.line.me/api/notify', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'message=' + encodeURIComponent(message)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || res.status);
  }
}

function buildLineMessages(articles) {
  const dateStr = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });
  // ヘッダーメッセージ
  const messages = [`📰 WSJ Daily Digest\n${dateStr}\n全${articles.length}件`];

  // 記事ごとに1メッセージ（950文字以内に収める）
  articles.forEach((a, i) => {
    const cats = (a.categories || []).join(' / ');
    let msg = `【${i + 1}/${articles.length}】${cats ? `[${cats}] ` : ''}${a.title || '(タイトルなし)'}\n\n`;
    let body = '';
    if (a.oneLiner) body += `① ${a.oneLiner}\n`;
    if (a.whyItMatters) body += `\n💡 ${a.whyItMatters}\n`;
    if (a.keyPoints && a.keyPoints.length > 0) {
      a.keyPoints.forEach(p => { body += `・${p}\n`; });
    }
    if (!a.oneLiner && a.summary) body += a.summary;
    const link = `\n\n🔗 ${a.url}`;
    const maxBody = 950 - msg.length - link.length;
    msg += body.length > maxBody ? body.slice(0, maxBody - 1) + '…' : body;
    msg += link;
    messages.push(msg);
  });
  return messages;
}

document.getElementById('btn-line').addEventListener('click', async () => {
  const articles = await getArticles();
  if (!articles) return;

  const { lineToken } = await chrome.storage.local.get('lineToken');

  if (lineToken) {
    const btn = document.getElementById('btn-line');
    btn.disabled = true;
    const messages = buildLineMessages(articles);
    try {
      for (let i = 0; i < messages.length; i++) {
        showToast(`💬 LINE送信中… (${i + 1}/${messages.length})`);
        await lineNotify(lineToken, messages[i]);
        if (i < messages.length - 1) await new Promise(r => setTimeout(r, 500));
      }
      showToast('💬 LINEに送信しました！');
    } catch (e) {
      showToast(`⚠️ LINE送信エラー: ${e.message}`);
    } finally {
      btn.disabled = false;
    }
  } else {
    const text = buildShareText(articles);
    window.open(`https://line.me/R/msg/text/?${encodeURIComponent(text.slice(0, 1000))}`, '_blank');
    showToast('💬 LINEを開きました');
  }
});

// ─── Slack 送信 ───────────────────────────────────────────────────────────────

function buildSlackPayload(articles) {
  const dateStr = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📰 WSJ Daily Digest', emoji: true }
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `${dateStr}　全 ${articles.length} 件` }]
    },
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
    if (!a.oneLiner && a.summary) body += a.summary;
    if (body.length > 2800) body = body.slice(0, 2800) + '…';

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `${titleLine}\n${body}` }
    });
    blocks.push({ type: 'divider' });
  });

  return { blocks };
}

document.getElementById('btn-slack').addEventListener('click', async () => {
  const articles = await getArticles();
  if (!articles) return;

  const { slackWebhook } = await chrome.storage.local.get('slackWebhook');
  if (!slackWebhook) {
    showToast('⚠️ Slack Webhook URL が未設定です（オプション画面で設定してください）');
    return;
  }

  const btn = document.getElementById('btn-slack');
  btn.disabled = true;
  try {
    const res = await fetch(slackWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSlackPayload(articles))
    });
    if (res.ok) {
      showToast('🟣 Slackに送信しました！');
    } else {
      showToast(`⚠️ Slack送信エラー: ${res.status}`);
    }
  } catch (e) {
    showToast(`⚠️ Slack送信エラー: ${e.message}`);
  } finally {
    btn.disabled = false;
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
