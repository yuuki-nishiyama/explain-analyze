'use client'

import { useState } from 'react'
import type { ExplainFormat } from '@/lib/types'

const FORMAT_OPTIONS: { value: ExplainFormat; label: string; hint: string }[] = [
  { value: 'unknown', label: '自動判定', hint: 'フォーマットを自動で判別します' },
  { value: 'json', label: 'JSON形式', hint: 'EXPLAIN FORMAT=JSON の出力' },
  { value: 'tabular', label: 'テーブル形式', hint: 'EXPLAIN の標準出力（id | select_type | table ...）' },
  { value: 'tree', label: 'TREE形式', hint: 'EXPLAIN ANALYZE の出力（MySQL 8.0+）' },
]

const SAMPLE_TREE = `-> Nested loop left join  (cost=365 rows=0.52) (actual time=134..567046 rows=18659 loops=1)\n    -> Table scan on orders  (cost=200 rows=500000) (actual time=0.5..450000 rows=500000 loops=1)\n    -> Index lookup on users using PRIMARY (id=orders.user_id)  (cost=0.35 rows=1) (actual time=0.002..0.002 rows=1 loops=500000)`

const SAMPLE_TREE_AFTER = `-> Nested loop inner join  (cost=12 rows=18659) (actual time=0.08..0.92 rows=18659 loops=1)\n    -> Index range scan on orders using idx_status (status='pending')  (cost=8 rows=18659) (actual time=0.05..0.45 rows=18659 loops=1)\n    -> Single-row index lookup on users using PRIMARY (id=orders.user_id)  (cost=0.25 rows=1) (actual time=0.002..0.002 rows=1 loops=18659)`

const SAMPLE_SQL = `SELECT o.*, u.name\nFROM orders o\nLEFT JOIN users u ON u.id = o.user_id\nWHERE o.status = 'pending'`

interface ExplainInputProps {
  onAnalyze: (text: string, format: ExplainFormat, sql?: string) => void
  onCompare: (
    beforeText: string, beforeFormat: ExplainFormat, beforeSql: string | undefined,
    afterText: string, afterFormat: ExplainFormat, afterSql: string | undefined,
  ) => void
  isLoading: boolean
}

function ExplainSection({
  label,
  text,
  setText,
  format,
  setFormat,
  sql,
  setSql,
  showSql,
  setShowSql,
  disabled,
}: {
  label: string
  text: string
  setText: (v: string) => void
  format: ExplainFormat
  setFormat: (v: ExplainFormat) => void
  sql: string
  setSql: (v: string) => void
  showSql: boolean
  setShowSql: (v: boolean) => void
  disabled: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 pb-1">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FORMAT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFormat(opt.value)}
            title={opt.hint}
            className={[
              'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
              format === opt.value
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400',
            ].join(' ')}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="EXPLAIN の出力をここに貼り付けてください..."
        className="w-full h-32 p-3 font-mono text-xs border border-slate-300 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
        disabled={disabled}
      />
      <div>
        <button
          type="button"
          onClick={() => setShowSql(!showSql)}
          className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
        >
          <span className={'transition-transform inline-block ' + (showSql ? 'rotate-90' : '')}>▶</span>
          SQL（任意・精度向上）
        </button>
        {showSql && (
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            placeholder="SELECT ..."
            className="mt-1.5 w-full h-20 p-2 font-mono text-xs border border-slate-300 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
            disabled={disabled}
          />
        )}
      </div>
    </div>
  )
}

