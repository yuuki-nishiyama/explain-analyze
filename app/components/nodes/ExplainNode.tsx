'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { ExplainNodeData, Severity } from '@/lib/types'

const SEVERITY_CONFIG: Record<Severity, { border: string; header: string; headerText: string; badge: string; icon: string }> = {
  critical: { border: 'border-red-500', header: 'bg-red-500', headerText: 'text-white', badge: 'bg-red-100 text-red-800', icon: '🔴' },
  warning:  { border: 'border-yellow-500', header: 'bg-yellow-500', headerText: 'text-white', badge: 'bg-yellow-100 text-yellow-800', icon: '⚠️' },
  ok:       { border: 'border-green-500', header: 'bg-green-500', headerText: 'text-white', badge: 'bg-green-100 text-green-800', icon: '✅' },
}

const ACCESS_TYPE_LABELS: Record<string, string> = {
  ALL: 'FULL SCAN', index: 'IDX SCAN', range: 'RANGE', ref: 'REF',
  eq_ref: 'EQ_REF', const: 'CONST', system: 'SYSTEM', join: 'JOIN',
  sort: 'SORT', aggregate: 'AGGR', filter: 'FILTER', materialize: 'MATERIALIZE',
  limit: 'LIMIT', operation: 'OP',
}

function formatTime(ms: number): string {
  if (ms >= 60000) return (ms / 60000).toFixed(0) + 'm'
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's'
  if (ms >= 1) return ms.toFixed(0) + 'ms'
  return ms.toFixed(2) + 'ms'
}

function getTotalMs(actualTimeEnd?: number, loops?: number): number | undefined {
  if (actualTimeEnd === undefined || loops === undefined) return undefined
  return actualTimeEnd * loops
}

function timeColor(totalMs: number): string {
  if (totalMs > 10000) return 'text-red-600 font-bold'
  if (totalMs > 1000) return 'text-orange-500 font-semibold'
  if (totalMs > 100) return 'text-yellow-600'
  return 'text-slate-500'
}

function timeBarColor(pct: number): string {
  if (pct > 80) return 'bg-red-500'
  if (pct > 50) return 'bg-orange-400'
  if (pct > 20) return 'bg-yellow-400'
  return 'bg-green-400'
}

export const ExplainNodeComponent = memo(function ExplainNodeComponent({ data: rawData, selected }: NodeProps) {
  const data = rawData as unknown as ExplainNodeData
  const { explainNode, severity, problems, timePercent } = data
  const config = SEVERITY_CONFIG[severity]
  const accessLabel = ACCESS_TYPE_LABELS[explainNode.accessType] ?? explainNode.accessType.toUpperCase()
  const totalMs = getTotalMs(explainNode.actualTimeEnd, explainNode.loops)

  return (
    <div
      className={[
        'bg-white rounded-lg border-2 shadow-md overflow-hidden cursor-pointer',
        'transition-shadow hover:shadow-xl',
        config.border,
        selected ? 'ring-2 ring-blue-400 ring-offset-1' : '',
      ].join(' ')}
      style={{ width: 230 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />

      {/* Header */}
      <div className={config.header + ' ' + config.headerText + ' px-3 py-1.5 flex items-center justify-between gap-2'}>
        <span className="font-bold text-sm truncate" title={explainNode.label}>
          {explainNode.label}
        </span>
        <span className="text-base flex-shrink-0">{config.icon}</span>
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1.5">
        {/* Access type + key */}
        <div className="flex items-center justify-between gap-1">
          <span className={'text-xs font-mono font-semibold px-1.5 py-0.5 rounded ' + config.badge}>
            {accessLabel}
          </span>
          {explainNode.key && (
            <span className="text-xs text-slate-500 truncate" title={'Index: ' + explainNode.key}>
              {explainNode.key}
            </span>
          )}
        </div>

        {/* Actual time */}
        {totalMs !== undefined && (
          <div className={'flex items-center gap-1 text-xs ' + timeColor(totalMs)} title="実際の合計実行時間 (actualTimeEnd × loops)">
            <span>⏱</span>
            <span className="font-medium">実測:</span>
            <span>{formatTime(totalMs)}</span>
            {explainNode.loops !== undefined && explainNode.loops > 1 && (
              <span className="text-slate-400">×{explainNode.loops}</span>
            )}
          </div>
        )}

        {/* Metrics */}
        <div className="flex items-center gap-3 text-xs text-slate-600">
          <span title="推定検索行数">
            <span className="font-medium">rows:</span> {explainNode.rows.toLocaleString()}
          </span>
          {explainNode.filtered !== undefined && (
            <span title="フィルタ通過率">
              <span className="font-medium">fil:</span> {explainNode.filtered}%
            </span>
          )}
          {explainNode.cost !== undefined && (
            <span title="コスト推定">
              <span className="font-medium">cost:</span> {explainNode.cost.toFixed(1)}
            </span>
          )}
        </div>

        {/* Operation chips + issue count */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 flex-wrap">
            {explainNode.usingFilesort && (
              <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">filesort</span>
            )}
            {explainNode.usingTemporary && (
              <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">tmp table</span>
            )}
          </div>
          {problems.length > 0 && (
            <span className={'text-xs font-semibold ' + (severity === 'critical' ? 'text-red-600' : severity === 'warning' ? 'text-yellow-600' : 'text-green-600')}>
              {problems.length}件
            </span>
          )}
        </div>
      </div>

      {/* Relative time percentage bar */}
      {timePercent !== undefined && (
        <div className="px-3 pb-2">
          <div className="flex items-center gap-1.5">
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={'h-full rounded-full ' + timeBarColor(timePercent)}
                style={{ width: Math.max(2, timePercent) + '%' }}
              />
            </div>
            <span className="text-[10px] text-slate-400 font-mono w-8 text-right flex-shrink-0">
              {timePercent >= 1 ? timePercent.toFixed(0) : timePercent.toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
    </div>
  )
})
