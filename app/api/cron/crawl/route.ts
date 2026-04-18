// ─────────────────────────────────────────────────────────────
// app/api/cron/crawl/route.ts  — GET /api/cron/crawl
//
// Vercel Cron Jobs から週1回呼び出されるエンドポイント。
// Authorization ヘッダーで CRON_SECRET を検証する簡易認証付き。
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { runCrawl } from '@/lib/moshicom/crawler';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // ─── 簡易認証 ──────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[cron/crawl] CRON_SECRET が未設定です');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const authHeader = request.headers.get('Authorization');
  const expectedToken = `Bearer ${cronSecret}`;

  if (authHeader !== expectedToken) {
    console.warn('[cron/crawl] 認証失敗: Authorization ヘッダーが不正');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ─── クロール実行 ───────────────────────────────────────────
  try {
    console.log('[GET /api/cron/crawl] Cron クロール開始');
    const result = await runCrawl();

    console.log('[GET /api/cron/crawl] 完了:', result);

    return NextResponse.json({ result }, { status: 200 });
  } catch (err) {
    console.error('[GET /api/cron/crawl] エラー:', err);
    return NextResponse.json(
      {
        result: null,
        error: (err as Error).message ?? 'Internal server error',
      },
      { status: 500 },
    );
  }
}
