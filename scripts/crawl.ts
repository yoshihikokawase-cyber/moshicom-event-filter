// ─────────────────────────────────────────────────────────────
// scripts/crawl.ts  — スタンドアロン クロール実行スクリプト
//
// 実行方法:
//   npm run crawl
//
// ローカルでの環境変数の読み込み:
//   .env.local が自動で読み込まれます。
//   GitHub Actions では secrets.* から環境変数が設定されます。
// ─────────────────────────────────────────────────────────────

import { config } from 'dotenv';
import { resolve } from 'path';

// ローカル実行時に .env.local を読み込む（GitHub Actions では不要・無害）
config({ path: resolve(process.cwd(), '.env.local') });

import { runCrawl } from '../lib/moshicom/crawler';

async function main(): Promise<void> {
  console.log('[crawl] ===== スクリプト起動 =====');
  console.log(`[crawl] 実行日時: ${new Date().toISOString()}`);

  try {
    const result = await runCrawl();
    console.log('[crawl] ===== 完了 =====');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('[crawl] ===== 失敗 =====');
    console.error(err);
    process.exit(1);
  }
}

main();
