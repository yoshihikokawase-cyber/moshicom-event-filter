// ─────────────────────────────────────────────────────────────
// lib/moshicom/filters.ts  — フィルタリング・判定ロジック
// ─────────────────────────────────────────────────────────────

import {
  KANSAI_PREFECTURES,
  KANSAI_ALIASES,
  SPORT_KEYWORDS,
  MEMBER_RECRUITMENT_KEYWORDS,
} from '../constants';

/**
 * エイリアスがテキストに含まれるか判定する。
 * 「京都」は「東京都」の部分文字列でもあるため、直前が「東」の場合は除外する。
 */
function matchesKansaiAlias(text: string, alias: string): boolean {
  if (alias === '京都') {
    // "東京都" → 東 + 京都 のため、lookbehind で直前の「東」を除外
    return /(?<!東)京都/.test(text);
  }
  return text.includes(alias);
}

/**
 * テキストから関西都道府県名を検出する。
 * 正式名称（大阪府）を優先し、次に略称（大阪）で照合する。
 * 複数ヒット時は最初に見つかったものを返す。
 */
export function detectPrefecture(text: string): string {
  for (const pref of KANSAI_PREFECTURES) {
    if (text.includes(pref)) return pref;
  }
  for (const [alias, pref] of Object.entries(KANSAI_ALIASES)) {
    if (matchesKansaiAlias(text, alias)) return pref;
  }
  return '';
}

/**
 * テキストからスポーツ種別キーワードを検出する。
 * SPORT_KEYWORDS は長いものが先に定義されているのでそのまま走査する。
 * （"トレイルランニング" > "トレイルラン" > "トレイル" > "ランニング"）
 */
export function detectSportType(text: string): string {
  for (const kw of SPORT_KEYWORDS) {
    if (text.includes(kw)) return kw;
  }
  return '';
}

/** テキストが関西エリアに該当するかどうか */
export function isKansai(text: string): boolean {
  return (
    KANSAI_PREFECTURES.some((p) => text.includes(p)) ||
    Object.keys(KANSAI_ALIASES).some((a) => matchesKansaiAlias(text, a))
  );
}

/** テキストが対象スポーツに該当するかどうか */
export function isTargetSport(text: string): boolean {
  return SPORT_KEYWORDS.some((kw) => text.includes(kw));
}

/** タイトルまたは説明文にメンバー募集キーワードが含まれるか */
export function isMemberRecruitment(title: string, description: string): boolean {
  const combined = `${title} ${description}`;
  return MEMBER_RECRUITMENT_KEYWORDS.some((kw) => combined.includes(kw));
}
