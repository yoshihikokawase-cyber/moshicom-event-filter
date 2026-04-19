export type SortOption = 'newest' | 'event_date_asc' | 'event_date_desc';

export interface EventRecord {
  id: string;
  source_id: string;
  title: string;
  event_url: string;
  event_date: string | null;
  published_at: string | null;
  prefecture: string;
  venue_or_area: string;
  sport_type: string;
  organizer: string;
  description: string;
  is_member_recruitment: boolean;
  organizer_post_count: number;
  is_high_volume_organizer: boolean;
  scraped_at: string;
  created_at: string;
  updated_at: string;
}

export interface RawEventData {
  source_id: string;
  title: string;
  event_url: string;
  event_date: string | null;
  published_at: string | null;
  prefecture: string;
  venue_or_area: string;
  sport_type: string;
  organizer: string;
  description: string;
}

export interface ProcessedEventData extends RawEventData {
  is_member_recruitment: boolean;
  organizer_post_count: number;
  is_high_volume_organizer: boolean;
  scraped_at: string;
}

export interface EventFilters {
  from?: string;
  to?: string;
  prefecture?: string;
  sport_type?: string;
  sort?: SortOption;
  exclude_member_recruitment?: boolean;
  exclude_high_volume_organizers?: boolean;
  exclude_excluded_organizers?: boolean;
}

export interface CrawlResult {
  fetched: number;
  upserted: number;
  skipped: number;
  errors: number;
  duration_ms: number;
}

/**
 * save されなかったイベントの理由分類。
 * - non_kansai         : 関西エリア外のイベント
 * - non_running        : ランニング・トレイル系でないイベント
 * - excluded_organizer : 除外主催者リストに登録された主催者（現在はクロール時フィルタなし、常に0）
 * - parse_incomplete   : title/location が取得できなかったパース失敗
 * - duplicate          : 同一クロール内で同一 source_id が重複（通常0）
 * - other              : parseEventDetail 例外など上記以外
 */
export type SkipReason =
  | 'non_kansai'
  | 'non_running'
  | 'excluded_organizer'
  | 'parse_incomplete'
  | 'duplicate'
  | 'other';

/**
 * normalizeEvent() の返却型。
 * shouldSave: true  → event フィールドに正規化済みデータ
 * shouldSave: false → reason で skip 理由を返す。detail は補助情報（任意）
 */
export type NormalizeResult =
  | { shouldSave: true; event: RawEventData }
  | { shouldSave: false; reason: SkipReason; detail?: string };

export interface ExcludedOrganizerRecord {
  id: string;
  organizer_name: string;
  created_at: string;
}

export interface EventsApiResponse {
  events: EventRecord[];
  total: number;
  saved_total: number;
  last_scraped_at: string | null;
}

export interface ExcludedOrganizersApiResponse {
  organizers: ExcludedOrganizerRecord[];
  total: number;
  ready: boolean;
  error?: string;
}

export interface ExcludedOrganizerMutationResponse {
  organizer: string;
  ready: boolean;
  error?: string;
}

export interface CrawlApiResponse {
  result: CrawlResult | null;
  error?: string;
}
