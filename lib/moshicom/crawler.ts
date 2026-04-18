// ─────────────────────────────────────────────────────────────
// lib/moshicom/crawler.ts  — クロールオーケストレーター
//
// 処理フロー:
//   1. 検索URL生成 (関西×スポーツキーワード 16クエリ)
//   2. 一覧ページ取得 → ParsedEventListItem[] を抽出
//   3. リスト段階で Kansai+スポーツを事前フィルタ (詳細ページ訪問を最小化)
//   4. URL 重複除去
//   5. 詳細ページ取得・パース
//   6. normalizeEvent → RawEventData
//   7. applyOrganizerStats → ProcessedEventData[]
//   8. Supabase upsert
//
// ページネーション:
//   モシコムのページリンクは href="#" (完全 JS 駆動) のため次ページ URL が取得できない。
//   複数の検索キーワード (SEARCH_KEYWORDS) で各20件を取得することで
//   カバレッジを補っている。Playwright 化すれば完全ページネーションが可能。
// ─────────────────────────────────────────────────────────────

import { SEARCH_URL, SEARCH_KEYWORDS, MAX_PAGES_PER_SEARCH } from '../constants';
import type { CrawlResult, RawEventData } from '../types';
import { fetchHtml, randomWait } from './fetch';
import { parseEventList, parseEventDetail, normalizeDate, ParsedEventListItem } from './parse';
import { normalizeEvent, applyOrganizerStats } from './normalize';
import { isKansai, isTargetSport } from './filters';
import { upsertEvents } from '../db';

// ─── 検索URL構築 ──────────────────────────────────────────────

/**
 * 検索URLリストを構築する。
 *
 * 【新着順の実現方法】
 * ?sort=new を付与。効かない場合は一覧表示順をそのまま採用する。
 * DB 保存後は scraped_at DESC でソートするため最終的に新着順になる。
 */
function buildSearchUrls(): string[] {
  return SEARCH_KEYWORDS.map((kw) => {
    const params = new URLSearchParams({ keyword: kw, sort: 'new' });
    return `${SEARCH_URL}?${params.toString()}`;
  });
}

// ─── リスト段階での事前フィルタ ──────────────────────────────

/**
 * 一覧ページで取得したアイテムを Kansai + スポーツ で事前フィルタする。
 * location_raw / category_raw / title が空の場合はフィルタをスキップし
 * 詳細ページに判断を委ねる（情報なし = 除外しない）。
 */
function preFilterListItems(items: ParsedEventListItem[]): ParsedEventListItem[] {
  return items.filter((item) => {
    const locationText = item.location_raw;
    const categoryText = item.category_raw + ' ' + item.title;

    // location が取れていれば Kansai チェック
    if (locationText) {
      if (!isKansai(locationText)) {
        console.log(`[crawler]   preskip (非関西): ${item.title.slice(0, 30)} | ${locationText}`);
        return false;
      }
    }

    // category / title が取れていればスポーツチェック
    if (categoryText.trim()) {
      if (!isTargetSport(categoryText)) {
        console.log(`[crawler]   preskip (スポーツ外): ${item.title.slice(0, 30)} | ${item.category_raw}`);
        return false;
      }
    }

    return true;
  });
}

// ─── 一覧ページからアイテム収集 ──────────────────────────────

async function collectListItems(): Promise<ParsedEventListItem[]> {
  const allItems = new Map<string, ParsedEventListItem>(); // url → item
  const searchUrls = buildSearchUrls();

  console.log(`[crawler] 検索クエリ数: ${searchUrls.length}`);

  for (const searchUrl of searchUrls) {
    console.log(`[crawler] 検索URL: ${searchUrl}`);
    let currentUrl: string | null = searchUrl;
    let page = 1;

    while (currentUrl && page <= MAX_PAGES_PER_SEARCH) {
      const html = await fetchHtml(currentUrl);
      if (!html) {
        console.warn(`[crawler]   ページ取得失敗 (page ${page}): ${currentUrl}`);
        break;
      }

      const { items, nextPageUrl } = parseEventList(html, currentUrl);

      // raw links count のログ
      console.log(`[crawler]   raw links count: ${items.length} (page ${page})`);

      const newCount = items.filter((i) => !allItems.has(i.url)).length;
      items.forEach((i) => { if (!allItems.has(i.url)) allItems.set(i.url, i); });

      console.log(`[crawler]   新規 ${newCount} 件 / 累計 ${allItems.size} 件`);

      if (items.length === 0) {
        console.warn('[crawler]   イベント 0件。.event-card セレクタ要確認。');
        break;
      }
      if (newCount === 0) {
        console.log('[crawler]   新規なし。このクエリ終了');
        break;
      }

      // ページネーションは JS 駆動のため nextPageUrl は常に null
      currentUrl = nextPageUrl;
      page++;

      if (currentUrl) await randomWait();
    }

    await randomWait(); // 検索クエリ間の待機
  }

  return Array.from(allItems.values());
}

