'use client'

import dynamic from 'next/dynamic'
import type { AnalysisResult } from '@/lib/types'

const ExplainGraph = dynamic(() => import('./ExplainGraph'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center text-slate-400">
      グラフを読み込んでいます...
    </div>
  ),
})

interface ExplainGraphWrapperProps {
  result: AnalysisResult
  onNodeSelect: (nodeId: string | null) => void
  selectedNodeId: string | null
}

export default function ExplainGraphWrapper(props: ExplainGraphWrapperProps) {
  return <ExplainGraph {...props} />
}
