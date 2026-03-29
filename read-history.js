// read-history.js

const listEl = document.getElementById('list');
const countLabel = document.getElementById('count-label');

// 戻るリンク
document.getElementById('back-link').addEventListener('click', e => {
  e.preventDefault();
  history.back();
});

// 一覧を描画
async function render() {
  const { readArticles } = await chrome.storage.local.get('readArticles');
  const list = readArticles || [];

  countLabel.textContent = `${list.length} 件`;
  listEl.innerHTML = '';

  if (list.length === 0) {
    listEl.innerHTML = '<div class="empty">既読記事はありません。</div>';
    return;
  }

  // 新しい順に表示
  const sorted = [...list].sort((a, b) => (b.checkedAt || '').localeCompare(a.checkedAt || ''));

  sorted.forEach(item => {
    const row = document.createElement('div');
    row.className = 'read-item';

    const info = document.createElement('div');
    info.className = 'info';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'title';
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = item.title || item.url;
    titleDiv.appendChild(link);
    info.appendChild(titleDiv);

    if (item.checkedAt) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      try {
        const d = new Date(item.checkedAt);
        meta.textContent = d.toLocaleString('ja-JP', {
          year: 'numeric', month: 'long', day: 'numeric',
          hour: '2-digit', minute: '2-digit'
        }) + ' にチェック';
      } catch (_) {
        meta.textContent = item.checkedAt;
      }
      info.appendChild(meta);
    }

    row.appendChild(info);

    const btn = document.createElement('button');
    btn.className = 'btn-remove';
    btn.textContent = '解除';
    btn.addEventListener('click', async () => {
      await removeItem(item.url);
      render();
    });
    row.appendChild(btn);

    listEl.appendChild(row);
  });
}

async function removeItem(url) {
  const { readArticles } = await chrome.storage.local.get('readArticles');
  const list = (readArticles || []).filter(a => a.url !== url);
  await chrome.storage.local.set({ readArticles: list });
}

// 全クリア
document.getElementById('btn-clear-all').addEventListener('click', async () => {
  if (!confirm('すべての既読記事をクリアしますか？')) return;
  await chrome.storage.local.set({ readArticles: [] });
  render();
});

render();
