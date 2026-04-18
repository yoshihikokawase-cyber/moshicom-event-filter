// ─────────────────────────────────────────────────────────────
// lib/moshicom/playwright.ts  — Playwright による一覧URL収集
//
// 責務: Moshicom 検索結果ページを Playwright でページネーション巡回し、
//       イベントURLのリストを返す。詳細取得は行わない。
//
// 統合先: lib/moshicom/crawler.ts の collectListItems() から呼ばれる。
// ─────────────────────────────────────────────────────────────

import { chromium, Page } from 'playwright';
import { SEARCH_KEYWORDS, SEARCH_URL, USER_AGENT, REQUEST_TIMEOUT_MS } from '../constants';

/** 環境変数 MOSHICOM_MAX_PAGES でオーバーライド可能 */
const DEFAULT_MAX_PAGES = parseInt(process.env.MOSHICOM_MAX_PAGES ?? '20', 10);

/** 環境変数 MOSHICOM_MAX_EVENTS でオーバーライド可能 */
const DEFAULT_MAX_EVENTS = parseInt(process.env.MOSHICOM_MAX_EVENTS ?? '500', 10);

/** 次ページクリック後のコンテンツ更新待機 (ms) */
const AFTER_CLICK_WAIT_MS = 2_500;

/**
 * 検索結果一覧に出現する確実なセレクタ。
 * モシコムは `.event-card` を使わないため `a[href]` で代用。
 * `waitUntil: networkidle` 後に呼ぶので短いタイムアウトで十分。
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

// ─── デバッグ: ページネーションDOM出力 ───────────────────────

/**
 * ページネーション周辺のHTMLをログ出力する。
 * 「1ページ目で次ページなし」のときに呼んで DOM を確認するためのデバッグ補助。
 */
async function debugLogPaginationArea(page: Page): Promise<void> {
  console.log('[playwright:debug] ─── ページネーション DOM 確認 ───────────────────');

  try {
    // ① pagination 専用要素を優先して取得
    const paginationHtml: string | null = await page.evaluate(() => {
      const candidates = [
        '.pagination',
        '.pager',
        '[class*="pagination"]',
        '[class*="pager"]',
        'nav[aria-label*="ページ"]',
        'nav[aria-label*="page"]',
        'nav',
      ];
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el) return `[${sel}] ${el.outerHTML}`;
      }
      return null;
    });

    if (paginationHtml) {
      console.log('[playwright:debug] pagination要素:');
      // 2000文字で打ち切り
      console.log(paginationHtml.slice(0, 2000));
      if (paginationHtml.length > 2000) {
        console.log(`[playwright:debug] ... (${paginationHtml.length - 2000} 文字省略)`);
      }
    } else {
      console.log('[playwright:debug] pagination専用要素が見つかりません。');
    }

    // ② ページ番号・次ページ候補リンクを列挙
    const candidateLinks: string[] = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a'))
        .filter((a) => {
          const t = (a.textContent ?? '').trim();
          const h = a.getAttribute('href') ?? '';
          return (
            /^\d+$/.test(t) ||
            t.includes('次') ||
            t.includes('前') ||
            t.includes('>') ||
            t.includes('<') ||
            t.includes('Next') ||
            t.includes('Prev') ||
            h.includes('page') ||
            h.includes('p=')
          );
        })
        .slice(0, 30)
        .map((a) => `  href="${a.getAttribute('href')}" text="${(a.textContent ?? '').trim()}" class="${a.className}"`);
    });

    if (candidateLinks.length > 0) {
      console.log('[playwright:debug] ページ送り候補リンク:');
      candidateLinks.forEach((l) => console.log(l));
    } else {
      console.log('[playwright:debug] ページ送り候補リンクが見つかりません（1ページのみのコンテンツか、完全JS生成の可能性）。');
    }

    // ③ 現在のURL確認
    console.log(`[playwright:debug] 現在のURL: ${page.url()}`);
    console.log('[playwright:debug] ─────────────────────────────────────────────────');
  } catch (err) {
    console.warn('[playwright:debug] DOM取得エラー:', (err as Error).message);
  }
}

// ─── 次ページへの移動 ─────────────────────────────────────────

/**
 * 次ページへ移動する。
 * モシコムのページネーションは href="#" の JS 駆動のため、
 * 複数のセレクタ戦略を順に試みる。
 * 成功したセレクタ名を返す（失敗時は null）。
 */
