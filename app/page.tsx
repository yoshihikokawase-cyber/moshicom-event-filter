'use client';

import { useEffect, useState } from 'react';
import { KANSAI_PREFECTURES, SPORT_KEYWORDS } from '@/lib/constants';
import type {
  CrawlApiResponse,
  EventRecord,
  EventsApiResponse,
  ExcludedOrganizerRecord,
  ExcludedOrganizersApiResponse,
  SortOption,
} from '@/lib/types';

type FilterState = {
  from: string;
  to: string;
  prefecture: string;
  sport_type: string;
  sort: SortOption;
  exclude_member_recruitment: boolean;
  exclude_high_volume_organizers: boolean;
  exclude_excluded_organizers: boolean;
};

const DEFAULT_FILTERS: FilterState = {
  from: '',
  to: '',
  prefecture: '',
  sport_type: '',
  sort: 'newest',
  exclude_member_recruitment: true,
  exclude_high_volume_organizers: false,
  exclude_excluded_organizers: true,
};

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'newest', label: '新着順' },
  { value: 'event_date_asc', label: '開催日が近い順' },
  { value: 'event_date_desc', label: '開催日が遠い順' },
];

function buildQueryString(filters: FilterState): string {
  const params = new URLSearchParams();

  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.prefecture) params.set('prefecture', filters.prefecture);
  if (filters.sport_type) params.set('sport_type', filters.sport_type);
  params.set('sort', filters.sort);
  params.set('exclude_member_recruitment', String(filters.exclude_member_recruitment));
  params.set(
    'exclude_high_volume_organizers',
    String(filters.exclude_high_volume_organizers),
  );
  params.set(
    'exclude_excluded_organizers',
    String(filters.exclude_excluded_organizers),
  );

  return params.toString();
}

