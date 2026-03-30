# WSJ & NHK Daily Digest

WSJ と NHK のニュース記事を自動収集・AI 要約して Slack / LINE に送る Chrome 拡張。

## 機能

- **自動収集**: WSJ / NHK のトップページから最大20件の記事 URL を収集
- **1件モード**: 個別記事ページで拡張クリック → その記事だけを処理
- **AI 要約**: OpenAI GPT-4o-mini で8項目分析
  - 一言まとめ / Why it matters / 要点 / 本質 / 背景 / 勝者・敗者 / 注目点 / コメント
- **カテゴリ分類**: 政治・経済・金融・テクノロジーなど17カテゴリに自動タグ付け
- **Slack 送信**: Block Kit 形式でリッチに投稿（記事タイトル・日時・分析を含む）
- **LINE 送信**: LINE Notify 経由でテキスト送信（1000文字制限で自動分割）
- **定時自動送信**: Chrome アラームで毎朝指定時刻に自動実行
- **既読管理**: チェック済み記事を記録し次回から重複スキップ

## インストール

```
git clone https://github.com/yukisnowsubscription-cloud/wsj-digest.git
```

1. Chrome で `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をオン
3. 「パッケージ化されていない拡張機能を読み込む」→ クローンしたフォルダを選択

## セットアップ（初回）

拡張アイコンを右クリック → 「オプション」を開く

| 設定項目 | 必須 | 取得先 |
|---------|:----:|-------|
| OpenAI API キー | ✅ | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Slack Incoming Webhook URL | 任意 | Slack → アプリ設定 → Incoming Webhooks |
| LINE Notify トークン | 任意 | [notify-bot.line.me/my](https://notify-bot.line.me/my/) |

Slack の Webhook URL は「テスト送信」ボタンで NHK ニュース5件を送信して動作確認できる。

## 使い方

### 手動実行

| 開いているページ | 動作 |
|----------------|------|
| WSJ トップ (`wsj.com`) | 最大20件を収集・要約 |
| WSJ 個別記事ページ | その1件だけ処理 |
| NHK トップ (`nhk.or.jp`, `news.web.nhk`) | 最大20件を収集・要約 |
| NHK 個別記事ページ | その1件だけ処理 |

ダイジェストページがブラウザで開き、リアルタイムに処理状況と結果が表示される。

### 自動送信

オプション画面 → 「自動送信設定」で時刻を設定してオンにする。
Chrome が起動している間、毎日指定時刻に WSJ と NHK を自動取得して Slack / LINE に送信。

## 動作要件

- Chrome（デスクトップ版、Windows / Mac / Linux）
- 自動送信は **Chrome が起動中のみ** 動作（スリープ中は実行されない）
- OpenAI API の利用料金が別途かかる（GPT-4o-mini は低コスト）
