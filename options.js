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
    showMessage(messageEl, 'error', '⚠️ APIキーを入力してください。');
    return;
  }
  if (!key.startsWith('sk-')) {
    showMessage(messageEl, 'error', '⚠️ 正しいOpenAI APIキーを入力してください（sk- で始まります）。');
    return;
  }

  chrome.storage.local.set({ apiKey: key }, () => {
    if (chrome.runtime.lastError) {
      showMessage(messageEl, 'error', `保存エラー: ${chrome.runtime.lastError.message}`);
    } else {
      showMessage(messageEl, 'success', '✅ APIキーを保存しました。');
    }
  });
});

// ─── 自動送信設定 ───────────────────────────────────────────────────────────

const autoEnabledEl  = document.getElementById('auto-send-enabled');
const autoTimeEl     = document.getElementById('auto-send-time');
const lineTokenEl    = document.getElementById('line-token');
const slackWebhookEl = document.getElementById('slack-webhook');
const saveAutoBtn    = document.getElementById('save-auto-btn');
const messageAutoEl  = document.getElementById('message-auto');

// 保存済み設定を読み込む
chrome.storage.local.get(['autoSendEnabled', 'autoSendTime', 'lineToken', 'slackWebhook'], (data) => {
  if (data.autoSendEnabled) autoEnabledEl.checked = true;
  if (data.autoSendTime)    autoTimeEl.value = data.autoSendTime;
  if (data.lineToken)       lineTokenEl.value = data.lineToken;
  if (data.slackWebhook)    slackWebhookEl.value = data.slackWebhook;
});

saveAutoBtn.addEventListener('click', () => {
  const settings = {
    autoSendEnabled: autoEnabledEl.checked,
    autoSendTime:    autoTimeEl.value || '07:00',
    lineToken:       lineTokenEl.value.trim(),
    slackWebhook:    slackWebhookEl.value.trim()
  };

  chrome.storage.local.set(settings, () => {
    if (chrome.runtime.lastError) {
      showMessage(messageAutoEl, 'error', `保存エラー: ${chrome.runtime.lastError.message}`);
      return;
    }
    // background に alarm の再設定を依頼
    chrome.runtime.sendMessage({ type: 'updateAlarm', ...settings });
    showMessage(messageAutoEl, 'success', settings.autoSendEnabled
      ? `✅ 保存しました。毎日 ${settings.autoSendTime} に自動送信します。`
      : '✅ 保存しました（自動送信はオフです）。');
  });
});

// ─── Slack テスト送信 ────────────────────────────────────────────────────────

document.getElementById('test-slack-btn').addEventListener('click', async () => {
  const webhook = slackWebhookEl.value.trim();
  if (!webhook) {
    showMessage(messageAutoEl, 'error', '⚠️ Slack Webhook URL を入力してください。');
    return;
  }
  const btn = document.getElementById('test-slack-btn');
  btn.disabled = true;
  btn.textContent = '送信中…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'testNhkSlack', webhookUrl: webhook });
    if (res?.ok) {
      showMessage(messageAutoEl, 'success', '✅ テスト送信しました！Slackを確認してください。');
    } else {
      showMessage(messageAutoEl, 'error', `⚠️ エラー: ${res?.error || '不明なエラー'}`);
    }
  } catch (e) {
    showMessage(messageAutoEl, 'error', `⚠️ エラー: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '🧪 テスト送信（NHKニュース5件）';
  }
});

function showMessage(el, type, text) {
  el.className = type;
  el.style.background  = type === 'success' ? '#102010' : '#2a1a1a';
  el.style.border      = `1px solid ${type === 'success' ? '#2d6a2f' : '#7a3030'}`;
  el.style.color       = type === 'success' ? '#80c880' : '#f08080';
  el.textContent = text;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}
