import { NextRequest, NextResponse } from 'next/server';
import {
  getEventsTotalCount,
  getLastScrapedAt,
  queryEvents,
} from '@/lib/db';
import type { EventFilters, SortOption } from '@/lib/types';

export const dynamic = 'force-dynamic';

const VALID_SORT_OPTIONS: SortOption[] = ['newest', 'event_date_asc', 'event_date_desc'];

function parseSortOption(raw: string | null): SortOption {
  if (raw && VALID_SORT_OPTIONS.includes(raw as SortOption)) {
    return raw as SortOption;
  }

  return 'newest';
}

function parseBoolean(raw: string | null, defaultValue: boolean): boolean {
  if (raw === null) return defaultValue;
  return raw !== 'false';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const filters: EventFilters = {
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      prefecture: searchParams.get('prefecture') ?? undefined,
      sport_type: searchParams.get('sport_type') ?? undefined,
      sort: parseSortOption(searchParams.get('sort')),
      exclude_member_recruitment: parseBoolean(
        searchParams.get('exclude_member_recruitment'),
        true,
      ),
      exclude_high_volume_organizers: parseBoolean(
        searchParams.get('exclude_high_volume_organizers'),
        false,
      ),
      exclude_excluded_organizers: parseBoolean(
        searchParams.get('exclude_excluded_organizers'),
        true,
      ),
    };

    const [events, last_scraped_at, saved_total] = await Promise.all([
      queryEvents(filters),
      getLastScrapedAt(),
      getEventsTotalCount(),
    ]);

    return NextResponse.json({
      events,
      total: events.length,
      saved_total,
      last_scraped_at,
    });
  } catch (error) {
    console.error('[GET /api/events] error:', error);
    return NextResponse.json(
      {
        events: [],
        total: 0,
        saved_total: 0,
        last_scraped_at: null,
        error: 'Internal server error',
      },
      { status: 500 },
    );
  }
}