export default function ExplainInput({ onAnalyze, onCompare, isLoading }: ExplainInputProps) {
  const [compareMode, setCompareMode] = useState(false)

  // Normal mode state
  const [text, setText] = useState('')
  const [format, setFormat] = useState<ExplainFormat>('unknown')
  const [sql, setSql] = useState('')
  const [showSql, setShowSql] = useState(false)

  // Compare mode state
  const [beforeText, setBeforeText] = useState('')
  const [beforeFormat, setBeforeFormat] = useState<ExplainFormat>('unknown')
  const [beforeSql, setBeforeSql] = useState('')
  const [showBeforeSql, setShowBeforeSql] = useState(false)
  const [afterText, setAfterText] = useState('')
  const [afterFormat, setAfterFormat] = useState<ExplainFormat>('unknown')
  const [afterSql, setAfterSql] = useState('')
  const [showAfterSql, setShowAfterSql] = useState(false)

  const handleSubmit = () => {
    if (text.trim()) onAnalyze(text, format, sql.trim() || undefined)
  }

  const handleCompareSubmit = () => {
    if (beforeText.trim() && afterText.trim()) {
      onCompare(
        beforeText, beforeFormat, beforeSql.trim() || undefined,
        afterText, afterFormat, afterSql.trim() || undefined,
      )
    }
  }

  const handleSample = () => {
    if (compareMode) {
      setBeforeText(SAMPLE_TREE)
      setBeforeFormat('tree')
      setBeforeSql(SAMPLE_SQL)
      setShowBeforeSql(true)
      setAfterText(SAMPLE_TREE_AFTER)
      setAfterFormat('tree')
      setAfterSql(SAMPLE_SQL)
      setShowAfterSql(true)
    } else {
      setText(SAMPLE_TREE)
      setFormat('tree')
      setSql(SAMPLE_SQL)
      setShowSql(true)
    }
  }

  const handleClear = () => {
    if (compareMode) {
      setBeforeText(''); setBeforeSql('')
      setAfterText(''); setAfterSql('')
    } else {
      setText(''); setSql('')
    }
  }

  const canSubmit = compareMode
    ? beforeText.trim() !== '' && afterText.trim() !== ''
    : text.trim() !== ''

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">SQL 実行計画アナライザー</h1>
        <p className="text-slate-500 text-sm mt-1">
          MySQL の EXPLAIN 出力を貼り付けると、AI が問題箇所を分析してビジュアル表示します
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm font-medium self-start">
        <button
          onClick={() => setCompareMode(false)}
          className={'px-4 py-2 transition-colors ' + (!compareMode ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
        >
          通常解析
        </button>
        <button
          onClick={() => setCompareMode(true)}
          className={'px-4 py-2 transition-colors ' + (compareMode ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
        >
          Before / After 比較
        </button>
      </div>

      {compareMode ? (
        /* Compare mode: two sections */
        <div className="grid grid-cols-2 gap-4">
          <ExplainSection
            label="改善前"
            text={beforeText} setText={setBeforeText}
            format={beforeFormat} setFormat={setBeforeFormat}
            sql={beforeSql} setSql={setBeforeSql}
            showSql={showBeforeSql} setShowSql={setShowBeforeSql}
            disabled={isLoading}
          />
          <ExplainSection
            label="改善後"
            text={afterText} setText={setAfterText}
            format={afterFormat} setFormat={setAfterFormat}
            sql={afterSql} setSql={setAfterSql}
            showSql={showAfterSql} setShowSql={setShowAfterSql}
            disabled={isLoading}
          />
        </div>
      ) : (
        /* Normal mode */
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {FORMAT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFormat(opt.value)}
                title={opt.hint}
                className={[
                  'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                  format === opt.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400',
                ].join(' ')}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              EXPLAIN 出力 *
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'EXPLAIN の出力をここに貼り付けてください...\n\n例 (TREE形式):\n-> Nested loop left join  (cost=365 rows=0.52) (actual time=134..567046 rows=18659 loops=1)\n    -> Table scan on orders  (cost=... rows=...) (actual time=... rows=... loops=...)'}
              className="w-full h-40 p-3 font-mono text-sm border border-slate-300 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50"
              disabled={isLoading}
            />
          </div>
          <div>
            <button
              type="button"
              onClick={() => setShowSql(!showSql)}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
            >
              <span className={'transition-transform inline-block ' + (showSql ? 'rotate-90' : '')}>▶</span>
              SQL クエリを追加（任意・精度向上）
            </button>
            {showSql && (
              <div className="mt-2">
                <p className="text-xs text-slate-400 mb-1.5">
                  SQL を入力すると AI がクエリ構造も考慮して問題を分析・書き換え提案します
                </p>
                <textarea
                  value={sql}
                  onChange={(e) => setSql(e.target.value)}
                  placeholder={'SELECT o.*, u.name\nFROM orders o\nLEFT JOIN users u ON u.id = o.user_id\nWHERE o.status = \'pending\''}
                  className="w-full h-28 p-3 font-mono text-sm border border-slate-300 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50"
                  disabled={isLoading}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={compareMode ? handleCompareSubmit : handleSubmit}
          disabled={isLoading || !canSubmit}
          className={[
            'px-6 py-2.5 rounded-lg font-semibold text-white transition-colors',
            isLoading || !canSubmit
              ? 'bg-blue-300 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800',
          ].join(' ')}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              AI 解析中...
            </span>
          ) : compareMode ? '比較解析する' : '解析する'}
        </button>

        <button
          onClick={handleSample}
          disabled={isLoading}
          className="px-4 py-2.5 rounded-lg font-medium text-slate-600 border border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          サンプルを使用
        </button>

        {(text || beforeText || afterText) && (
          <button
            onClick={handleClear}
            disabled={isLoading}
            className="px-4 py-2.5 rounded-lg font-medium text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-50"
          >
            クリア
          </button>
        )}
      </div>
    </div>
  )
}
