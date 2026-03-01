'use client'

import { useState } from 'react'
import type { AnalysisResult, Severity } from '@/lib/types'
import { rankProblems } from '@/lib/scoring'
import ExplainGraphWrapper from './ExplainGraphWrapper'
import NodeDetail from './NodeDetail'
import ProblemSummary from './ProblemSummary'
import QueryRewrite from './QueryRewrite'

interface CompareViewProps {
  before: AnalysisResult
  after: AnalysisResult
  onReset: () => void
}

function formatTime(ms: number): string {
  if (ms >= 60000) return (ms / 60000).toFixed(1) + 'm'
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's'
  if (ms >= 1) return ms.toFixed(0) + 'ms'
  return ms.toFixed(2) + 'ms'
}

function getRootTotalMs(result: AnalysisResult): number | undefined {
  const root = result.nodes[0]
  if (!root || root.actualTimeEnd === undefined || root.loops === undefined) return undefined
  return root.actualTimeEnd * root.loops
}

function countBySeverity(result: AnalysisResult, severity: Severity): number {
  return rankProblems(result.problems, result.nodes).filter((p) => p.severity === severity).length
}

function DiffBadge({ before, after, label, isTime }: { before: number; after: number; label: string; isTime?: boolean }) {
  const improved = isTime ? after < before : after < before
  const worsened = isTime ? after > before : after > before
  const diff = after - before

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <span className="text-slate-500 font-mono">{isTime ? formatTime(before) : before}</span>
        <span className="text-slate-400">→</span>
        <span className={'font-mono ' + (improved ? 'text-green-600' : worsened ? 'text-red-600' : 'text-slate-600')}>
          {isTime ? formatTime(after) : after}
        </span>
        {diff !== 0 && (
          <span className={'text-xs px-1 py-0.5 rounded ' + (improved ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
            {improved ? '▼' : '▲'}{isTime ? '' : Math.abs(diff)}
          </span>
        )}
      </div>
    </div>
  )
}

export default function CompareView({ before, after, onReset }: CompareViewProps) {
  const [viewing, setViewing] = useState<'before' | 'after'>('after')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const result = viewing === 'before' ? before : after
  const beforeMs = getRootTotalMs(before)
  const afterMs = getRootTotalMs(after)

  return (
    <main className="h-screen flex flex-col overflow-hidden">
      {/* Compare header */}
      <header className="flex-shrink-0 bg-white border-b border-slate-200 px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <h1 className="font-bold text-slate-800">Before / After 比較</h1>

            {/* Diff stats */}
            <div className="flex items-center gap-5">
              {beforeMs !== undefined && afterMs !== undefined && (
                <DiffBadge
                  before={beforeMs}
                  after={afterMs}
                  label="合計時間"
                  isTime
                />
              )}
              <DiffBadge
                before={countBySeverity(before, 'critical')}
                after={countBySeverity(after, 'critical')}
                label="重大"
              />
              <DiffBadge
                before={countBySeverity(before, 'warning')}
                after={countBySeverity(after, 'warning')}
                label="警告"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Before/After toggle */}
            <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm font-medium">
              <button
                onClick={() => { setViewing('before'); setSelectedNodeId(null) }}
                className={'px-4 py-1.5 transition-colors ' + (viewing === 'before' ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
              >
                改善前
              </button>
              <button
                onClick={() => { setViewing('after'); setSelectedNodeId(null) }}
                className={'px-4 py-1.5 transition-colors ' + (viewing === 'after' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
              >
                改善後
              </button>
            </div>

            <button
              onClick={onReset}
              className="text-sm text-slate-500 hover:text-slate-700 border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors"
            >
              ← 新しい解析
            </button>
          </div>
        </div>
      </header>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar */}
        <aside className="w-72 flex-shrink-0 bg-white border-r border-slate-200 overflow-y-auto p-4">
          <div className="mb-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">
            {viewing === 'before' ? '改善前' : '改善後'}の問題
          </div>
          <ProblemSummary
            result={result}
            onNodeSelect={setSelectedNodeId}
            selectedNodeId={selectedNodeId}
          />
          {result.rewriteSuggestion && (
            <div className="mt-4 border-t border-slate-200 pt-4">
              <QueryRewrite suggestion={result.rewriteSuggestion} />
            </div>
          )}
        </aside>

        {/* Graph */}
        <div className="flex-1 overflow-hidden">
          <ExplainGraphWrapper
            result={result}
            onNodeSelect={setSelectedNodeId}
            selectedNodeId={selectedNodeId}
          />
        </div>

        {/* Right sidebar */}
        {selectedNodeId && (
          <aside className="w-80 flex-shrink-0 bg-white border-l border-slate-200 overflow-hidden flex flex-col">
            <NodeDetail
              result={result}
              selectedNodeId={selectedNodeId}
              onClose={() => setSelectedNodeId(null)}
            />
          </aside>
        )}
      </div>
    </main>
  )
}
