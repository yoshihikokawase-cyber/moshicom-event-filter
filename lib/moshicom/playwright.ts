// ─────────────────────────────────────────────────────────────
// lib/moshicom/playwright.ts  — Playwright による一覧URL収集
//
// 責務: Moshicom 検索結果ページを Playwright でページネーション巡回し、
//       イベントURLのリストを返す。詳細取得は行わない。
//
// ページネーション方式: URL直叩き (?page=N)
//   モシコムは href="#" の JS 駆動ページネーションのため、
//   クリック方式ではなく &page=N を URL に付与して直接 goto する。
//
// 統合先: lib/moshicom/crawler.ts の collectListItems() から呼ばれる。
// ─────────────────────────────────────────────────────────────

import { chromium, Page } from 'playwright';
import { SEARCH_KEYWORDS, SEARCH_URL, USER_AGENT, REQUEST_TIMEOUT_MS } from '../constants';

/** 環境変数 MOSHICOM_MAX_PAGES でオーバーライド可能 */
const DEFAULT_MAX_PAGES = parseInt(process.env.MOSHICOM_MAX_PAGES ?? '20', 10);

/** 環境変数 MOSHICOM_MAX_EVENTS でオーバーライド可能 */
const DEFAULT_MAX_EVENTS = parseInt(process.env.MOSHICOM_MAX_EVENTS ?? '500', 10);

/**
 * 次ページクリック後のコンテンツ更新待機 (ms)
 * URL直叩き後の networkidle 待機で代替するため現在は未使用。
 * フォールバック用に定義のみ保持。
 */
const RESULT_READY_SELECTOR = 'a[href]';
const RESULT_READY_TIMEOUT_MS = 3_000;

/** 検索キーワード間の待機 (ms) */
const BETWEEN_SEARCHES_WAIT_MS = 3_000;

// ─── URL 判定・正規化 ─────────────────────────────────────────

/** Playwright が返す絶対URLのうち moshicom イベントURLかどうか判定 */
function isEventAbsoluteUrl(href: string): boolean {
  return /https?:\/\/moshicom\.com\/\d{4,}(?:\?|\/|$)/.test(href);
}

/** クエリパラメータとトレイリングスラッシュを除去して正規化 */
function canonicalUrl(href: string): string {
  return href.split('?')[0].replace(/\/$/, '');
}

// ─── ページからURLを抽出 ──────────────────────────────────────

async function extractUrlsFromCurrentPage(page: Page): Promise<string[]> {
  const hrefs: string[] = await page.$$eval('a[href]', (els) =>
    (els as HTMLAnchorElement[]).map((a) => a.href),
  );

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const href of hrefs) {
    if (!isEventAbsoluteUrl(href)) continue;
    const url = canonicalUrl(href);
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

// ─── 1キーワードのページ巡回（URL直叩き） ────────────────────

/**
 * 1検索キーワードで最大 maxPages ページ分のURLを収集する。
 * ?page=N を付与して各ページに直接 goto する方式。
 * 新規URLがなくなった場合に終了。
 */
async function collectUrlsForKeyword(
  page: Page,
  keyword: string,
  keywordIndex: number,
  totalKeywords: number,
  maxPages: number,
  allUrls: Set<string>,
  maxEvents: number,
): Promise<{ pagesScraped: number; urlsAdded: number }> {
  const kwTag = `[${keywordIndex + 1}/${totalKeywords}]`;

  console.log(`[playwright] ──────────────────────────────────────`);
  console.log(`[playwright] キーワード${kwTag} 開始: "${keyword}"`);
  console.log(`[playwright]   累計URL: ${allUrls.size} / 上限 ${maxEvents}`);

  let pagesScraped = 0;
  let urlsAddedThisKeyword = 0;

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    if (allUrls.size >= maxEvents) {
      console.log(`[playwright]   maxEvents(${maxEvents}) 到達。このキーワードの収集を終了`);
      break;
    }

    // ?page=N を付与してURLを生成（1ページ目は page パラメータなし）
    const params = new URLSearchParams({ keyword, sort: 'new' });
    if (pageNum > 1) params.set('page', String(pageNum));
    const pageUrl = `${SEARCH_URL}?${params.toString()}`;

    try {
      await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: REQUEST_TIMEOUT_MS });
    } catch (err) {
      console.warn(`[playwright]   page ${pageNum}: goto失敗:`, (err as Error).message);
      break;
    }

    try {
      await page.waitForSelector(RESULT_READY_SELECTOR, { timeout: RESULT_READY_TIMEOUT_MS });
    } catch {
      console.warn(`[playwright]   page ${pageNum}: コンテンツ待機タイムアウト（続行）`);
    }

    const pageUrls = await extractUrlsFromCurrentPage(page);
    const prevSize = allUrls.size;
    pageUrls.forEach((u) => allUrls.add(u));
    const newCount = allUrls.size - prevSize;
    urlsAddedThisKeyword += newCount;
    pagesScraped++;

    console.log(
      `[playwright]   page ${pageNum}: 抽出 ${pageUrls.length} URLs | 新規 +${newCount} | 累計 ${allUrls.size}`,
    );

    if (pageUrls.length === 0) {
      console.log(`[playwright]   page ${pageNum}: URL 0件 → 終了`);
      break;
    }
    if (newCount === 0) {
      console.log(`[playwright]   page ${pageNum}: 新規URL無し → このキーワードの収集終了`);
      break;
    }
    if (pageNum >= maxPages) {
      console.log(`[playwright]   maxPages(${maxPages}) 到達 → このキーワードの収集終了`);
      break;
    }
  }

  console.log(
    `[playwright] キーワード${kwTag} 完了: "${keyword}" → ${pagesScraped}ページ巡回 / +${urlsAddedThisKeyword} URL追加`,
  );

  return { pagesScraped, urlsAdded: urlsAddedThisKeyword };
}

