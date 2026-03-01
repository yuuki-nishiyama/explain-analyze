import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SQL 実行計画アナライザー',
  description: 'MySQL の EXPLAIN 出力を AI で解析してビジュアル表示',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body className="bg-slate-100 min-h-screen">
        {children}
      </body>
    </html>
  )
}
