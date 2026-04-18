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
