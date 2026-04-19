// ─────────────────────────────────────────────────────────────
// lib/moshicom/crawler.ts  — クロールオーケストレーター
//
// 処理フロー:
//   1. Playwright で一覧ページを巡回 → イベントURL[] を収集
//   2. URL を ParsedEventListItem[] に変換（メタデータは詳細ページで取得）
//   3. 詳細ページを fetch + cheerio で取得・パース
//   4. normalizeEvent → NormalizeResult（skip reason 付き）
//   5. applyOrganizerStats → ProcessedEventData[]
//   6. Supabase upsert
//   7. skip reason 別サマリをコンソール出力
// ─────────────────────────────────────────────────────────────

import type { CrawlResult, RawEventData, SkipReason } from '../types';
import { fetchHtml, randomWait } from './fetch';
import { parseEventDetail, normalizeDate, ParsedEventListItem } from './parse';
import { normalizeEvent, applyOrganizerStats } from './normalize';
import { isKansai, isTargetSport } from './filters';
import { upsertEvents } from '../db';
import { collectMoshicomEventUrlsWithPlaywright } from './playwright';

// ─── 一覧URL収集（Playwright） ────────────────────────────────

async function collectListItems(): Promise<ParsedEventListItem[]> {
  const maxPages = parseInt(process.env.MOSHICOM_MAX_PAGES ?? '20', 10);
  const maxEvents = parseInt(process.env.MOSHICOM_MAX_EVENTS ?? '500', 10);

  console.log(`[crawler] [Playwright] 一覧収集開始 maxPages=${maxPages} maxEvents=${maxEvents}`);

  const urls = await collectMoshicomEventUrlsWithPlaywright({ maxPages, maxEvents });

  console.log(`[crawler] [Playwright] → ${urls.length} URLs 収集`);

  return urls.map((url) => ({
    url,
    title: '',
    event_date_raw: '',
    location_raw: '',
    category_raw: '',
    organizer_raw: '',
  }));
}

// ─── リスト段階での事前フィルタ ──────────────────────────────

function preFilterListItems(items: ParsedEventListItem[]): ParsedEventListItem[] {
  return items.filter((item) => {
    const locationText = item.location_raw;
    const categoryText = (item.category_raw + ' ' + item.title).trim();

    if (locationText) {
      if (!isKansai(locationText)) {
        console.log(`[crawler]   preskip (非関西): ${item.title.slice(0, 30)} | ${locationText}`);
        return false;
      }
    }

    if (categoryText) {
      if (!isTargetSport(categoryText)) {
        console.log(`[crawler]   preskip (スポーツ外): ${item.title.slice(0, 30)} | ${item.category_raw}`);
        return false;
      }
    }

    return true;
  });
}

// ─── skip 理由集計 ────────────────────────────────────────────

type SkipStats = Record<SkipReason, number>;

function initSkipStats(): SkipStats {
  return {
    non_kansai: 0,
    non_running: 0,
    excluded_organizer: 0,
    parse_incomplete: 0,
    duplicate: 0,
    other: 0,
  };
}

function skipTotal(stats: SkipStats): number {
  return Object.values(stats).reduce((a, b) => a + b, 0);
}

