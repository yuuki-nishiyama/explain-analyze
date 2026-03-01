import type { ExplainNode, ProblemAnnotation, Severity } from '@/lib/types'

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 3,
  warning: 2,
  ok: 1,
}

// Get the root node's total execution time as the baseline for percentages
function getRootTotalMs(nodes: ExplainNode[]): number | undefined {
  const root = nodes[0]
  if (!root) return undefined
  if (root.actualTimeEnd !== undefined && root.loops !== undefined) {
    return root.actualTimeEnd * root.loops
  }
  return undefined
}

// Compute each node's share (%) of the total query execution time
export function computeNodeTimePercents(nodes: ExplainNode[]): Map<string, number> {
  const percents = new Map<string, number>()
  const rootMs = getRootTotalMs(nodes)
  if (rootMs === undefined || rootMs === 0) return percents

  function walk(node: ExplainNode): void {
    if (node.actualTimeEnd !== undefined && node.loops !== undefined) {
      const nodeMs = node.actualTimeEnd * node.loops
      percents.set(node.id, Math.min(100, (nodeMs / rootMs!) * 100))
    }
    node.children.forEach(walk)
  }
  nodes.forEach(walk)
  return percents
}

function findNodeById(nodes: ExplainNode[], id: string): ExplainNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const found = findNodeById(n.children, id)
    if (found) return found
  }
  return null
}

// Apply the same frontend enforcement as dagre-layout.ts / NodeDetail.tsx.
// Ensures severity is consistent across all UI surfaces regardless of AI judgment.
export function getEffectiveSeverity(
  problem: ProblemAnnotation,
  nodes: ExplainNode[]
): Severity {
  const node = findNodeById(nodes, problem.nodeId)
  if (node?.actualTimeEnd !== undefined && node?.loops !== undefined) {
    const totalMs = node.actualTimeEnd * node.loops
    if (totalMs > 10000 && problem.severity !== 'critical') return 'critical'
    if (totalMs > 1000 && problem.severity === 'ok') return 'warning'
  }
  return problem.severity
}

export interface RankedProblem extends ProblemAnnotation {
  priorityRank: number
  priorityScore: number
  timePercent?: number
  totalMs?: number
}

export function rankProblems(
  problems: ProblemAnnotation[],
  nodes: ExplainNode[]
): RankedProblem[] {
  const timePercents = computeNodeTimePercents(nodes)

  const withScores = problems.map((p) => {
    const effectiveSeverity = getEffectiveSeverity(p, nodes)
    const tp = timePercents.get(p.nodeId)
    const node = findNodeById(nodes, p.nodeId)
    const tm =
      node?.actualTimeEnd !== undefined && node?.loops !== undefined
        ? node.actualTimeEnd * node.loops
        : undefined
    const sw = SEVERITY_WEIGHT[effectiveSeverity]
    // Severity dominates; within the same severity, higher time % and absolute ms rank first
    const score = sw * 1_000_000 + (tp ?? 0) * 1_000 + Math.min(tm ?? 0, 999_999) / 1_000
    return { ...p, severity: effectiveSeverity, timePercent: tp, totalMs: tm, priorityScore: score }
  })

  withScores.sort((a, b) => b.priorityScore - a.priorityScore)
  return withScores.map((p, i) => ({ ...p, priorityRank: i + 1 }))
}
