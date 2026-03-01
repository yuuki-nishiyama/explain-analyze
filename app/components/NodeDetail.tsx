'use client'

import type { AnalysisResult, ExplainNode, ProblemAnnotation, Severity } from '@/lib/types'
import { computeNodeTimePercents } from '@/lib/scoring'

const SEVERITY_LABEL: Record<Severity, { label: string; color: string; bg: string }> = {
  critical: { label: '重大', color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
  warning: { label: '警告', color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200' },
  ok: { label: '正常', color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
}

function findNode(nodes: ExplainNode[], id: string): ExplainNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNode(node.children, id)
    if (found) return found
  }
  return null
}

function formatTime(ms: number): string {
  if (ms >= 60000) return (ms / 60000).toFixed(0) + 'm'
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's'
  if (ms >= 1) return ms.toFixed(0) + 'ms'
  return ms.toFixed(2) + 'ms'
}

interface NodeDetailProps {
  result: AnalysisResult
  selectedNodeId: string | null
  onClose: () => void
}

export default function NodeDetail({
  result,
  selectedNodeId,
  onClose,
}: NodeDetailProps) {
  if (!selectedNodeId) return null

  const node = findNode(result.nodes, selectedNodeId)
  const problems = result.problems.filter((p) => p.nodeId === selectedNodeId)

  if (!node) return null

  const hasCritical = problems.some((p) => p.severity === 'critical')
  const hasWarning = problems.some((p) => p.severity === 'warning')
  const aiSeverity: Severity = hasCritical ? 'critical' : hasWarning ? 'warning' : 'ok'

  // Frontend enforcement: time-based override regardless of AI judgment
  const totalActualMsForSeverity =
    node.actualTimeEnd !== undefined && node.loops !== undefined
      ? node.actualTimeEnd * node.loops
      : undefined
  const overallSeverity: Severity =
    totalActualMsForSeverity !== undefined && totalActualMsForSeverity > 10000 && aiSeverity !== 'critical'
      ? 'critical'
      : totalActualMsForSeverity !== undefined && totalActualMsForSeverity > 1000 && aiSeverity === 'ok'
      ? 'warning'
      : aiSeverity
  const severityInfo = SEVERITY_LABEL[overallSeverity]

  const totalActualMs =
    node.actualTimeEnd !== undefined && node.loops !== undefined
      ? node.actualTimeEnd * node.loops
      : undefined

  const rowsDeviation =
    node.actualRows !== undefined && node.estimatedRows !== undefined && node.estimatedRows > 0
      ? node.actualRows / node.estimatedRows
      : undefined

  const isStatsStale = rowsDeviation !== undefined && (rowsDeviation > 9 || rowsDeviation < 0.11)

  const timePercents = computeNodeTimePercents(result.nodes)
  const timePercent = timePercents.get(node.id)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        <div>
          <h2 className="font-bold text-slate-800 text-lg">{node.label}</h2>
          <span className={'text-xs font-medium ' + severityInfo.color}>
            {severityInfo.label}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          aria-label="閉じる"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Actual time section — shown prominently when available */}
        {totalActualMs !== undefined && (
          <section>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              実測パフォーマンス
            </h3>
            <div
              className={
                'rounded-lg border p-3 ' +
                (totalActualMs > 10000
                  ? 'bg-red-50 border-red-300'
                  : totalActualMs > 1000
                  ? 'bg-orange-50 border-orange-300'
                  : totalActualMs > 100
                  ? 'bg-yellow-50 border-yellow-300'
                  : 'bg-green-50 border-green-300')
              }
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">⏱</span>
                <span
                  className={
                    'text-xl font-bold ' +
                    (totalActualMs > 10000
                      ? 'text-red-700'
                      : totalActualMs > 1000
                      ? 'text-orange-600'
                      : totalActualMs > 100
                      ? 'text-yellow-700'
                      : 'text-green-700')
                  }
                >
                  {formatTime(totalActualMs)}
                </span>
                <span className="text-xs text-slate-500">合計実行時間</span>
              </div>

              {/* Relative bottleneck bar */}
              {timePercent !== undefined && (
                <div className="mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-500">クエリ全体に占める割合</span>
                    <span className={'text-xs font-mono font-semibold ' + (timePercent > 80 ? 'text-red-600' : timePercent > 50 ? 'text-orange-600' : timePercent > 20 ? 'text-yellow-600' : 'text-slate-600')}>
                      {timePercent.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 bg-white rounded-full overflow-hidden border border-slate-200">
                    <div
                      className={'h-full rounded-full ' + (timePercent > 80 ? 'bg-red-500' : timePercent > 50 ? 'bg-orange-400' : timePercent > 20 ? 'bg-yellow-400' : 'bg-green-400')}
                      style={{ width: Math.max(2, timePercent) + '%' }}
                    />
                  </div>
                  {timePercent > 80 && (
                    <div className="text-xs text-red-600 font-medium mt-0.5">主要ボトルネック</div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs">
                {node.actualTimeStart !== undefined && (
                  <div className="bg-white rounded p-1.5 border border-slate-200">
                    <div className="text-slate-500">初行取得</div>
                    <div className="font-mono font-semibold text-slate-800">
                      {formatTime(node.actualTimeStart)}
                    </div>
                  </div>
                )}
                {node.actualTimeEnd !== undefined && (
                  <div className="bg-white rounded p-1.5 border border-slate-200">
                    <div className="text-slate-500">全行取得</div>
                    <div className="font-mono font-semibold text-slate-800">
                      {formatTime(node.actualTimeEnd)}
                    </div>
                  </div>
                )}
                {node.loops !== undefined && (
                  <div className="bg-white rounded p-1.5 border border-slate-200">
                    <div className="text-slate-500">ループ回数</div>
                    <div className="font-mono font-semibold text-slate-800">
                      {node.loops.toLocaleString()} 回
                    </div>
                  </div>
                )}
                {node.actualRows !== undefined && (
                  <div className="bg-white rounded p-1.5 border border-slate-200">
                    <div className="text-slate-500">実際の行数/ループ</div>
                    <div className="font-mono font-semibold text-slate-800">
                      {node.actualRows.toLocaleString()}
                    </div>
                  </div>
                )}
              </div>

              {/* N+1 warning */}
              {node.loops !== undefined && node.loops > 1000 && (
                <div className="mt-2 flex items-start gap-1.5 text-xs text-orange-700 bg-orange-100 rounded p-2">
                  <span>⚠️</span>
                  <span>
                    ループ回数が {node.loops.toLocaleString()} 回と非常に多いです。N+1 問題の可能性があります。
                  </span>
                </div>
              )}
            </div>

            {/* Actual vs estimated rows */}
            {rowsDeviation !== undefined && (
              <div
                className={
                  'mt-2 rounded border p-2 text-xs ' +
                  (isStatsStale
                    ? 'bg-amber-50 border-amber-300 text-amber-800'
                    : 'bg-slate-50 border-slate-200 text-slate-600')
                }
              >
                <div className="flex items-center gap-1 mb-0.5">
                  {isStatsStale && <span>⚠️</span>}
                  <span className="font-semibold">推定 vs 実測 行数</span>
                </div>
                <div className="font-mono">
                  推定: {(node.estimatedRows ?? node.rows).toLocaleString()} 行
                  {'  →  '}
                  実測: {node.actualRows!.toLocaleString()} 行
                  {'  ('}
                  {rowsDeviation >= 1
                    ? rowsDeviation.toFixed(1) + '× 過大'
                    : (1 / rowsDeviation).toFixed(1) + '× 過小'}
                  {')'}
                </div>
                {isStatsStale && (
                  <div className="mt-1">
                    統計情報が古い可能性があります。ANALYZE TABLE の実行を検討してください。
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Node stats */}
        <section>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            実行計画の詳細
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Access Type', value: node.accessType },
              { label: '推定行数', value: node.rows.toLocaleString() },
              node.filtered !== undefined && {
                label: 'フィルタ率',
                value: node.filtered + '%',
              },
              node.cost !== undefined && {
                label: 'コスト',
                value: node.cost.toFixed(2),
              },
              node.key && { label: 'インデックス', value: node.key },
              node.keyLen && { label: 'Key長', value: node.keyLen + 'bytes' },
              node.ref && { label: 'Ref', value: node.ref },
              node.selectType && { label: 'Select Type', value: node.selectType },
              node.partitions && { label: 'パーティション', value: node.partitions },
            ]
              .filter(Boolean)
              .map((item) => {
                const { label, value } = item as { label: string; value: string }
                return (
                  <div key={label} className="bg-slate-50 rounded p-2">
                    <div className="text-xs text-slate-500">{label}</div>
                    <div className="text-sm font-mono font-medium text-slate-800 truncate">
                      {value}
                    </div>
                  </div>
                )
              })}
          </div>

          {node.possibleKeys && node.possibleKeys.length > 0 && (
            <div className="mt-2 bg-slate-50 rounded p-2">
              <div className="text-xs text-slate-500 mb-1">候補インデックス</div>
              <div className="flex flex-wrap gap-1">
                {node.possibleKeys.map((k) => (
                  <span
                    key={k}
                    className="text-xs font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          {node.extra && (
            <div className="mt-2 bg-slate-50 rounded p-2">
              <div className="text-xs text-slate-500 mb-1">Extra</div>
              <div className="text-xs font-mono text-slate-700">{node.extra}</div>
            </div>
          )}
        </section>

        {/* Problems */}
        {problems.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              AI 診断結果
            </h3>
            <div className="space-y-3">
              {problems.map((problem, i) => (
                <ProblemCard key={i} problem={problem} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function ProblemCard({ problem }: { problem: ProblemAnnotation }) {
  const info = SEVERITY_LABEL[problem.severity]

  return (
    <div className={'rounded-lg border p-3 ' + info.bg}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-semibold text-sm text-slate-800">{problem.title}</span>
        <span className={'text-xs font-medium px-2 py-0.5 rounded-full bg-white border ' + info.color}>
          {info.label}
        </span>
      </div>
      <p className="text-sm text-slate-700 mb-2 leading-relaxed">{problem.description}</p>
      <div className="bg-white rounded p-2 border border-slate-200">
        <div className="text-xs font-semibold text-slate-500 mb-1">改善策</div>
        <p className="text-sm text-slate-700 leading-relaxed">{problem.suggestion}</p>
      </div>
    </div>
  )
}
