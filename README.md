# 関西ランニング・トレイルイベント一覧アプリ

モシコム（https://moshicom.com/）の公開イベントページから、関西エリアのランニング・トレイル系イベントを週1回収集し、Web で検索・絞り込みできるアプリです。

**スタック**: Next.js 14 (App Router) / TypeScript / Tailwind CSS / Supabase (Postgres) / Playwright / Vercel

---

## セットアップ手順

### 前提

- Node.js 18 以上
- pnpm / npm / yarn（いずれか）
- Supabase アカウント
- Vercel アカウント（デプロイ時）

### 1. リポジトリのクローン

```bash
git clone <your-repo-url>
cd moshicom-app
```

### 2. 依存ライブラリのインストール

```bash
npm install
```

### 3. Playwright ブラウザのインストール

クローラーは一覧収集に Playwright (Chromium) を使用します。

```bash
npx playwright install --with-deps chromium
```

> GitHub Actions で実行する場合、ワークフロー内で自動インストールされます。

### 4. 環境変数の設定

```bash
cp .env.local.example .env.local
```

`.env.local` を開いて各値を設定してください（後述の「環境変数」セクションを参照）。

---

## 環境変数

| 変数名 | 説明 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクト URL（`https://xxx.supabase.co`） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase の匿名公開キー |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase のサービスロールキー（サーバー側専用・公開禁止） |
| `CRON_SECRET` | Vercel Cron 用の認証トークン（任意の長いランダム文字列） |
| `MOSHICOM_MAX_PAGES` | 1キーワードあたりの最大ページ数（デフォルト: `20`） |
| `MOSHICOM_MAX_EVENTS` | 収集URL総数の上限（デフォルト: `500`） |

> `SUPABASE_SERVICE_ROLE_KEY` はクライアント側には絶対に公開しないでください。

---

## Supabase セットアップ方法

