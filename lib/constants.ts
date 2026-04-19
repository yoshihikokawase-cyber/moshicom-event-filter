// ─────────────────────────────────────────────────────────────
// lib/constants.ts  — アプリ全体で使う定数
// ─────────────────────────────────────────────────────────────

/** 関西エリアの都道府県（正式名称） */
export const KANSAI_PREFECTURES = [
  '大阪府',
  '京都府',
  '兵庫県',
  '滋賀県',
  '奈良県',
  '和歌山県',
  '三重県',
] as const;

export type KansaiPrefecture = (typeof KANSAI_PREFECTURES)[number];

/** 都道府県の略称 → 正式名称マッピング（会場テキスト対策） */
export const KANSAI_ALIASES: Record<string, string> = {
  大阪: '大阪府',
  京都: '京都府',
  兵庫: '兵庫県',
  滋賀: '滋賀県',
  奈良: '奈良県',
  和歌山: '和歌山県',
  三重: '三重県',
};

/** 対象スポーツキーワード（長い順に検査するため順序を維持） */
export const SPORT_KEYWORDS = [
  'トレイルランニング',
  'トレイルラン',
  'トレイル',
  'ランニング',
  'マラソン',
] as const;

/** メンバー募集と判定するキーワード */
export const MEMBER_RECRUITMENT_KEYWORDS = [
  'メンバー募集',
  '参加者募集',
  '仲間募集',
  '一緒に走る',
  'サークルメンバー',
  '練習会メンバー',
] as const;

/**
 * 大量投稿主催者しきい値
 * 同一クロール回で同一 organizer の投稿数がこの値以上なら除外候補にする
 */
export const HIGH_VOLUME_ORGANIZER_THRESHOLD = 10;

// ─── クロール設定 ──────────────────────────────────────────────

export const BASE_URL = 'https://moshicom.com';
// 末尾スラッシュなし: /search/ → /search へ301リダイレクトされHTTPS→HTTPになるケースを回避
export const SEARCH_URL = `${BASE_URL}/search`;

/** リクエストタイムアウト (ms) */
export const REQUEST_TIMEOUT_MS = 15_000;

/** 待機時間の最小値 (ms) */
export const WAIT_MIN_MS = 1_000;

/** 待機時間の最大値 (ms) */
export const WAIT_MAX_MS = 3_000;

/** 1つの検索クエリあたり最大ページ数（無限ループ防止） */
export const MAX_PAGES_PER_SEARCH = 30;

/** description の最大保存文字数 */
export const DESCRIPTION_MAX_LENGTH = 500;

/** クロール時に使う User-Agent */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * 一覧検索に使うキーワード一覧
 *
 * 理由: モシコム検索は全国対象のため "ランニング" 単独では1ページ20件中
 * 関西イベントがほぼ含まれない。都道府県名×スポーツの組み合わせで
 * 関西イベントを効率的に収集する。
 * 各クエリで20件取得 → 合計最大320件 → 重複除去後に詳細ページ巡回。
 */
export const SEARCH_KEYWORDS = [
  '関西 ランニング',
  '関西 トレイル',
  '大阪 ランニング',
  '大阪 トレイル',
  '京都 ランニング',
  '京都 トレイル',
  '兵庫 ランニング',
  '兵庫 トレイル',
  '奈良 ランニング',
  '奈良 トレイル',
  '滋賀 ランニング',
  '滋賀 トレイル',
  '和歌山 ランニング',
  '和歌山 トレイル',
  '三重 ランニング',
  '三重 トレイル',
] as const;
