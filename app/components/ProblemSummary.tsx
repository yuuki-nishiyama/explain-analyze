'use client'

import type { AnalysisResult, ExplainNode, Severity } from '@/lib/types'
import { rankProblems, type RankedProblem } from '@/lib/scoring'

const SEVERITY_CONFIG: Record<
  Severity,
  { label: string; icon: string; color: string; border: string; bg: string }
> = {
  critical: { label: '重大', icon: '🔴', color: 'text-red-700', border: 'border-red-200', bg: 'bg-red-50' },
  warning:  { label: '警告', icon: '⚠️', color: 'text-yellow-700', border: 'border-yellow-200', bg: 'bg-yellow-50' },
  ok:       { label: '正常', icon: '✅', color: 'text-green-700', border: 'border-green-200', bg: 'bg-green-50' },
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

interface ProblemSummaryProps {
  result: AnalysisResult
  onNodeSelect: (nodeId: string | null) => void
  selectedNodeId: string | null
}

export default function ProblemSummary({
  result,
  onNodeSelect,
  selectedNodeId,
}: ProblemSummaryProps) {
  const ranked = rankProblems(result.problems, result.nodes)
  const critical = ranked.filter((p) => p.severity === 'critical')
  const warning  = ranked.filter((p) => p.severity === 'warning')
  const ok       = ranked.filter((p) => p.severity === 'ok')

  const detectedFormatLabel = {
    json: 'JSON形式', tabular: 'テーブル形式', tree: 'TREE形式', unknown: '不明',
  }[result.detectedFormat]

  return (
    <div className="flex flex-col gap-4">
      {/* Summary stats */}
      <div className="flex gap-3">
        {([
          { severity: 'critical' as Severity, count: critical.length },
          { severity: 'warning'  as Severity, count: warning.length },
          { severity: 'ok'       as Severity, count: ok.length },
        ]).map(({ severity, count }) => {
          const cfg = SEVERITY_CONFIG[severity]
          return (
            <div key={severity} className={'flex-1 rounded-lg border p-3 text-center ' + cfg.bg + ' ' + cfg.border}>
              <div className="text-2xl font-bold text-slate-800">{count}</div>
              <div className={'text-xs font-medium ' + cfg.color}>{cfg.icon} {cfg.label}</div>
            </div>
          )
        })}
      </div>

      <div className="text-xs text-slate-400 text-right">検出フォーマット: {detectedFormatLabel}</div>

      {/* Priority-sorted problem list */}
      {ranked.filter((p) => p.severity !== 'ok').length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">優先対応順</h3>
          <div className="space-y-1.5">
            {ranked
              .filter((p) => p.severity !== 'ok')
              .map((problem) => (
                <RankedProblemRow
                  key={problem.nodeId + '-' + problem.title}
                  problem={problem}
                  node={findNode(result.nodes, problem.nodeId)}
                  isSelected={problem.nodeId === selectedNodeId}
                  onClick={() => onNodeSelect(problem.nodeId === selectedNodeId ? null : problem.nodeId)}
                />
              ))}
          </div>
        </div>
      )}

      {/* OK nodes (collapsed) */}
      {ok.length > 0 && (
        <details className="group">
          <summary className="text-xs font-semibold text-green-700 cursor-pointer select-none list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
            ✅ 正常（{ok.length}件）
          </summary>
          <div className="mt-1.5 space-y-1.5">
            {ok.map((problem) => (
              <RankedProblemRow
                key={problem.nodeId + '-' + problem.title}
                problem={problem}
                node={findNode(result.nodes, problem.nodeId)}
                isSelected={problem.nodeId === selectedNodeId}
                onClick={() => onNodeSelect(problem.nodeId === selectedNodeId ? null : problem.nodeId)}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

interface RankedProblemRowProps {
  problem: RankedProblem
  node: ExplainNode | null
  isSelected: boolean
  onClick: () => void
}

function RankedProblemRow({ problem, node, isSelected, onClick }: RankedProblemRowProps) {
  const cfg = SEVERITY_CONFIG[problem.severity]

  return (
    <button
      onClick={onClick}
      className={[
        'w-full text-left rounded-lg border p-2.5 transition-all',
        cfg.bg, cfg.border,
        isSelected ? 'ring-2 ring-blue-400' : 'hover:brightness-95',
      ].join(' ')}
    >
      <div className="flex items-start gap-2">
        {/* Priority rank badge */}
        <span className={
          'flex-shrink-0 text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center text-white mt-0.5 ' +
          (problem.severity === 'critical' ? 'bg-red-500' : problem.severity === 'warning' ? 'bg-yellow-500' : 'bg-green-500')
        }>
          {problem.priorityRank}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <div className="text-sm font-semibold text-slate-800 truncate">{problem.title}</div>
            {isSelected && <span className="text-xs text-blue-600 font-medium flex-shrink-0">選択中</span>}
          </div>
          {node && <div className="text-xs text-slate-500 truncate">テーブル: {node.label}</div>}

          {/* Time percentage bar */}
          {problem.timePercent !== undefined && (
            <div className="flex items-center gap-1 mt-1">
              <div className="flex-1 h-1 bg-white rounded-full overflow-hidden border border-slate-200">
                <div
                  className={'h-full rounded-full ' + (problem.severity === 'critical' ? 'bg-red-400' : 'bg-yellow-400')}
                  style={{ width: Math.max(2, problem.timePercent) + '%' }}
                />
              </div>
              <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">
                {problem.timePercent >= 1 ? problem.timePercent.toFixed(0) : problem.timePercent.toFixed(1)}%
              </span>
              {problem.totalMs !== undefined && (
                <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">
                  ({formatTime(problem.totalMs)})
                </span>
              )}
            </div>
          )}

          <p className="text-xs text-slate-600 mt-1 line-clamp-2">{problem.description}</p>
        </div>
      </div>
    </button>
  )
}
