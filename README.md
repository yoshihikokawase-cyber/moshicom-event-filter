# 関西ランニング・トレイルイベント一覧アプリ

モシコム（https://moshicom.com/）の公開イベントページから、関西エリアのランニング・トレイル系イベントを週1回収集し、Web で検索・絞り込みできるアプリです。

**スタック**: Next.js 14 (App Router) / TypeScript / Tailwind CSS / Supabase (Postgres) / Vercel

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
# または
pnpm install
```

### 3. 環境変数の設定

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

## 手動クロール実行方法

ローカルまたは本番環境で以下の curl コマンドを実行します:

```bash
# ローカル
curl -X POST http://localhost:3000/api/admin/crawl

# 本番 (Vercel)
curl -X POST https://your-app.vercel.app/api/admin/crawl
```

レスポンス例:

```json
{
  "result": {
    "fetched": 120,
    "upserted": 34,
    "skipped": 86,
    "errors": 2,
    "duration_ms": 45231
  }
}
```

| フィールド | 説明 |
|---|---|
| `fetched` | 取得試行したイベント詳細URL数 |
| `upserted` | DBに保存（新規/更新）した件数 |
| `skipped` | 関西・スポーツ条件で除外した件数 |
| `errors` | 取得・パース失敗件数 |
| `duration_ms` | 実行時間（ミリ秒） |

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

## Playwright 版へ切り替えるべきケース

以下のいずれかに該当する場合、`fetch + cheerio` では対応できません:

| 状況 | 判断方法 |
|---|---|
| ページソースにイベントデータがない | Ctrl+U で確認。HTML に `event` 関連のテキストが見えない |
| ローディングスピナーのみ表示 | CSR（クライアントサイドレンダリング）を使用している |
| Network タブに `/api/events` 等の XHR がある | 直接 JSON API を叩く方が確実 |

### Playwright 移行の手順（概要）

```bash
npm install playwright
npx playwright install chromium
```

`lib/moshicom/fetch.ts` の `fetchHtml()` を以下に差し替える（呼び出し側の変更は不要）:

```typescript
import { chromium } from 'playwright';

export async function fetchHtml(url: string): Promise<string | null> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'User-Agent': USER_AGENT });
    await page.goto(url, { timeout: REQUEST_TIMEOUT_MS, waitUntil: 'networkidle' });
    return await page.content();
  } catch (err) {
    console.error(`[playwright] Error: ${url}`, err);
    return null;
  } finally {
    await browser.close();
  }
}
```

> Vercel での Playwright 実行には `@sparticuz/chromium` が必要です。  
> ローカルや EC2 などの常設サーバーで実行する方が安定します。

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
│       ├── fetch.ts            # HTTP取得（Playwright移行の差し替えポイント）
│       ├── parse.ts            # cheerio HTML パース
│       ├── filters.ts          # 関西/スポーツ判定・キーワード検出
│       └── normalize.ts        # データ正規化・フラグ付与
├── supabase/
│   └── schema.sql              # DBスキーマ（Supabase SQL Editor に貼り付ける）
├── .env.local.example          # 環境変数テンプレート（プレースホルダーのみ）
├── package.json
├── vercel.json                 # Vercel Cron 設定（毎週月曜 02:00 UTC）
├── tailwind.config.ts
├── tsconfig.json
└── next.config.mjs
```
