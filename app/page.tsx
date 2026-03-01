'use client'

import { useState, useCallback } from 'react'
import ExplainInput from './components/ExplainInput'
import ExplainGraphWrapper from './components/ExplainGraphWrapper'
import NodeDetail from './components/NodeDetail'
import ProblemSummary from './components/ProblemSummary'
import QueryRewrite from './components/QueryRewrite'
import CompareView from './components/CompareView'
import type { AnalysisResult, AnalyzeErrorResponse, ExplainFormat } from '@/lib/types'
import { rankProblems } from '@/lib/scoring'

async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const permission = await Notification.requestPermission()
  return permission === 'granted'
}

function sendAnalysisNotification(result: AnalysisResult): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  const ranked = rankProblems(result.problems, result.nodes)
  const critical = ranked.filter((p) => p.severity === 'critical').length
  const warning  = ranked.filter((p) => p.severity === 'warning').length
  const body =
    critical > 0 ? '重大: ' + critical + '件 / 警告: ' + warning + '件 の問題が見つかりました'
    : warning > 0 ? '警告: ' + warning + '件 の問題が見つかりました'
    : '問題は検出されませんでした'
  new Notification('SQL 実行計画 解析完了', { body, icon: '/favicon.ico' })
}

type AppState =
  | { phase: 'input' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'result'; result: AnalysisResult }
  | { phase: 'compare'; before: AnalysisResult; after: AnalysisResult }

async function fetchAnalysis(
  explainText: string,
  hintFormat: ExplainFormat,
  sql?: string
): Promise<AnalysisResult> {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ explainText, hintFormat, sql }),
  })
  const json = await res.json()
  if (!res.ok || !json.success) {
    const errJson = json as AnalyzeErrorResponse
    throw new Error(errJson.error + (errJson.details ? '\n詳細: ' + errJson.details : ''))
  }
  return json.data as AnalysisResult
}

export default function Home() {
  const [state, setState] = useState<AppState>({ phase: 'input' })
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const handleAnalyze = useCallback(
    async (explainText: string, hintFormat: ExplainFormat, sql?: string) => {
      setState({ phase: 'loading' })
      setSelectedNodeId(null)
      await requestNotificationPermission()
      try {
        const result = await fetchAnalysis(explainText, hintFormat, sql)
        setState({ phase: 'result', result })
        sendAnalysisNotification(result)
      } catch (err) {
        setState({
          phase: 'error',
          message: err instanceof Error ? err.message : 'ネットワークエラーが発生しました',
        })
      }
    },
    []
  )

  const handleCompare = useCallback(
    async (
      beforeText: string, beforeFormat: ExplainFormat, beforeSql: string | undefined,
      afterText: string, afterFormat: ExplainFormat, afterSql: string | undefined,
    ) => {
      setState({ phase: 'loading' })
      setSelectedNodeId(null)
      await requestNotificationPermission()
      try {
        const [before, after] = await Promise.all([
          fetchAnalysis(beforeText, beforeFormat, beforeSql),
          fetchAnalysis(afterText, afterFormat, afterSql),
        ])
        setState({ phase: 'compare', before, after })
        const afterRanked = rankProblems(after.problems, after.nodes)
        const critical = afterRanked.filter((p) => p.severity === 'critical').length
        const warning  = afterRanked.filter((p) => p.severity === 'warning').length
        const body =
          critical > 0 ? '改善後: 重大 ' + critical + '件 / 警告 ' + warning + '件'
          : warning > 0 ? '改善後: 警告 ' + warning + '件'
          : '改善後: 問題は検出されませんでした'
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          new Notification('SQL 実行計画 比較解析完了', { body, icon: '/favicon.ico' })
        }
      } catch (err) {
        setState({
          phase: 'error',
          message: err instanceof Error ? err.message : 'ネットワークエラーが発生しました',
        })
      }
    },
    []
  )

  const handleReset = useCallback(() => {
    setState({ phase: 'input' })
    setSelectedNodeId(null)
  }, [])

  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId)
  }, [])

  if (state.phase === 'input' || state.phase === 'loading' || state.phase === 'error') {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-3xl bg-white rounded-2xl shadow-lg p-8">
          <ExplainInput
            onAnalyze={handleAnalyze}
            onCompare={handleCompare}
            isLoading={state.phase === 'loading'}
          />
          {state.phase === 'error' && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm font-semibold text-red-700 mb-1">エラー</p>
              <p className="text-sm text-red-600 whitespace-pre-line">{state.message}</p>
              <button
                onClick={handleReset}
                className="mt-2 text-sm text-red-600 underline hover:no-underline"
              >
                もう一度試す
              </button>
            </div>
          )}
        </div>
      </main>
    )
  }

  if (state.phase === 'compare') {
    return (
      <CompareView
        before={state.before}
        after={state.after}
        onReset={handleReset}
      />
    )
  }

  // Result view
  const { result } = state

  return (
    <main className="h-screen flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex-shrink-0 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="font-bold text-slate-800 text-lg">SQL 実行計画アナライザー</h1>
          <div className="flex gap-2 text-sm">
            {(() => {
              const ranked = rankProblems(result.problems, result.nodes)
              const critical = ranked.filter((p) => p.severity === 'critical').length
              const warning = ranked.filter((p) => p.severity === 'warning').length
              return (
                <>
                  {critical > 0 && (
                    <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                      重大 {critical}件
                    </span>
                  )}
                  {warning > 0 && (
                    <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
                      警告 {warning}件
                    </span>
                  )}
                  {critical === 0 && warning === 0 && (
                    <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                      問題なし
                    </span>
                  )}
                </>
              )
            })()}
          </div>
        </div>
        <button
          onClick={handleReset}
          className="text-sm text-slate-500 hover:text-slate-700 border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors"
        >
          ← 新しい解析
        </button>
      </header>

      {/* Main area: graph + sidebars */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar: problem summary + rewrite suggestion */}
        <aside className="w-72 flex-shrink-0 bg-white border-r border-slate-200 overflow-y-auto">
          <div className="p-4">
            <ProblemSummary
              result={result}
              onNodeSelect={handleNodeSelect}
              selectedNodeId={selectedNodeId}
            />
          </div>
          {result.rewriteSuggestion && (
            <div className="border-t border-slate-200 p-4">
              <QueryRewrite suggestion={result.rewriteSuggestion} />
            </div>
          )}
        </aside>

        {/* Center: graph */}
        <div className="flex-1 overflow-hidden">
          <ExplainGraphWrapper
            result={result}
            onNodeSelect={handleNodeSelect}
            selectedNodeId={selectedNodeId}
          />
        </div>

        {/* Right sidebar: node detail */}
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
