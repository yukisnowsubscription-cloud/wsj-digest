# Project Rules

## ファイル構成

| ファイル | 役割 |
|---------|------|
| `manifest.json` | Chrome拡張の設定（MV3）。パーミッション・ホスト権限・Service Workerを定義 |
| `background.js` | Service Worker。記事収集・要約・送信・アラーム管理のすべてのロジック |
| `content.js` | WSJ記事ページに注入するコンテンツスクリプト。`window.__wsjExtract()` をエクスポート |
| `content_nhk.js` | NHK記事ページ用コンテンツスクリプト。`window.__nhkExtract()` をエクスポート |
| `digest.html` / `digest.js` | WSJ用ダイジェストページ（進捗・カード・共有ボタン） |
| `digest_nhk.html` / `digest_nhk.js` | NHK用ダイジェストページ |
| `options.html` / `options.js` | 設定画面（APIキー・Webhook・自動送信時刻） |
| `read-history.html` / `read-history.js` | 既読記事の管理ページ |

## アーキテクチャ

```
chrome.action.onClicked
  ├─ WSJ個別記事URL → runDigest(tabId, sessionId, apiKey, [url])   ← 1件モード
  ├─ WSJトップ      → runDigest(tabId, sessionId, apiKey, null)     ← 最大20件
  ├─ NHK個別記事URL → runNhkDigest(tabId, sessionId, apiKey, [url])
  └─ NHKトップ      → runNhkDigest(tabId, sessionId, apiKey, null)

runDigest / runNhkDigest:
  collectArticleUrls() または presetUrls
    → chrome.tabs.create (バックグラウンドタブ)
    → content.js / content_nhk.js を注入して本文抽出
    → summarize() → OpenAI API (gpt-4o-mini)
    → updateState() → chrome.storage.local
    → digest.html がリアルタイムに polling して表示
```

## 主要関数（background.js）

| 関数 | 説明 |
|------|------|
| `collectArticleUrls(tabId)` | WSJページから記事URL最大20件を収集 |
| `collectNhkArticleUrls(tabId)` | NHKページから記事URL最大20件を収集（3回リトライ） |
| `runDigest(tabId, sessionId, apiKey, presetUrls?)` | WSJダイジェスト本体。presetUrls指定で1件モード |
| `runNhkDigest(tabId, sessionId, apiKey, presetUrls?)` | NHKダイジェスト本体。presetUrls指定で1件モード |
| `summarize(apiKey, title, text)` | OpenAI GPT-4o-miniで8項目JSON要約（レート制限リトライあり） |
| `extractArticle(tabId)` | content.jsを注入してWSJ記事を抽出 |
| `extractArticleNhk(tabId)` | content_nhk.jsを注入してNHK記事を抽出 |
| `buildSlackPayload(articles)` | WSJ用 Slack Block Kit ペイロード生成 |
| `buildNhkSlackPayload(articles)` | NHK用 Slack Block Kit ペイロード生成 |
| `fetchNhkArticles(maxItems)` | NHK RSS (`cat0.xml`) を fetch してXML解析（Service Workerで動作） |
| `setupAlarm(enabled, timeStr)` | Chrome Alarms API で毎日の定時アラームを設定 |
| `sendSlackPayload(webhookUrl, payload)` | Slack Webhookに任意ペイロードをPOST |
| `sendToLine(token, text)` | LINE Notify APIにテキストをPOST |

## データ構造

**セッションストレージ** (`chrome.storage.local`):
```js
`digest_${sessionId}`: {
  status: 'collecting' | 'processing' | 'done' | 'error',
  total: number,
  processed: number,
  skipped: number,
  articles: Article[],
  error: string,
  startTime: number
}
```

**記事エントリ**:
```js
{
  url, title, text, publishedAt,
  categories: string[],   // 例: ['経済', '金融']
  oneLiner: string,
  whyItMatters: string,
  keyPoints: string[],
  essence: string,
  background: string,
  winnersLosers: string,
  watchNext: string,
  comment: string,
  summary: string         // フォールバック用
}
```

**既読履歴** (`chrome.storage.local['readArticles']`):
```js
[{ url: string, title: string, checkedAt: string }]  // ISO日時
```

## 開発時の注意

- **background.js は Service Worker**: `DOMParser` / `document` は使えない。XML解析はRegexで行う
- **NHK新ドメイン** (`news.web.nhk`): Next.js/RSC のため読み込み完了後3秒待機 + 最大2回リトライ
- **タブ操作エラー**: `Tabs cannot be edited right now` は最大3回リトライで対処済み
- **新ドメイン追加時**: `manifest.json` の `host_permissions` に必ず追加すること
- **Chrome拡張のためdev serverは不要**: preview系hookは無視してよい
- **セッションID形式**: `Date.now().toString(36) + random` — 複数同時実行に対応
- **1件モード判定**: `isSingleWsjArticle(url)` / `isSingleNhkArticle(url)` でURL判定してpresetUrlsを渡す