// ─── メイン実行 ───────────────────────────────────────────────

export async function runCrawl(): Promise<CrawlResult> {
  const startTime = Date.now();
  const scraped_at = new Date().toISOString();

  console.log('[crawler] ===== クロール開始 =====');

  // Step 1: 一覧ページからアイテム収集
  console.log('[crawler] [Step 1] 一覧ページ収集');
  const allItems = await collectListItems();
  console.log(`[crawler]   → 収集アイテム数: ${allItems.length} 件`);

  if (allItems.length === 0) {
    console.warn('[crawler] アイテム 0件。HTML構造が変わっている可能性があります。');
    return { fetched: 0, upserted: 0, skipped: 0, errors: 0, duration_ms: Date.now() - startTime };
  }

  // Step 2: リスト段階で事前フィルタ（非関西・非スポーツを除外）
  console.log('[crawler] [Step 2] リスト段階の事前フィルタ');
  const preFiltered = preFilterListItems(allItems);
  const preSkipped = allItems.length - preFiltered.length;
  console.log(
    `[crawler]   → 事前フィルタ後: ${preFiltered.length} 件 (除外 ${preSkipped} 件)`
  );

  if (preFiltered.length === 0) {
    // location_raw / category_raw が全て空 → フィルタが効いていない
    // この場合は全件を詳細ページで判定する
    const hasLocationData = allItems.some((i) => i.location_raw !== '');
    if (!hasLocationData) {
      console.warn('[crawler]   location_raw が全件空。セレクタ確認が必要です。全件を詳細ページで判定します。');
      preFiltered.push(...allItems);
    } else {
      console.warn('[crawler]   関西×スポーツ条件に一致するアイテムがありません。');
      return {
        fetched: allItems.length,
        upserted: 0,
        skipped: allItems.length,
        errors: 0,
        duration_ms: Date.now() - startTime,
      };
    }
  }

  // Step 3: 詳細ページを巡回してパース
  console.log(`[crawler] [Step 3] 詳細ページ巡回 (${preFiltered.length} 件)`);
  const rawEvents: RawEventData[] = [];
  let errors = 0;
  let skipped = 0;

  for (let i = 0; i < preFiltered.length; i++) {
    const item = preFiltered[i];
    console.log(`[crawler]   [${i + 1}/${preFiltered.length}] ${item.url}`);

    const html = await fetchHtml(item.url);
    if (!html) {
      errors++;
      if (i < preFiltered.length - 1) await randomWait();
      continue;
    }

    try {
      const detail = parseEventDetail(html);

      // 詳細ページでも title が取れない場合はリスト値で補完
      if (!detail.title && item.title) detail.title = item.title;
      if (!detail.venue_or_area && item.location_raw) detail.venue_or_area = item.location_raw;
      if (!detail.organizer && item.organizer_raw) detail.organizer = item.organizer_raw;
      if (!detail.event_date && item.event_date_raw) {
        detail.event_date = normalizeDate(item.event_date_raw);
      }

      const raw = normalizeEvent(detail, item.url);

      if (raw === null) {
        skipped++;
        console.log(`[crawler]   → 詳細フィルタ除外: ${detail.title.slice(0, 30)} | ${detail.venue_or_area}`);
      } else {
        rawEvents.push(raw);
        console.log(
          `[crawler]   → 取得: ${raw.title.slice(0, 30)} | ${raw.prefecture} | ${raw.sport_type}`
        );
      }
    } catch (err) {
      console.error(`[crawler]   パースエラー: ${item.url}`, (err as Error).message);
      errors++;
    }

    if (i < preFiltered.length - 1) await randomWait();
  }

  // final fetched のログ
  console.log(
    `[crawler] [Step 3] 完了: final fetched=${rawEvents.length} / skipped=${skipped} / errors=${errors}`
  );

  if (rawEvents.length === 0) {
    return {
      fetched: preFiltered.length,
      upserted: 0,
      skipped: preSkipped + skipped,
      errors,
      duration_ms: Date.now() - startTime,
    };
  }

  // Step 4: フラグ付与・主催者集計
  console.log('[crawler] [Step 4] フラグ付与・主催者集計');
  const processed = applyOrganizerStats(rawEvents, scraped_at);

  // Step 5: DB upsert
  console.log(`[crawler] [Step 5] DB upsert (${processed.length} 件)`);
  const upserted = await upsertEvents(processed);

  const duration_ms = Date.now() - startTime;
  console.log(
    `[crawler] ===== 完了 ===== upserted=${upserted} duration=${duration_ms}ms`
  );

  return {
    fetched: preFiltered.length,
    upserted,
    skipped: preSkipped + skipped,
    errors,
    duration_ms,
  };
}