function printSkipStats(stats: SkipStats): void {
  console.log(`[crawler]   skipped_non_kansai:         ${stats.non_kansai}`);
  console.log(`[crawler]   skipped_non_running:        ${stats.non_running}`);
  console.log(`[crawler]   skipped_parse_incomplete:   ${stats.parse_incomplete}`);
  console.log(`[crawler]   skipped_excluded_organizer: ${stats.excluded_organizer}`);
  console.log(`[crawler]   skipped_duplicate:          ${stats.duplicate}`);
  console.log(`[crawler]   skipped_other:              ${stats.other}`);
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

  // Step 2: リスト段階で事前フィルタ（Playwright収集ではメタデータが空なので実質スルー）
  console.log('[crawler] [Step 2] リスト段階の事前フィルタ');
  const preFiltered = preFilterListItems(allItems);
  const preSkipped = allItems.length - preFiltered.length;
  console.log(
    `[crawler]   → 事前フィルタ後: ${preFiltered.length} 件 (除外 ${preSkipped} 件)`
  );

  if (preFiltered.length === 0) {
    const hasLocationData = allItems.some((i) => i.location_raw !== '');
    if (!hasLocationData) {
      console.warn('[crawler]   location_raw が全件空。全件を詳細ページで判定します。');
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
  const total = preFiltered.length;
  console.log(`[crawler] [Step 3] 詳細ページ巡回 開始 (対象: ${total} 件)`);

  const rawEvents: RawEventData[] = [];
  const seenSourceIds = new Set<string>();
  const skipStats = initSkipStats();
  let detailFetchFailed = 0;
  let detailFetchOk = 0;
  let parseErrors = 0;

  for (let i = 0; i < total; i++) {
    const item = preFiltered[i];
    const pos = `[${i + 1}/${total}]`;

    // 20件ごとに中間サマリを出す
    if (i > 0 && i % 20 === 0) {
      console.log(
        `[crawler]   ── 中間サマリ ${pos}: fetch=${detailFetchOk} save=${rawEvents.length} skip=${skipTotal(skipStats)} err=${detailFetchFailed + parseErrors} ──`,
      );
    }

    const html = await fetchHtml(item.url);
    if (!html) {
      detailFetchFailed++;
      console.warn(`[crawler]   ${pos} fetch失敗: ${item.url}`);
      if (i < total - 1) await randomWait();
      continue;
    }
    detailFetchOk++;

    try {
      const detail = parseEventDetail(html);

      // 詳細ページで取れない場合はリスト値で補完
      if (!detail.title && item.title) detail.title = item.title;
      if (!detail.venue_or_area && item.location_raw) detail.venue_or_area = item.location_raw;
      if (!detail.organizer && item.organizer_raw) detail.organizer = item.organizer_raw;
      if (!detail.event_date && item.event_date_raw) {
        detail.event_date = normalizeDate(item.event_date_raw);
      }

      const result = normalizeEvent(detail, item.url);

      if (!result.shouldSave) {
        skipStats[result.reason]++;
        const reasonTag = result.detail ? `${result.reason}:${result.detail}` : result.reason;
        console.log(
          `[crawler]   ${pos} skip(${reasonTag}): "${(detail.title || '(no title)').slice(0, 28)}" | ${detail.venue_or_area || '(venue不明)'}`,
        );
      } else {
        const sourceId = result.event.source_id;
        if (seenSourceIds.has(sourceId)) {
          skipStats.duplicate++;
          console.log(`[crawler]   ${pos} skip(duplicate): source_id=${sourceId}`);
        } else {
          seenSourceIds.add(sourceId);
          rawEvents.push(result.event);
          console.log(
            `[crawler]   ${pos} save: "${result.event.title.slice(0, 28)}" | ${result.event.prefecture} | ${result.event.sport_type}`,
          );
        }
      }
    } catch (err) {
      parseErrors++;
      skipStats.other++;
      console.error(`[crawler]   ${pos} parseエラー: ${item.url}`, (err as Error).message);
    }

    if (i < total - 1) await randomWait();
  }

  const totalErrors = detailFetchFailed + parseErrors;

  console.log('[crawler] ──────────────────────────────────────────────');
  console.log(`[crawler] [Step 3] 詳細巡回 完了`);
  console.log(`[crawler]   detail fetch 対象:  ${total}`);
  console.log(`[crawler]   fetch 成功:         ${detailFetchOk}`);
  console.log(`[crawler]   fetch 失敗:         ${detailFetchFailed}`);
  console.log(`[crawler]   parse → save候補:   ${rawEvents.length}`);
  console.log(`[crawler]   parse → skip:       ${skipTotal(skipStats)}`);
  console.log(`[crawler]   parse 例外:         ${parseErrors}`);
  console.log('[crawler] ──────────────────────────────────────────────');

  if (rawEvents.length === 0) {
    printSummary(detailFetchOk, 0, skipStats, detailFetchFailed, parseErrors);
    return {
      fetched: total,
      upserted: 0,
      skipped: preSkipped + skipTotal(skipStats),
      errors: totalErrors,
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

  console.log('[crawler] ══════════════════════════════════════════════');
  console.log('[crawler] クロール 完了');
  console.log(`[crawler]   Playwright URL収集: ${total + preSkipped} → 詳細対象 ${total}`);
  console.log(`[crawler]   save (upserted):    ${upserted}`);
  console.log(`[crawler]   skip (非対象):      ${preSkipped + skipTotal(skipStats)}`);
  console.log(`[crawler]   error:              ${totalErrors}`);
  console.log(`[crawler]   所要時間:           ${(duration_ms / 1000).toFixed(1)}s`);
  console.log('[crawler] ══════════════════════════════════════════════');

  printSummary(detailFetchOk, upserted, skipStats, detailFetchFailed, parseErrors);

  return {
    fetched: total,
    upserted,
    skipped: preSkipped + skipTotal(skipStats),
    errors: totalErrors,
    duration_ms,
  };
}

// ─── 最終サマリ出力 ───────────────────────────────────────────

function printSummary(
  totalDetailFetched: number,
  saved: number,
  stats: SkipStats,
  detailFetchFailed: number,
  parseErrors: number,
): void {
  console.log('[crawler] ════════════════════════════════════════════');
  console.log('[crawler] === Crawl Summary ===');
  console.log(`[crawler] total_detail_fetched:       ${totalDetailFetched}`);
  console.log(`[crawler] saved:                      ${saved}`);
  printSkipStats(stats);
  console.log(`[crawler] detail_fetch_failed:        ${detailFetchFailed}`);
  console.log(`[crawler] parse_exceptions:           ${parseErrors}`);
  console.log('[crawler] ════════════════════════════════════════════');
}
