// ─── Core Domain Types ────────────────────────────────────────────────────────

export type AccessType =
  | 'ALL'
  | 'index'
  | 'range'
  | 'ref'
  | 'eq_ref'
  | 'const'
  | 'system'
  | 'NULL'
  | string

export type Severity = 'critical' | 'warning' | 'ok'

export type ExplainFormat = 'json' | 'tabular' | 'tree' | 'unknown'

export interface ExplainNode {
  id: string
  label: string
  accessType: AccessType
  rows: number
  estimatedRows?: number
  filtered?: number
  cost?: number
  actualTimeStart?: number
  actualTimeEnd?: number
  loops?: number
  actualRows?: number
  extra?: string
  possibleKeys?: string[]
  key?: string
  keyLen?: number
  ref?: string
  selectType?: string
  partitions?: string
  usingTemporary?: boolean
  usingFilesort?: boolean
  children: ExplainNode[]
  rawData?: Record<string, unknown>
}

export interface ProblemAnnotation {
  nodeId: string
  severity: Severity
  title: string
  description: string
  suggestion: string
}

export interface QueryRewriteSuggestion {
  rewrittenSql: string
  explanation: string
  expectedImprovements: string[]
}

export interface AnalysisResult {
  nodes: ExplainNode[]
  problems: ProblemAnnotation[]
  rawExplain: string
  detectedFormat: ExplainFormat
  sql?: string
  rewriteSuggestion?: QueryRewriteSuggestion
}

export interface AnalyzeRequest {
  explainText: string
  hintFormat?: ExplainFormat
  sql?: string
}

export interface AnalyzeResponse {
  success: true
  data: AnalysisResult
}

export interface AnalyzeErrorResponse {
  success: false
  error: string
  details?: string
}

export interface ExplainNodeData extends Record<string, unknown> {
  explainNode: ExplainNode
  severity: Severity
  problems: ProblemAnnotation[]
  isSelected: boolean
  timePercent?: number
}

export interface ParseResult {
  nodes: ExplainNode[]
  format: ExplainFormat
}