async function navigateToNextPage(
  page: Page,
  currentPageNum: number,
): Promise<{ success: boolean; matchedSelector: string | null }> {
  const nextNum = currentPageNum + 1;

  // セレクタ候補（優先順）
  const selectorCandidates = [
    `a[rel="next"]`,
    `.pagination .next a`,
    `.pagination a.next`,
    `.pager .next a`,
    `a:has-text("次のページ")`,
    `a:has-text("次へ")`,
    `.pagination a:has-text("次")`,
    `.pager a:has-text("次")`,
    `.pagination a:has-text(">")`,
    `[data-page="${nextNum}"]`,
  ];

  for (const selector of selectorCandidates) {
    try {
      const el = await page.$(selector);
      if (!el) continue;
      if (!(await el.isVisible())) {
        console.log(`[playwright:nav]   ${selector} → 存在するが非表示`);
        continue;
      }
      await el.click();
      await page.waitForTimeout(AFTER_CLICK_WAIT_MS);
      return { success: true, matchedSelector: selector };
    } catch {
      // このセレクタは使えない。次を試す。
    }
  }

  // ページ番号テキストで直接マッチ（.pagination 内の数値リンク）
  try {
    const pageLinks = await page.$$('.pagination a, .pager a');
    for (const link of pageLinks) {
      const text = (await link.textContent())?.trim();
      if (text === String(nextNum)) {
        await link.click();
        await page.waitForTimeout(AFTER_CLICK_WAIT_MS);
        return { success: true, matchedSelector: `text="${nextNum}"` };
      }
    }
  } catch {
    // pagination リンクが存在しないページ
  }

  return { success: false, matchedSelector: null };
}

// ─── 1キーワードのページ巡回 ─────────────────────────────────

/**
 * 1検索キーワードで最大 maxPages ページ分のURLを収集する。
 * 新規URLがなくなったか次ページが見つからない場合に終了。
 */
async function collectUrlsForKeyword(
  page: Page,
  keyword: string,
  keywordIndex: number,
  totalKeywords: number,
  maxPages: number,
  allUrls: Set<string>,
  maxEvents: number,
  debugState: { fired: boolean },
): Promise<{ pagesScraped: number; urlsAdded: number }> {
  const params = new URLSearchParams({ keyword, sort: 'new' });
  const searchUrl = `${SEARCH_URL}?${params.toString()}`;
  const kwTag = `[${keywordIndex + 1}/${totalKeywords}]`;

  console.log(`[playwright] ──────────────────────────────────────`);
  console.log(`[playwright] キーワード${kwTag} 開始: "${keyword}"`);
  console.log(`[playwright]   URL: ${searchUrl}`);
  console.log(`[playwright]   累計URL: ${allUrls.size} / 上限 ${maxEvents}`);

  try {
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: REQUEST_TIMEOUT_MS });
  } catch (err) {
    console.warn(`[playwright] キーワード${kwTag} ページ遷移失敗:`, (err as Error).message);
    return { pagesScraped: 0, urlsAdded: 0 };
  }

  let pagesScraped = 0;
  let urlsAddedThisKeyword = 0;

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    if (allUrls.size >= maxEvents) {
      console.log(`[playwright]   maxEvents(${maxEvents}) 到達。このキーワードの収集を終了`);
      break;
    }

    // ページ内容の準備を確認（networkidle 後なので短時間で十分）
    // モシコム検索結果ページは .event-card クラスを持たないため a[href] で代用
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
      console.warn(`[playwright]   page ${pageNum}: URLが0件 → .event-card セレクタ要確認`);
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

    // 次ページへ移動
    const { success, matchedSelector } = await navigateToNextPage(page, pageNum);

    if (success) {
      console.log(`[playwright]   page ${pageNum} → ${pageNum + 1}: クリック成功 (selector: ${matchedSelector})`);
    } else {
      console.log(`[playwright]   page ${pageNum}: 次ページなし（全セレクタ不一致）`);
      // ページネーション構造の確認（セッション全体で最初の1回のみ）
      if (pageNum === 1 && !debugState.fired) {
        debugState.fired = true;
        await debugLogPaginationArea(page);
      }
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
    const debugState = { fired: false };

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
          debugState,
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
