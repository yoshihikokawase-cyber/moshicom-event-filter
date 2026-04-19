import { HIGH_VOLUME_ORGANIZER_THRESHOLD } from '../constants';
import type { NormalizeResult, ProcessedEventData, RawEventData } from '../types';
import { detectPrefecture, detectSportType, isKansai, isMemberRecruitment, isTargetSport } from './filters';
import { extractSourceId } from './parse';
import type { ParsedEventDetail } from './parse';

export function normalizeEvent(
  detail: ParsedEventDetail,
  url: string,
): NormalizeResult {
  // title が取れていない → パース失敗として扱う
  if (!detail.title) {
    return { shouldSave: false, reason: 'parse_incomplete', detail: 'missing title' };
  }

  // Kansai 判定は title + venue_or_area のみで行う。
  // description には他開催地の言及（「次回は京都でも開催」等）が含まれるケースがあり、
  // それを使うと非関西イベントが誤って通過する。
  const locationText = `${detail.title} ${detail.venue_or_area}`;

  if (!isKansai(locationText)) {
    // venue_or_area も空の場合は location 情報がパースできなかった可能性
    if (!detail.venue_or_area) {
      return { shouldSave: false, reason: 'parse_incomplete', detail: 'missing location' };
    }
    return { shouldSave: false, reason: 'non_kansai' };
  }

  // スポーツ種別判定は description も含める（種目情報が本文に書かれるケースを考慮）
  const sportText = `${detail.title} ${detail.venue_or_area} ${detail.description}`;

  if (!isTargetSport(sportText)) {
    return { shouldSave: false, reason: 'non_running' };
  }

  return {
    shouldSave: true,
    event: {
      source_id: extractSourceId(url),
      title: detail.title,
      event_url: url,
      event_date: detail.event_date,
      published_at: detail.published_at,
      // 都道府県も locationText から判定（description の他開催地名を除外）
      prefecture: detectPrefecture(locationText),
      venue_or_area: detail.venue_or_area,
      sport_type: detectSportType(sportText),
      organizer: detail.organizer,
      description: detail.description,
    },
  };
}

export function applyOrganizerStats(
  events: RawEventData[],
  scraped_at: string,
): ProcessedEventData[] {
  const counts = new Map<string, number>();

  for (const event of events) {
    const organizer = event.organizer.trim();
    if (!organizer) continue;

    counts.set(organizer, (counts.get(organizer) ?? 0) + 1);
  }

  return events.map((event) => {
    const organizer = event.organizer.trim();
    const organizer_post_count = organizer ? (counts.get(organizer) ?? 0) : 0;

    return {
      ...event,
      is_member_recruitment: isMemberRecruitment(event.title, event.description),
      organizer_post_count,
      is_high_volume_organizer:
        organizer_post_count > 0 && organizer_post_count >= HIGH_VOLUME_ORGANIZER_THRESHOLD,
      scraped_at,
    };
  });
}