1. [Supabase](https://supabase.com/) でプロジェクトを作成する
2. 左メニュー → **SQL Editor** を開く
3. `supabase/schema.sql` の内容をコピーして実行する
4. `excluded_organizers` テーブルもこの SQL に含まれており、主催者の手動除外機能に必須です
5. **Settings → API** から以下を取得し、`.env.local` に設定する:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY`

---

## ローカル実行方法

```bash
npm run dev
```

ブラウザで `http://localhost:3000` を開くとイベント一覧が表示されます。

初回はDBが空なので、先に手動クロールを実行してください（後述）。

---

## まず確認するログ項目（ページネーション突破の切り分け）

`npm run crawl` 実行後、以下のログを順に確認してください。

### ① Playwright 一覧収集が動いているか

```
[playwright] ══════════════════════════════════════════
[playwright] Playwright 一覧収集 開始
[playwright]   キーワード数: 16
[playwright]   maxPages: 20 / maxEvents: 500
```

### ② 各キーワードでページが進んでいるか（最重要）

```
[playwright]   page 1: 抽出 20 URLs | 新規 +20 | 累計 20
[playwright]   page 1 → 2: クリック成功 (selector: .pagination a:has-text("次"))
[playwright]   page 2: 抽出 20 URLs | 新規 +18 | 累計 38
...
```

**ページネーション突破できていない場合:**

```
[playwright]   page 1: 次ページなし（全セレクタ不一致）
[playwright:debug] ─── ページネーション DOM 確認 ───────────────────
[playwright:debug] pagination要素:
[playwright:debug]   href="#" text="2" class="..."  ← この出力を見てセレクタを特定する
```

`次ページなし` が全キーワードで出るようなら `debugLogPaginationArea` のログを確認し、
`lib/moshicom/playwright.ts` の `navigateToNextPage()` 内 `selectorCandidates` に
実際のセレクタを追加してください。

### ③ 詳細巡回のサマリ

```
[crawler] [Step 3] 詳細巡回 完了
[crawler]   detail fetch 対象:   280
[crawler]   fetch 成功:          275
[crawler]   parse → save:        195
[crawler]   parse → skip:         80
[crawler]   fetch / parse error:   5
```

`parse → save` が旧来の `52` より大きければページネーション突破成功です。

### ④ 最終サマリ

```
[crawler] ══════════════════════════════════════════════
[crawler] クロール 完了
[crawler]   Playwright URL収集: 280 → 詳細対象 280
[crawler]   save (upserted):    195
[crawler]   skip (非対象):       85
[crawler]   error:                5
[crawler]   所要時間:          1234.5s
```

---

## クロールの実行方法

### A. スタンドアロンスクリプト（推奨）

Playwright によるページネーション対応のクローラーをローカルまたは GitHub Actions で実行します。

```bash
npm run crawl
```

ローカル実行時は `.env.local` が自動で読み込まれます。

出力例:

```
[crawl] ===== スクリプト起動 =====
[playwright] 開始 maxPages=20 maxEvents=300
[playwright] 検索: "関西 ランニング" → https://moshicom.com/search?keyword=...
[playwright]   page 1: 20 URLs (新規 20 / 累計 20)
[playwright]   page 2: 18 URLs (新規 15 / 累計 35)
...
[playwright] 収集完了: 280 URLs / 38 ページ巡回
[crawler] [Step 3] 詳細ページ巡回 (280 件)
...
[crawl] ===== 完了 =====
{
  "fetched": 280,
  "upserted": 195,
  "skipped": 85,
  "errors": 3,
  "duration_ms": 1234567
}
```

| フィールド | 説明 |
|---|---|
| `fetched` | 詳細ページ取得を試みたURL数 |
| `upserted` | DBに保存（新規/更新）した件数 |
| `skipped` | 関西・スポーツ条件で除外した件数 |
| `errors` | 取得・パース失敗件数 |
| `duration_ms` | 実行時間（ミリ秒） |

### B. API 経由（Vercel / ローカル）

Playwright を使わない旧来のフロー（件数は少なくなります）:

```bash
# ローカル
curl -X POST http://localhost:3000/api/admin/crawl

# 本番 (Vercel)
curl -X POST https://your-app.vercel.app/api/admin/crawl
```

---

## Vercel デプロイ手順

1. [Vercel](https://vercel.com/) で GitHub リポジトリを連携してプロジェクトを作成する
2. **Settings → Environment Variables** で以下を追加:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CRON_SECRET`
3. **Deploy** を実行する

---

## Vercel Cron 設定方法

`vercel.json` に以下の設定が含まれています:

```json
{
  "crons": [
    {
      "path": "/api/cron/crawl",
      "schedule": "0 2 * * 1"
    }
  ]
}
```

これにより **毎週月曜日 02:00 UTC（日本時間 11:00）** に自動クロールが実行されます。

Cron リクエストには Vercel が自動で `Authorization: Bearer <CRON_SECRET>` ヘッダーを付与します。

> Vercel Cron は **Hobby プランでは1日1回まで**。週1回ならHobbyでも動作します。  
> 詳細: https://vercel.com/docs/cron-jobs

### スケジュールの変更

`vercel.json` の `schedule` フィールドを編集してください（cron 式）:

```
0 2 * * 1   → 毎週月曜 02:00 UTC
0 2 * * 0   → 毎週日曜 02:00 UTC
0 2 1 * *   → 毎月1日 02:00 UTC
```

---

## 新着順について

本アプリは以下の方法で新着順を実現します:

1. **検索URLに `?sort=new` を付与**（第一候補）  
   モシコムの検索エンドポイントがこのパラメータをサポートしていれば、一覧取得段階で新着順になります。

2. **一覧表示順をそのまま採用**（フォールバック）  
   `?sort=new` が効かない場合は、モシコムのデフォルト表示順（新着順の可能性大）をそのまま使います。

3. **scraped_at 降順（補助）**  
   初期表示は `scraped_at`（クロール日時）の降順です。同一クロール回内の順序が一覧ページの表示順と対応します。

> サイト側の仕様変更で新着順が保証できなくなる可能性があります。

---

## 制約事項

- **公開ページのみ対象**: ログインが必要なページのデータは取得しません
- **過度なアクセス禁止**: リクエスト間に 1〜3 秒のランダム待機を入れています
- **HTML構造変更で壊れる可能性**: モシコムのサイト改修でセレクタが合わなくなることがあります。その場合は `lib/moshicom/parse.ts` のセレクタを更新してください
- **新着順はサイト仕様に依存**: 上記「新着順について」を参照
- **Vercel 関数タイムアウト**: デフォルト 10 秒。クロールは `maxDuration: 300` を設定していますが、Pro プランが必要です。Hobby プランではイベント数が多い場合タイムアウトする可能性があります

---

## 動かない場合の確認ポイント

### イベントが 0 件の場合

1. **クロールが実行されているか確認**  
   `POST /api/admin/crawl` を叩いてレスポンスを確認する

2. **HTMLセレクタが合っているか確認**  
   ブラウザで `https://moshicom.com/search/?keyword=ランニング&sort=new` を開き、開発者ツール（F12）でイベントカードの HTML 構造を確認する。`lib/moshicom/parse.ts` のセレクタを実際のクラス名に合わせて修正する

3. **JavaScriptレンダリング依存か確認**  
   ブラウザで Ctrl+U（ページソース表示）を開き、イベントデータが HTML に含まれているか確認する。含まれていない場合は後述の **Playwright 版** が必要

4. **Supabase 接続を確認**  
   環境変数が正しく設定されているか確認する

### 403 / 429 が返る場合

`lib/moshicom/fetch.ts` の `WAIT_MIN_MS` / `WAIT_MAX_MS` を増やす（例: 3000〜7000ms）。
またはしばらく時間をおいてから再実行する。

---

## GitHub Actions でのクロール自動化

### 推奨構成

Playwright を使った重いクロール処理は **GitHub Actions** で実行することを推奨します。  
Vercel はリクエストタイムアウトの制約があるため、長時間クロールには向いていません。

```
GitHub Actions (週1自動) ─→ Supabase DB ─→ Vercel (UI表示のみ)
```

### 自動スケジュール

`.github/workflows/crawl-moshicom.yml` が含まれています。

| 設定 | 内容 |
|---|---|
| スケジュール | 毎週月曜 02:00 UTC（日本時間 11:00） |
| 手動実行 | GitHub の Actions タブ → `workflow_dispatch` |
| タイムアウト | 90分 |

### GitHub Secrets の設定

GitHub リポジトリの **Settings → Secrets and variables → Actions** で以下を登録してください:

| Secret 名 | 値 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクト URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名公開キー |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase サービスロールキー |

### 手動実行時のパラメータ

`workflow_dispatch` での手動実行時に以下を指定できます:

| パラメータ | デフォルト | 説明 |
|---|---|---|
| `max_pages` | `20` | 1キーワードあたりの最大ページ数 |
| `max_events` | `300` | 収集URL総数の上限 |

---

## 今後の改善案

- **Playwright 対応**: CSR化した場合のフォールバック実装
- **通知機能**: 新着イベントをメール/LINE/Slack に通知
- **お気に入り機能**: 気になるイベントをローカルに保存
- **スコアリング**: 距離・コース情報・評判などで独自スコアを付与
- **管理画面**: クロール履歴・除外設定・手動フラグ付けUI
- **API 直叩き**: モシコムが JSON API を持つ場合は HTML パースより安定する
- **差分通知**: 前回クロールとの差分（新規・終了）をハイライト

---

## ファイル構成

```
moshicom-app/
├── .github/
│   └── workflows/
│       └── crawl-moshicom.yml  # GitHub Actions クロール自動化（毎週月曜）
├── app/
│   ├── layout.tsx              # ルートレイアウト
│   ├── globals.css             # Tailwind ディレクティブ
│   ├── page.tsx                # メイン画面（一覧・絞り込みUI）
│   └── api/
│       ├── events/route.ts     # GET /api/events
│       ├── admin/crawl/route.ts  # POST /api/admin/crawl（手動実行）
│       └── cron/crawl/route.ts   # GET /api/cron/crawl（Vercel Cron）
├── lib/
│   ├── types.ts                # 型定義
│   ├── constants.ts            # 定数（しきい値・キーワード等）
│   ├── db.ts                   # Supabase 操作
│   └── moshicom/
│       ├── crawler.ts          # クロールオーケストレーター
│       ├── playwright.ts       # Playwright による一覧URL収集
│       ├── fetch.ts            # HTTP取得（詳細ページ用 fetch + cheerio）
│       ├── parse.ts            # cheerio HTML パース
│       ├── filters.ts          # 関西/スポーツ判定・キーワード検出
│       └── normalize.ts        # データ正規化・フラグ付与
├── scripts/
│   └── crawl.ts               # スタンドアロン クロール実行スクリプト
├── supabase/
│   └── schema.sql              # DBスキーマ（Supabase SQL Editor に貼り付ける）
├── .env.local.example          # 環境変数テンプレート（プレースホルダーのみ）
├── package.json
├── vercel.json                 # Vercel Cron 設定（毎週月曜 02:00 UTC）
├── tailwind.config.ts
├── tsconfig.json
└── next.config.mjs
```
