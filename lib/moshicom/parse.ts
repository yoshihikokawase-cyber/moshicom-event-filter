import * as cheerio from 'cheerio';
import { BASE_URL, DESCRIPTION_MAX_LENGTH } from '../constants';

export interface ParsedEventListItem {
  url: string;
  title: string;
  event_date_raw: string;
  location_raw: string;
  category_raw: string;
  organizer_raw: string;
}

export interface ParsedEventList {
  items: ParsedEventListItem[];
  nextPageUrl: string | null;
}

export interface ParsedEventDetail {
  title: string;
  event_date: string | null;
  published_at: string | null;
  venue_or_area: string;
  organizer: string;
  description: string;
  category_raw: string;
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function toAbsoluteUrl(href: string): string {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  if (href.startsWith('//')) return `https:${href}`;
  return `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;
}

function isEventUrl(href: string): boolean {
  if (!href || href === '#' || href.startsWith('javascript:')) return false;

  const absMatch = /moshicom\.com\/(\d{4,})(?:\?|\/|$)/.test(href);
  const relMatch = /^\/(\d{4,})(?:\?|\/|$)/.test(href);
  return absMatch || relMatch;
}

export function extractSourceId(url: string): string {
  const abs = url.match(/moshicom\.com\/(\d+)/);
  if (abs) return abs[1];

  const rel = url.match(/^\/(\d+)/);
  if (rel) return rel[1];

  return url;
}

function canonicalUrl(href: string): string {
  const abs = toAbsoluteUrl(href);
  return abs.split('?')[0].replace(/\/$/, '');
}

function safeGetText(
  $: ReturnType<typeof cheerio.load>,
  selectors: string[],
  defaultValue = '',
): string {
  for (const selector of selectors) {
    try {
      const el = $(selector).first();
      if (el.length === 0) continue;

      const text = normalizeText(el.text());
      if (text) return text;

      const attr =
        el.attr('alt') ??
        el.attr('title') ??
        el.attr('aria-label') ??
        el.attr('datetime') ??
        el.attr('content') ??
        '';

      if (attr) return normalizeText(attr);
    } catch {
      // Ignore selector errors and continue.
    }
  }

  return defaultValue;
}

function safeGetTextFromSelection(selection: cheerio.Cheerio<any>): string {
  const el = selection.first();
  if (el.length === 0) return '';

  const text = normalizeText(el.text());
  if (text) return text;

  const attr =
    el.attr('alt') ??
    el.attr('title') ??
    el.attr('aria-label') ??
    el.attr('datetime') ??
    el.attr('content') ??
    '';

  return normalizeText(attr);
}

function findDefinitionListValue(
  $: ReturnType<typeof cheerio.load>,
  labels: string[],
): cheerio.Cheerio<any> | null {
  const wanted = new Set(labels.map((label) => normalizeText(label)));

  for (const dt of $('dt').toArray()) {
    const label = normalizeText($(dt).text());
    if (!wanted.has(label)) continue;

    const valueNode = $(dt).nextAll('dd').first();
    if (valueNode.length > 0) return valueNode;
  }

  return null;
}

function extractDefinitionListText(
  $: ReturnType<typeof cheerio.load>,
  labels: string[],
  selectors: string[] = [],
): string {
  const valueNode = findDefinitionListValue($, labels);
  if (!valueNode) return '';

  for (const selector of selectors) {
    const text = safeGetTextFromSelection(valueNode.find(selector));
    if (text) return text;
  }

  return safeGetTextFromSelection(valueNode);
}

function extractTextAfterLabel(
  $: ReturnType<typeof cheerio.load>,
  label: string,
  stopLabels: string[],
): string {
  const bodyText = normalizeText($('body').text());
  const startIndex = bodyText.indexOf(label);
  if (startIndex < 0) return '';

  let tail = bodyText.slice(startIndex + label.length).trim();
  const stopIndex = stopLabels
    .map((stopLabel) => tail.indexOf(stopLabel))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (stopIndex !== undefined) {
    tail = tail.slice(0, stopIndex).trim();
  }

  return normalizeText(tail);
}

function normalizeMetaDescription(raw: string): string {
  const text = normalizeText(raw);
  if (!text) return '';

  const parts = text.split(' / ').map((part) => normalizeText(part)).filter(Boolean);
  if (parts.length >= 3) {
    return normalizeText(parts.slice(2).join(' / '));
  }

  return text;
}

function isDescriptionCandidate(text: string): boolean {
  const normalized = normalizeText(text);
  if (normalized.length < 40) return false;

  return ![
    'プライバシーポリシー',
    'イベント主催者申込規約',
    'イベント主催者への過去のレビュー',
    'Googleカレンダーに登録',
  ].some((blocked) => normalized.includes(blocked));
}

function extractOrganizer($: ReturnType<typeof cheerio.load>): string {
  const fromDefinitionList = extractDefinitionListText(
    $,
    ['イベント主催者'],
    ['h2.user a', 'h2.user', 'a.lines1', 'a[href*="/user/"]', 'img[alt]'],
  );
  if (fromDefinitionList) return fromDefinitionList;

  const fromSelectors = safeGetText($, [
    'h2.user a',
    'h2.user',
    '.user a',
    '.user',
    '[href*="/user/"] img[alt]',
    '.organizer a',
    '.organizer',
    '[class*="organizer"] a',
    '[class*="organizer"]',
    '[class*="sponsor"]',
  ]);
  if (fromSelectors) return fromSelectors;

  return extractTextAfterLabel($, 'イベント主催者', [
    '開催日',
    '申込受付期間',
    '会場',
    '開催場所',
    'イベント詳細',
    '主催者 情報',
  ]);
}

function extractVenueOrArea($: ReturnType<typeof cheerio.load>): string {
  const fromLocation = extractDefinitionListText($, ['開催場所'], ['span']);
  if (fromLocation) return fromLocation;

  const fromVenue = extractDefinitionListText($, ['会場']);
  if (fromVenue) return fromVenue;

  return safeGetText($, [
    '.event-location',
    '[class*="event-location"]',
    '.location',
    '.venue',
    '[class*="location"]',
    '[class*="venue"]',
    '[class*="place"]',
    '[class*="area"]',
  ]);
}

function extractDescription($: ReturnType<typeof cheerio.load>): string {
  const fromSelectors = safeGetText($, [
    'p.lead',
    '.lead',
    '.event-description',
    '.description',
    '[class*="event-description"]',
    '[class*="description"]',
    '.overview',
    '[class*="overview"]',
    '.event-body',
    '.content-body',
    '.entry-content',
  ]);
  if (isDescriptionCandidate(fromSelectors)) return fromSelectors;

  const fromMeta = normalizeMetaDescription(
    $('meta[property="og:description"]').attr('content') ??
    $('meta[name="description"]').attr('content') ??
    '',
  );
  if (isDescriptionCandidate(fromMeta)) return fromMeta;

  const fromParagraphs = $('main p, article p, section p')
    .toArray()
    .map((el) => normalizeText($(el).text()))
    .find((text) => isDescriptionCandidate(text));
  if (fromParagraphs) return fromParagraphs;

  const fromTextFallback = extractTextAfterLabel($, '申し込み', [
    '開催日',
    '申込受付期間',
    '会場',
    '開催場所',
    'イベント主催者への過去のレビュー',
    'イベント詳細',
  ]);

  return isDescriptionCandidate(fromTextFallback) ? fromTextFallback : '';
}

export function normalizeDate(raw: string): string | null {
  if (!raw) return null;

  const iso = raw.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }

  const jp = raw.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (jp) {
    return `${jp[1]}-${jp[2].padStart(2, '0')}-${jp[3].padStart(2, '0')}`;
  }

  const shortJp = raw.match(/(\d{1,2})月\s*(\d{1,2})日/);
  if (shortJp) {
    const year = new Date().getFullYear();
    return `${year}-${shortJp[1].padStart(2, '0')}-${shortJp[2].padStart(2, '0')}`;
  }

  const withParen = raw.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (withParen) {
    return `${withParen[1]}-${withParen[2].padStart(2, '0')}-${withParen[3].padStart(2, '0')}`;
  }

  return null;
}

export function parseEventList(html: string, _currentUrl: string): ParsedEventList {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const items: ParsedEventListItem[] = [];

  const cards = $('.event-card');
  if (cards.length > 0) {
    console.log(`[parse] .event-card で ${cards.length} 件のカードを検出`);

    cards.each((_, card) => {
      const $card = $(card);
      const link = $card.find('h3 a').first();
      const href = link.attr('href') ?? '';
      if (!isEventUrl(href)) return;

      const url = canonicalUrl(href);
      if (seen.has(url)) return;
      seen.add(url);

      items.push({
        url,
        title: normalizeText(link.text()),
        event_date_raw: normalizeText($card.find('.event-date').first().text()),
        location_raw: normalizeText($card.find('.event-location').first().text()),
        category_raw: normalizeText($card.find('.event-category').first().text()),
        organizer_raw:
          normalizeText($card.find('.organizer a').first().text()) ||
          normalizeText($card.find('.organizer').first().text()) ||
          normalizeText($card.find('a[href*="/user/"]').first().text()),
      });
    });
  }

  if (items.length === 0) {
    console.warn('[parse] .event-card セレクタで取れなかったため、全リンクからフォールバック抽出します');

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      if (!isEventUrl(href)) return;

      const url = canonicalUrl(href);
      if (seen.has(url)) return;
      seen.add(url);

      items.push({
        url,
        title: normalizeText($(el).text()),
        event_date_raw: '',
        location_raw: '',
        category_raw: '',
        organizer_raw: '',
      });
    });
  }

  return { items, nextPageUrl: null };
}

export function parseEventDetail(html: string): ParsedEventDetail {
  const $ = cheerio.load(html);

  const title = safeGetText($, ['h1 > span:first-child', 'h1.event-title', '.event-title', 'h1']);

  const rawDate =
    extractDefinitionListText($, ['開催日']) ||
    safeGetText($, ['.event-date', '[class*="event-date"]', '[class*="date"]', 'time[datetime]', 'time']);
  const event_date = normalizeDate(rawDate);

  const metaPublished =
    $('meta[property="article:published_time"]').attr('content') ??
    $('meta[name="date"]').attr('content') ??
    '';
  const rawPublished =
    safeGetText($, ['.published-at', '[class*="published"]', '[class*="posted-at"]']) ||
    metaPublished;
  const published_at = normalizeDate(rawPublished);

  let description = extractDescription($);
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    description = `${description.slice(0, DESCRIPTION_MAX_LENGTH)}...`;
  }

  const category_raw = extractDefinitionListText($, ['スポーツ', 'スポーツ種目']);

  return {
    title,
    event_date,
    published_at,
    venue_or_area: extractVenueOrArea($),
    organizer: extractOrganizer($),
    description,
    category_raw,
  };
}
