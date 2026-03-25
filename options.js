// options.js

const apiKeyInput = document.getElementById('api-key');
const saveBtn     = document.getElementById('save-btn');
const toggleBtn   = document.getElementById('toggle-visibility');
const messageEl   = document.getElementById('message');

// 保存済みキーを読み込む
chrome.storage.local.get('apiKey', ({ apiKey }) => {
  if (apiKey) apiKeyInput.value = apiKey;
});

// 表示/非表示切り替え
toggleBtn.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

// 保存
saveBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();

  if (!key) {
    showMessage('error', '⚠️ APIキーを入力してください。');
    return;
  }
  if (!key.startsWith('sk-')) {
    showMessage('error', '⚠️ 正しいOpenAI APIキーを入力してください（sk- で始まります）。');
    return;
  }

  chrome.storage.local.set({ apiKey: key }, () => {
    if (chrome.runtime.lastError) {
      showMessage('error', `保存エラー: ${chrome.runtime.lastError.message}`);
    } else {
      showMessage('success', '✅ APIキーを保存しました。');
    }
  });
});

function showMessage(type, text) {
  messageEl.className = type;
  messageEl.textContent = text;
  messageEl.style.display = 'block';
  setTimeout(() => {
    messageEl.style.display = 'none';
  }, 4000);
}
