// ─────────────────────────────────────────────────────────────
// lib/moshicom/fetch.ts  — HTTP取得レイヤー
//
// Playwright への移行は、このファイルの fetchHtml() を
// Playwright 実装に差し替えるだけで対応できる構造にしている。
// ─────────────────────────────────────────────────────────────

import { USER_AGENT, REQUEST_TIMEOUT_MS, WAIT_MIN_MS, WAIT_MAX_MS } from '../constants';

/** 1〜3秒のランダム待機（高頻度アクセス防止） */
export async function randomWait(): Promise<void> {
  const ms = Math.floor(Math.random() * (WAIT_MAX_MS - WAIT_MIN_MS) + WAIT_MIN_MS);
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * 指定URLのHTMLを取得して文字列で返す。
 * タイムアウト・HTTPエラー・ネットワークエラー時は null を返す。
 *
 * Playwright 移行時はこの関数のシグネチャを維持したまま
 * 内部実装を差し替えること（呼び出し側の変更不要）。
 */
export async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      signal: controller.signal,
      // Next.js のキャッシュを無効化（クロール時は常に最新を取得）
      cache: 'no-store',
    });

    clearTimeout(timer);

    if (!response.ok) {
      console.warn(`[fetch] HTTP ${response.status}: ${url}`);
      return null;
    }

    return await response.text();
  } catch (err) {
    clearTimeout(timer);
    const name = (err as Error).name;
    if (name === 'AbortError') {
      console.warn(`[fetch] Timeout (${REQUEST_TIMEOUT_MS}ms): ${url}`);
    } else {
      console.error(`[fetch] Error: ${url}`, (err as Error).message);
    }
    return null;
  }
}
