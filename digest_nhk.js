// digest_nhk.js

document.getElementById('date-label').textContent = new Date().toLocaleDateString('ja-JP', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
});

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

loadReadArticles();

// ─── 状態管理 ────────────────────────────────────────────────────────────────

let renderedCount = 0;

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function nl2br(str) { return esc(str).replace(/\n/g, '<br>'); }

function md(str) { return marked.parse(String(str || '')); }

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

  const spinner    = document.getElementById('spinner');
  const statusText = document.getElementById('status-text');
  const fillBar    = document.getElementById('progress-bar-fill');
  const countText  = document.getElementById('count-text');
  const errorBox   = document.getElementById('error-box');
  const doneBanner = document.getElementById('done-banner');

  const { status, total, processed, articles, error } = state;

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

  if (article.publishedAt) {
    const dateDiv = document.createElement('div');
    dateDiv.className = 'article-date';
    try {
      const d = new Date(article.publishedAt);
      if (!isNaN(d.getTime())) {
        dateDiv.textContent = d.toLocaleString('ja-JP', {
          year: 'numeric', month: 'long', day: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo'
        });
      } else {
        dateDiv.textContent = article.publishedAt;
      }
    } catch (_) { dateDiv.textContent = article.publishedAt; }
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
  a.href = article.url; a.target = '_blank'; a.rel = 'noopener';
  a.textContent = article.title || article.url;
  h2.appendChild(a);
  titleRow.appendChild(h2);
  card.appendChild(titleRow);

  // ① 一言で言うと
  if (article.oneLiner) {
    const oneLiner = document.createElement('div');
    oneLiner.className = 'summary';
    oneLiner.innerHTML = `<span class="section-head">① 一言で言うと</span>${md(article.oneLiner)}`;
    card.appendChild(oneLiner);
  }

  // ② パワー構造
  if (article.powerStructure) {
    const psDiv = document.createElement('div');
    psDiv.className = 'summary';
    psDiv.innerHTML = `<span class="section-head">② パワー構造</span><pre style="margin:4px 0;font-family:inherit;white-space:pre-wrap">${esc(article.powerStructure)}</pre>`;
    card.appendChild(psDiv);
  }

  // ③ 何が変わったか
  if (article.beforeAfter) {
    const baDiv = document.createElement('div');
    baDiv.className = 'summary';
    baDiv.innerHTML = `<span class="section-head">③ 何が変わったか</span>${md(article.beforeAfter)}`;
    card.appendChild(baDiv);
  }

  // ④ プレイヤー別まとめ
  if (article.players && article.players.length > 0) {
    const plDiv = document.createElement('div');
    plDiv.className = 'summary';
    let html = '<span class="section-head">④ プレイヤー別まとめ</span><ul class="key-points">';
    article.players.forEach(p => { html += `<li>${marked.parseInline(String(p))}</li>`; });
    html += '</ul>';
    plDiv.innerHTML = html;
    card.appendChild(plDiv);
  }

  // ⑤ 本質
  if (article.essence) {
    const essDiv = document.createElement('div');
    essDiv.className = 'summary';
    essDiv.style.cssText = 'font-style:italic;border-top:1px solid #333;padding-top:10px;margin-top:6px';
    essDiv.innerHTML = `<span class="section-head">⑤ 本質</span>${md(article.essence)}`;
    card.appendChild(essDiv);
  }

  // フォールバック: 旧形式の summary のみ
  if (!article.oneLiner && article.summary) {
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'summary';
    summaryDiv.innerHTML = md(article.summary);
    card.appendChild(summaryDiv);
  }

  const footer = document.createElement('div');
  footer.className = 'card-footer';
  const btn = document.createElement('button');
  btn.className = 'btn-deep-dive';
  btn.textContent = '🔍 深掘りする';
  btn.addEventListener('click', () => deepDive(index, article, btn));
  footer.appendChild(btn);
  card.appendChild(footer);

  const deepDiv = document.createElement('div');
  deepDiv.id = `deep-${index}`;
  card.appendChild(deepDiv);

  return card;
}

// ─── 深掘り ───────────────────────────────────────────────────────────────────

async function deepDive(index, article, btn) {
  btn.disabled = true;
  btn.textContent = '分析中...';

  const deepDiv = document.getElementById(`deep-${index}`);
  deepDiv.innerHTML = `<div class="loading-inline"><div class="spinner"></div>詳細分析中...</div>`;

  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) {
    deepDiv.innerHTML = `<div class="deep-dive-result" style="background:#2a1a1a;border-color:#7a3030">
      <p style="color:#f08080">⚠️ APIキーが設定されていません。</p></div>`;
    btn.disabled = false; btn.textContent = '🔍 深掘りする';
    return;
  }

  if (!article.text) {
    deepDiv.innerHTML = `<div class="deep-dive-result" style="background:#2a1a1a;border-color:#7a3030">
      <p style="color:#f08080">⚠️ 記事本文が取得できていないため深掘りできません。</p></div>`;
    btn.disabled = false; btn.textContent = '🔍 深掘りする';
    return;
  }

  const prompt =
    `以下のNHKニュース記事を詳細に分析してください。` +
    `背景・経緯、主要な論点、社会への影響、今後の展望を含む詳細な分析を提供してください。\n\n` +
    `記事タイトル: ${article.title}\n\n記事本文:\n${article.text}`;

  try {
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        deepDiv.innerHTML = `<div class="loading-inline"><div class="spinner"></div>リトライ中... (${attempt}/3)</div>`;
        await new Promise(r => setTimeout(r, attempt * 5000));
      }
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1500, temperature: 0.4
        })
      });
      if (res.status === 429) continue;
      break;
    }

    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const analysis = data.choices[0].message.content.trim();
    deepDiv.innerHTML = `<div class="deep-dive-result"><h3>🔍 詳細分析</h3><div class="md-content">${md(analysis)}</div></div>`;
    btn.style.display = 'none';
  } catch (e) {
    deepDiv.innerHTML = `<div class="deep-dive-result" style="background:#2a1a1a;border-color:#7a3030">
      <p style="color:#f08080">⚠️ 分析エラー: ${esc(e.message)}</p></div>`;
    btn.disabled = false; btn.textContent = '🔍 深掘りする';
  }
}

