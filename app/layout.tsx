import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '関西ランニング / トレイルイベント一覧',
  description:
    'モシコム公開イベントから、関西エリアのランニング / トレイル情報を見やすく整理した一覧です。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="bg-slate-50 font-['Hiragino_Sans','Yu_Gothic','Noto_Sans_JP',sans-serif] text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
