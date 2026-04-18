// ─────────────────────────────────────────────────────────────
// app/api/admin/crawl/route.ts  — POST /api/admin/crawl
//
// 手動クロール実行用エンドポイント。
// ローカル開発・本番での手動実行に使う。
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { runCrawl } from '@/lib/moshicom/crawler';

// クロールは長時間かかる場合があるため動的レスポンスに設定
export const dynamic = 'force-dynamic';

// Vercel のデフォルト関数タイムアウトを延長（Pro プランなら最大 300s）
export const maxDuration = 300;

export async function POST() {
  try {
    console.log('[POST /api/admin/crawl] 手動クロール開始');
    const result = await runCrawl();

    console.log('[POST /api/admin/crawl] 完了:', result);

    return NextResponse.json({ result }, { status: 200 });
  } catch (err) {
    console.error('[POST /api/admin/crawl] エラー:', err);
    return NextResponse.json(
      {
        result: null,
        error: (err as Error).message ?? 'Internal server error',
      },
      { status: 500 },
    );
  }
}
