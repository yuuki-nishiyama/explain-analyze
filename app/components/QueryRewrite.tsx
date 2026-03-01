'use client'

import type { QueryRewriteSuggestion } from '@/lib/types'
import { useState } from 'react'

interface QueryRewriteProps {
  suggestion: QueryRewriteSuggestion
}

export default function QueryRewrite({ suggestion }: QueryRewriteProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(suggestion.rewrittenSql).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        AI によるクエリ書き換え提案
      </h3>

      {/* Explanation */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-sm text-blue-800 leading-relaxed">{suggestion.explanation}</p>
      </div>

      {/* Expected improvements */}
      {suggestion.expectedImprovements.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-1.5">期待される改善効果</div>
          <ul className="space-y-1">
            {suggestion.expectedImprovements.map((imp, i) => (
              <li key={i} className="flex items-start gap-1.5 text-sm text-slate-700">
                <span className="text-green-500 flex-shrink-0 mt-0.5">✓</span>
                <span>{imp}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Rewritten SQL */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-xs font-semibold text-slate-500">改善後 SQL</div>
          <button
            onClick={handleCopy}
            className="text-xs text-slate-500 hover:text-slate-700 border border-slate-300 rounded px-2 py-0.5 hover:bg-slate-50 transition-colors"
          >
            {copied ? 'コピー済み ✓' : 'コピー'}
          </button>
        </div>
        <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 text-xs font-mono overflow-x-auto leading-relaxed whitespace-pre-wrap">
          {suggestion.rewrittenSql}
        </pre>
      </div>
    </div>
  )
}
