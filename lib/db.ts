import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  EventFilters,
  EventRecord,
  ExcludedOrganizerRecord,
  ProcessedEventData,
} from './types';

type MissingTableOptions = {
  ignoreMissingTable?: boolean;
};

type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase environment variables are missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
    global: {
      // Prevent Next.js server fetch caching from serving stale Supabase reads.
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '');
  }
  return '';
}

export function normalizeOrganizerName(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function isMissingExcludedOrganizersTableError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error && 'code' in error
      ? String((error as PostgrestLikeError).code ?? '')
      : '';
  const message = getErrorMessage(error);

  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    message.includes('public.excluded_organizers') ||
    message.includes('excluded_organizers')
  );
}

export async function upsertEvents(events: ProcessedEventData[]): Promise<number> {
  const client = createServiceClient();
  let upserted = 0;
  const batchSize = 50;

  for (let index = 0; index < events.length; index += batchSize) {
    const batch = events.slice(index, index + batchSize);

    const { error, count } = await client.from('events').upsert(batch, {
      onConflict: 'source_id',
      ignoreDuplicates: false,
      count: 'exact',
    });

    if (error) {
      console.error(`[db] upsert error (batch ${index / batchSize + 1}):`, error.message);

      for (const event of batch) {
        const { error: singleError } = await client
          .from('events')
          .upsert(event, { onConflict: 'source_id' });

        if (singleError) {
          console.error(`[db] single upsert error: ${event.source_id}`, singleError.message);
        } else {
          upserted += 1;
        }
      }

      continue;
    }

    upserted += count ?? batch.length;
  }

  return upserted;
}

export async function getEventsTotalCount(): Promise<number> {
  const client = createServiceClient();
  const { count, error } = await client.from('events').select('id', {
    count: 'exact',
    head: true,
  });

  if (error) {
    throw new Error(`[db] getEventsTotalCount error: ${error.message}`);
  }

  return count ?? 0;
}

export async function getExcludedOrganizers(
  options: MissingTableOptions = {},
): Promise<ExcludedOrganizerRecord[]> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('excluded_organizers')
    .select('id, organizer_name, created_at')
    .order('organizer_name', { ascending: true });

  if (error) {
    if (options.ignoreMissingTable && isMissingExcludedOrganizersTableError(error)) {
      return [];
    }

    throw new Error(`[db] getExcludedOrganizers error: ${error.message}`);
  }

  return (data ?? []) as ExcludedOrganizerRecord[];
}

export async function addExcludedOrganizer(
  organizerName: string,
): Promise<ExcludedOrganizerRecord> {
  const client = createServiceClient();
  const normalizedName = normalizeOrganizerName(organizerName);

  if (!normalizedName) {
    throw new Error('organizer_name is required.');
  }

  const { data, error } = await client
    .from('excluded_organizers')
    .upsert(
      { organizer_name: normalizedName },
      {
        onConflict: 'organizer_name',
        ignoreDuplicates: false,
      },
    )
    .select('id, organizer_name, created_at')
    .single();

  if (error) {
    throw new Error(`[db] addExcludedOrganizer error: ${error.message}`);
  }

  return data as ExcludedOrganizerRecord;
}

export async function removeExcludedOrganizer(organizerName: string): Promise<void> {
  const client = createServiceClient();
  const normalizedName = normalizeOrganizerName(organizerName);

  if (!normalizedName) {
    throw new Error('organizer_name is required.');
  }

  const { error } = await client
    .from('excluded_organizers')
    .delete()
    .eq('organizer_name', normalizedName);

  if (error) {
    throw new Error(`[db] removeExcludedOrganizer error: ${error.message}`);
  }
}

export async function queryEvents(filters: EventFilters): Promise<EventRecord[]> {
  const client = createServiceClient();
  let query = client.from('events').select('*');

  if (filters.from) {
    query = query.gte('event_date', filters.from);
  }

  if (filters.to) {
    query = query.lte('event_date', filters.to);
  }

  if (filters.prefecture) {
    query = query.eq('prefecture', filters.prefecture);
  }

  if (filters.sport_type) {
    query = query.eq('sport_type', filters.sport_type);
  }

  if (filters.exclude_member_recruitment) {
    query = query.eq('is_member_recruitment', false);
  }

  if (filters.exclude_high_volume_organizers) {
    query = query.eq('is_high_volume_organizer', false);
  }

  switch (filters.sort ?? 'newest') {
    case 'event_date_asc':
      query = query.order('event_date', { ascending: true, nullsFirst: false });
      break;
    case 'event_date_desc':
      query = query.order('event_date', { ascending: false, nullsFirst: false });
      break;
    case 'newest':
    default:
      query = query.order('scraped_at', { ascending: false });
      break;
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`[db] queryEvents error: ${error.message}`);
  }

  let events = (data ?? []) as EventRecord[];

  if (filters.exclude_excluded_organizers !== false) {
    const excludedOrganizers = await getExcludedOrganizers({ ignoreMissingTable: true });
    const excludedSet = new Set(
      excludedOrganizers
        .map((item) => normalizeOrganizerName(item.organizer_name))
        .filter(Boolean),
    );

    if (excludedSet.size > 0) {
      events = events.filter((event) => {
        const organizer = normalizeOrganizerName(event.organizer);
        return !organizer || !excludedSet.has(organizer);
      });
    }
  }

  return events;
}

export async function getLastScrapedAt(): Promise<string | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from('events')
    .select('scraped_at')
    .not('scraped_at', 'is', null)
    .order('scraped_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('[db] getLastScrapedAt error:', error.message);
    return null;
  }

  const rows = (data ?? []) as Array<Pick<EventRecord, 'scraped_at'>>;
  return rows[0]?.scraped_at ?? null;
}