// ─── メインエクスポート ───────────────────────────────────────

/**
 * Playwright で Moshicom 検索結果一覧を巡回し、イベントURLを収集して返す。
 *
 * 一覧URL収集専用。詳細ページの取得・パースは caller 側（crawler.ts）で行う。
 *
 * @param params.maxPages  1キーワードあたりの最大ページ数。環境変数 MOSHICOM_MAX_PAGES で上書き可能。
 * @param params.maxEvents 収集URL総数の上限。環境変数 MOSHICOM_MAX_EVENTS で上書き可能。
 */
export async function collectMoshicomEventUrlsWithPlaywright(params?: {
  maxPages?: number;
  maxEvents?: number;
}): Promise<string[]> {
  const maxPages = params?.maxPages ?? DEFAULT_MAX_PAGES;
  const maxEvents = params?.maxEvents ?? DEFAULT_MAX_EVENTS;

  console.log('[playwright] ══════════════════════════════════════════');
  console.log('[playwright] Playwright 一覧収集 開始');
  console.log(`[playwright]   キーワード数: ${SEARCH_KEYWORDS.length}`);
  console.log(`[playwright]   maxPages: ${maxPages} / maxEvents: ${maxEvents}`);
  console.log('[playwright] ══════════════════════════════════════════');

  const allUrls = new Set<string>();
  let totalPagesScraped = 0;

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: 'ja-JP',
      extraHTTPHeaders: {
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
      },
    });

    const page = await context.newPage();

    for (let ki = 0; ki < SEARCH_KEYWORDS.length; ki++) {
      const keyword = SEARCH_KEYWORDS[ki];

      if (allUrls.size >= maxEvents) {
        console.log(`[playwright] maxEvents(${maxEvents}) 到達。残りキーワードをスキップ`);
        break;
      }

      try {
        const { pagesScraped } = await collectUrlsForKeyword(
          page,
          keyword,
          ki,
          SEARCH_KEYWORDS.length,
          maxPages,
          allUrls,
          maxEvents,
        );
        totalPagesScraped += pagesScraped;
      } catch (err) {
        console.error(
          `[playwright] キーワード "${keyword}" で予期しないエラー:`,
          (err as Error).message,
        );
      }

      await page.waitForTimeout(BETWEEN_SEARCHES_WAIT_MS);
    }

    await context.close();
  } finally {
    await browser.close();
  }

  console.log('[playwright] ══════════════════════════════════════════');
  console.log('[playwright] Playwright 一覧収集 完了');
  console.log(`[playwright]   総URL数:      ${allUrls.size}`);
  console.log(`[playwright]   総ページ巡回: ${totalPagesScraped}`);
  console.log('[playwright] ══════════════════════════════════════════');

  return Array.from(allUrls);
}