function formatDate(value: string | null): string {
  if (!value) return '未設定';

  try {
    return new Date(value).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return value;
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return '未取得';

  try {
    return new Date(value).toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function isNew(scrapedAt: string): boolean {
  const now = Date.now();
  const target = new Date(scrapedAt).getTime();
  return Number.isFinite(target) && now - target < 7 * 24 * 60 * 60 * 1000;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '不明なエラーが発生しました。';
}

function getSortLabel(sort: SortOption): string {
  return SORT_OPTIONS.find((option) => option.value === sort)?.label ?? '新着順';
}

function buildActiveTags(filters: FilterState): string[] {
  const tags: string[] = [];

  if (filters.from) tags.push(`開催日 From: ${filters.from}`);
  if (filters.to) tags.push(`開催日 To: ${filters.to}`);
  if (filters.prefecture) tags.push(`都道府県: ${filters.prefecture}`);
  if (filters.sport_type) tags.push(`種別: ${filters.sport_type}`);

  tags.push(`並び順: ${getSortLabel(filters.sort)}`);

  if (filters.exclude_member_recruitment) {
    tags.push('メンバー募集除外');
  }

  if (filters.exclude_excluded_organizers) {
    tags.push('除外した主催者を非表示');
  }

  if (filters.exclude_high_volume_organizers) {
    tags.push('大量投稿主催者を補助的に非表示');
  }

  return tags;
}

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm shadow-slate-200/60 backdrop-blur">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function EventCard({
  event,
  isExcluded,
  excludedOrganizersReady,
  busyOrganizer,
  onToggleOrganizer,
}: {
  event: EventRecord;
  isExcluded: boolean;
  excludedOrganizersReady: boolean;
  busyOrganizer: string | null;
  onToggleOrganizer: (organizerName: string, currentlyExcluded: boolean) => Promise<void>;
}) {
  const organizerName = event.organizer.trim();
  const organizerButtonDisabled =
    !organizerName || !excludedOrganizersReady || busyOrganizer === organizerName;
  const organizerButtonLabel = isExcluded ? '除外解除' : 'この主催者を除外';

  return (
    <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
          {event.sport_type || '未分類'}
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          {formatDate(event.event_date)}
        </span>
        {isNew(event.scraped_at) ? (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
            NEW
          </span>
        ) : null}
        {event.is_member_recruitment ? (
          <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
            メンバー募集
          </span>
        ) : null}
        {event.is_high_volume_organizer ? (
          <span className="rounded-full bg-fuchsia-100 px-3 py-1 text-xs font-semibold text-fuchsia-700">
            大量投稿主催者
          </span>
        ) : null}
      </div>

      <div className="mt-4 space-y-3">
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-500">
            {event.prefecture || '都道府県未判定'}
            {event.venue_or_area ? ` / ${event.venue_or_area}` : ''}
          </p>
          <h3 className="text-xl font-semibold leading-8 text-slate-950">{event.title}</h3>
        </div>

        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                主催者
              </p>
              <p className="mt-1 text-base font-semibold text-slate-900">
                {organizerName || '未取得'}
              </p>
            </div>
            <button
              type="button"
              disabled={organizerButtonDisabled}
              onClick={() => onToggleOrganizer(organizerName, isExcluded)}
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
            >
              {busyOrganizer === organizerName ? '更新中...' : organizerButtonLabel}
            </button>
          </div>
          {!excludedOrganizersReady ? (
            <p className="mt-2 text-xs text-amber-700">
              Supabase に schema.sql を適用すると、このボタンから主催者除外を操作できます。
            </p>
          ) : null}
        </div>

        <dl className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 px-4 py-3">
            <dt className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
              会場
            </dt>
            <dd className="mt-2 leading-6 text-slate-900">{event.venue_or_area || '未取得'}</dd>
          </div>
          <div className="rounded-2xl border border-slate-200 px-4 py-3">
            <dt className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
              主催者掲載件数
            </dt>
            <dd className="mt-2 text-lg font-semibold text-slate-900">
              {event.organizer_post_count}
            </dd>
          </div>
        </dl>

        <div className="rounded-2xl border border-slate-200 px-4 py-4">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">概要</p>
          <p className="mt-2 whitespace-pre-wrap leading-7 text-slate-700">
            {event.description || '未取得'}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
          <div className="space-y-1">
            <p>取得日: {formatDateTime(event.scraped_at)}</p>
            <p>公開日: {formatDate(event.published_at)}</p>
          </div>
          <a
            href={event.event_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-full bg-slate-900 px-4 py-2 font-medium text-white transition hover:bg-slate-700"
          >
            詳細リンク
          </a>
        </div>
      </div>
    </article>
  );
}

export default function HomePage() {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [savedTotal, setSavedTotal] = useState(0);
  const [lastScrapedAt, setLastScrapedAt] = useState<string | null>(null);
  const [excludedOrganizers, setExcludedOrganizers] = useState<ExcludedOrganizerRecord[]>([]);
  const [excludedOrganizersReady, setExcludedOrganizersReady] = useState(true);
  const [excludedOrganizersError, setExcludedOrganizersError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [crawlLoading, setCrawlLoading] = useState(false);
  const [busyOrganizer, setBusyOrganizer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function fetchEvents(nextFilters: FilterState) {
    const response = await fetch(`/api/events?${buildQueryString(nextFilters)}`, {
      cache: 'no-store',
    });
    const data = (await response.json()) as EventsApiResponse & { error?: string };

    if (!response.ok) {
      throw new Error(data.error ?? `HTTP ${response.status}`);
    }

    setEvents(data.events);
    setTotal(data.total);
    setSavedTotal(data.saved_total);
    setLastScrapedAt(data.last_scraped_at);
  }

  async function fetchExcludedOrganizers() {
    const response = await fetch('/api/excluded-organizers', {
      cache: 'no-store',
    });
    const data = (await response.json()) as ExcludedOrganizersApiResponse;

    if (!response.ok) {
      throw new Error(data.error ?? `HTTP ${response.status}`);
    }

    setExcludedOrganizers(data.organizers);
    setExcludedOrganizersReady(data.ready);
    setExcludedOrganizersError(data.ready ? null : data.error ?? null);
  }

  async function refreshPage(nextFilters: FilterState, initial = false) {
    if (initial) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    setError(null);

    try {
      await fetchEvents(nextFilters);
    } catch (fetchError) {
      setError(`イベント取得に失敗しました: ${getErrorMessage(fetchError)}`);
    }

    try {
      await fetchExcludedOrganizers();
    } catch (fetchError) {
      setExcludedOrganizers([]);
      setExcludedOrganizersReady(false);
      setExcludedOrganizersError(getErrorMessage(fetchError));
    } finally {
      if (initial) {
        setLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    void refreshPage(DEFAULT_FILTERS, true);
  }, []);

  async function handleApplyFilters() {
    setAppliedFilters(filters);
    await refreshPage(filters);
  }

  async function handleResetFilters() {
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    await refreshPage(DEFAULT_FILTERS);
  }

  async function handleToggleOrganizer(
    organizerName: string,
    currentlyExcluded: boolean,
  ): Promise<void> {
    if (!organizerName.trim()) {
      setMessage('主催者名が空のイベントは除外対象にできません。');
      return;
    }

    setBusyOrganizer(organizerName);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch('/api/excluded-organizers', {
        method: currentlyExcluded ? 'DELETE' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ organizer_name: organizerName }),
      });
      const data = (await response.json()) as { ready: boolean; error?: string };

      if (!response.ok || !data.ready) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      setMessage(
        currentlyExcluded
          ? `「${organizerName}」の除外を解除しました。`
          : `「${organizerName}」を除外主催者に追加しました。`,
      );

      await refreshPage(appliedFilters);
    } catch (actionError) {
      setError(`主催者除外の更新に失敗しました: ${getErrorMessage(actionError)}`);
    } finally {
      setBusyOrganizer(null);
    }
  }

  async function handleRunCrawl() {
    setCrawlLoading(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch('/api/admin/crawl', {
        method: 'POST',
      });
      const data = (await response.json()) as CrawlApiResponse;

      if (!response.ok || !data.result) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      setMessage(
        `クロール完了: fetched=${data.result.fetched}, upserted=${data.result.upserted}, errors=${data.result.errors}`,
      );
      await refreshPage(appliedFilters);
    } catch (crawlError) {
      setError(`クロール実行に失敗しました: ${getErrorMessage(crawlError)}`);
    } finally {
      setCrawlLoading(false);
    }
  }

  const excludedOrganizerSet = new Set(
    excludedOrganizers.map((item) => item.organizer_name.trim()).filter(Boolean),
  );
  const activeTags = buildActiveTags(appliedFilters);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.14),_transparent_32%),linear-gradient(180deg,_#f8fafc_0%,_#eef6ff_48%,_#f8fafc_100%)] text-slate-900">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-[32px] border border-white/70 bg-white/75 p-6 shadow-xl shadow-slate-200/60 backdrop-blur sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-700">
                Moshicom Kansai Watch
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                関西ランニング / トレイルイベント一覧
              </h1>
              <p className="mt-4 text-base leading-8 text-slate-600">
                週1回取得したモシコムの公開イベントから、
                関西エリアのランニング / トレイル情報を見やすく整理しています。
              </p>
              <p className="mt-4 text-sm text-slate-500">
                最終更新: {formatDateTime(lastScrapedAt)}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleRunCrawl()}
              disabled={crawlLoading}
              className="inline-flex items-center justify-center rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {crawlLoading ? '更新中...' : '今すぐ更新'}
            </button>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="保存件数" value={savedTotal} />
            <StatCard label="表示中件数" value={total} />
            <StatCard label="除外主催者件数" value={excludedOrganizers.length} />
            <StatCard label="並び順" value={getSortLabel(appliedFilters.sort)} />
          </div>
        </section>

        <section className="mt-8 rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-200/70">
          <SectionTitle
            title="フィルター"
            description="開催日、都道府県、種別、除外条件をまとめて調整できます。主催者の除外はGUIでの手動管理を優先し、大量投稿主催者の一括除外は補助機能として任意で使えます。"
          />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">開催日 From</span>
              <input
                type="date"
                value={filters.from}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, from: event.target.value }))
                }
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">開催日 To</span>
              <input
                type="date"
                value={filters.to}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, to: event.target.value }))
                }
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">都道府県</span>
              <select
                value={filters.prefecture}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, prefecture: event.target.value }))
                }
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500"
              >
                <option value="">すべて</option>
                {KANSAI_PREFECTURES.map((prefecture) => (
                  <option key={prefecture} value={prefecture}>
                    {prefecture}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">種別</span>
              <select
                value={filters.sport_type}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, sport_type: event.target.value }))
                }
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500"
              >
                <option value="">すべて</option>
                {SPORT_KEYWORDS.map((sport) => (
                  <option key={sport} value={sport}>
                    {sport}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-700">並び順</span>
              <select
                value={filters.sort}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    sort: event.target.value as SortOption,
                  }))
                }
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={filters.exclude_member_recruitment}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    exclude_member_recruitment: event.target.checked,
                  }))
                }
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              メンバー募集除外
            </label>

            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={filters.exclude_excluded_organizers}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    exclude_excluded_organizers: event.target.checked,
                  }))
                }
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              除外した主催者を非表示
            </label>

            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={filters.exclude_high_volume_organizers}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    exclude_high_volume_organizers: event.target.checked,
                  }))
                }
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              大量投稿主催者も追加で非表示
            </label>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleApplyFilters()}
              disabled={refreshing}
              className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
            >
              {refreshing ? '適用中...' : '条件を適用'}
            </button>
            <button
              type="button"
              onClick={() => void handleResetFilters()}
              disabled={refreshing}
              className="inline-flex items-center justify-center rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
            >
              リセット
            </button>
          </div>
        </section>

        <section className="mt-8 rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-200/70">
          <SectionTitle
            title="除外中の主催者"
            description="イベントカードのボタンから追加した主催者をここで管理します。既定表示では、この一覧に入った主催者を優先して非表示にします。"
          />

          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            現在の除外件数: <span className="font-semibold text-slate-900">{excludedOrganizers.length}</span>
          </div>

          {excludedOrganizersError ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {excludedOrganizersError}
            </div>
          ) : null}

          {excludedOrganizers.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-3">
              {excludedOrganizers.map((organizer) => (
                <button
                  key={organizer.id}
                  type="button"
                  onClick={() => void handleToggleOrganizer(organizer.organizer_name, true)}
                  disabled={!excludedOrganizersReady || busyOrganizer === organizer.organizer_name}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 transition hover:border-slate-500 hover:text-slate-950 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                >
                  <span>{organizer.organizer_name}</span>
                  <span aria-hidden>×</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">除外中の主催者はまだありません。</p>
          )}
        </section>

        <section className="mt-8 rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-200/70">
          <SectionTitle title="一覧サマリー" />

          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <span className="rounded-full bg-slate-100 px-4 py-2 font-semibold text-slate-900">
              表示中件数: {total}
            </span>
            {activeTags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-slate-200 bg-white px-4 py-2"
              >
                {tag}
              </span>
            ))}
          </div>
        </section>

        {message ? (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <section className="mt-8">
          <SectionTitle title="イベントカード一覧" />

          {loading ? (
            <div className="rounded-[28px] border border-slate-200 bg-white/90 px-6 py-16 text-center text-slate-500">
              読み込み中...
            </div>
          ) : events.length === 0 ? (
            <div className="rounded-[28px] border border-slate-200 bg-white/90 px-6 py-16 text-center text-slate-500">
              条件に一致するイベントはありません。
            </div>
          ) : (
            <div className="grid gap-5 xl:grid-cols-2">
              {events.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  isExcluded={excludedOrganizerSet.has(event.organizer.trim())}
                  excludedOrganizersReady={excludedOrganizersReady}
                  busyOrganizer={busyOrganizer}
                  onToggleOrganizer={handleToggleOrganizer}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