// ─── 共有 ─────────────────────────────────────────────────────────────────────

function showToast(msg) {
  const toast = document.getElementById('share-toast');
  toast.textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

async function getArticles() {
  const storageData = await chrome.storage.local.get(storageKey);
  const state = storageData[storageKey];
  if (!state || !state.articles || state.articles.length === 0) return null;
  return state.articles;
}

document.getElementById('btn-copy').addEventListener('click', async () => {
  const articles = await getArticles();
  if (!articles) return;

  const dateStr = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });
  let text = `📺 NHK Daily Digest\n${dateStr}\n${'━'.repeat(20)}\n\n`;
  articles.forEach((a, i) => {
    const cats = (a.categories || []).join(' / ');
    text += `【${i + 1}】${cats ? `[${cats}] ` : ''}${a.title || '(タイトルなし)'}\n`;
    if (a.publishedAt) {
      try {
        const d = new Date(a.publishedAt);
        if (!isNaN(d.getTime())) {
          text += `📅 ${d.toLocaleString('ja-JP', {
            month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo'
          })}\n`;
        }
      } catch (_) {}
    }
    if (a.oneLiner) text += `\n① ${a.oneLiner}\n`;
    if (a.powerStructure) text += `\n② パワー構造\n${a.powerStructure}\n`;
    if (a.beforeAfter) text += `\n③ 何が変わったか\n${a.beforeAfter}\n`;
    if (a.players && a.players.length > 0) {
      text += `\n④ プレイヤー別まとめ\n`;
      a.players.forEach(p => { text += `・${p}\n`; });
    }
    if (a.essence) text += `\n⑤ 本質\n${a.essence}\n`;
    if (!a.oneLiner && a.summary) text += `\n${a.summary}\n`;
    text += `\n🔗 ${a.url}\n\n${'─'.repeat(20)}\n\n`;
  });

  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  showToast('📋 コピーしました！');
});

document.getElementById('btn-slack').addEventListener('click', async () => {
  const articles = await getArticles();
  if (!articles) return;

  const { slackWebhook } = await chrome.storage.local.get('slackWebhook');
  if (!slackWebhook) {
    showToast('⚠️ Slack Webhook URL が未設定です（オプション画面で設定）');
    return;
  }

  const btn = document.getElementById('btn-slack');
  btn.disabled = true;

  const dateStr = new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    hour: '2-digit', minute: '2-digit'
  });
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '📺 NHK Daily Digest', emoji: true } },
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
            timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
          }) + ' JST';
        }
      } catch (_) {}
    }
    const cats = (a.categories || []).map(c => `\`${c}\``).join(' ');
    const titleLine = `*${i + 1}. <${a.url}|${a.title || '(タイトルなし)'}>*${dateTag ? `　🕐 ${dateTag}` : ''}`;
    let body = cats ? cats + '\n' : '';
    if (a.oneLiner) body += `① ${a.oneLiner}\n`;
    if (a.powerStructure) body += `\n*② パワー構造*\n${a.powerStructure}\n`;
    if (a.beforeAfter) body += `\n*③ 何が変わったか*\n${a.beforeAfter}\n`;
    if (a.players && a.players.length > 0) {
      body += `\n*④ プレイヤー別まとめ*\n`;
      a.players.forEach(p => { body += `• ${p}\n`; });
    }
    if (a.essence) body += `\n*⑤ 本質*\n${a.essence}`;
    if (!a.oneLiner && a.summary) body += a.summary;
    if (body.length > 2800) body = body.slice(0, 2800) + '…';
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `${titleLine}\n${body}` } });
    blocks.push({ type: 'divider' });
  });

  try {
    const res = await fetch(slackWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks })
    });
    showToast(res.ok ? '🟣 Slackに送信しました！' : `⚠️ Slack送信エラー: ${res.status}`);
  } catch (e) {
    showToast(`⚠️ エラー: ${e.message}`);
  } finally {
    btn.disabled = false;
  }
});

// ─── 初期化 ───────────────────────────────────────────────────────────────────

const sessionId = new URLSearchParams(location.search).get('session');
const storageKey = sessionId ? `digest_${sessionId}` : 'digestState';

chrome.storage.local.get(storageKey, (data) => {
  applyState(data[storageKey] || { status: 'collecting', articles: [], total: 0, processed: 0 });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[storageKey]) {
    applyState(changes[storageKey].newValue);
  }
});
