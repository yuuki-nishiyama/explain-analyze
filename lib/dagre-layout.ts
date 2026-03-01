import dagre from '@dagrejs/dagre'
import { type Node, type Edge, Position } from '@xyflow/react'
import type {
  ExplainNode,
  ExplainNodeData,
  ProblemAnnotation,
  Severity,
} from '@/lib/types'
import { computeNodeTimePercents } from '@/lib/scoring'

const NODE_WIDTH = 230
const NODE_HEIGHT = 130

function getSeverityForNode(
  nodeId: string,
  problems: ProblemAnnotation[],
  node?: ExplainNode
): Severity {
  const nodeProblems = problems.filter((p) => p.nodeId === nodeId)
  let aiSeverity: Severity = 'ok'
  if (nodeProblems.some((p) => p.severity === 'critical')) aiSeverity = 'critical'
  else if (nodeProblems.some((p) => p.severity === 'warning')) aiSeverity = 'warning'

  // Frontend enforcement: override with time-based rules regardless of AI judgment
  if (node?.actualTimeEnd !== undefined && node?.loops !== undefined) {
    const totalMs = node.actualTimeEnd * node.loops
    if (totalMs > 10000 && aiSeverity !== 'critical') return 'critical'
    if (totalMs > 1000 && aiSeverity === 'ok') return 'warning'
  }

  return aiSeverity
}

function flattenNodes(
  nodes: ExplainNode[],
  problems: ProblemAnnotation[],
  timePercents: Map<string, number>,
  rfNodes: Node[],
  rfEdges: Edge[],
  parentId?: string
) {
  for (const node of nodes) {
    const severity = getSeverityForNode(node.id, problems, node)
    const nodeProblems = problems.filter((p) => p.nodeId === node.id)

    const data: ExplainNodeData = {
      explainNode: node,
      severity,
      problems: nodeProblems,
      isSelected: false,
      timePercent: timePercents.get(node.id),
    }

    rfNodes.push({
      id: node.id,
      type: 'explainNode',
      position: { x: 0, y: 0 },
      data,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })

    if (parentId) {
      rfEdges.push({
        id: parentId + '->' + node.id,
        source: parentId,
        target: node.id,
        type: 'smoothstep',
        animated: severity === 'critical',
        style: {
          stroke:
            severity === 'critical'
              ? '#EF4444'
              : severity === 'warning'
              ? '#F59E0B'
              : '#94A3B8',
          strokeWidth: 2,
        },
      })
    }

    if (node.children.length > 0) {
      flattenNodes(node.children, problems, timePercents, rfNodes, rfEdges, node.id)
    }
  }
}

export function computeDagreLayout(
  explainNodes: ExplainNode[],
  problems: ProblemAnnotation[]
): { nodes: Node[]; edges: Edge[] } {
  const rfNodes: Node[] = []
  const rfEdges: Edge[] = []
  const timePercents = computeNodeTimePercents(explainNodes)

  flattenNodes(explainNodes, problems, timePercents, rfNodes, rfEdges)

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: 'TB',
    ranksep: 70,
    nodesep: 50,
    marginx: 30,
    marginy: 30,
  })

  rfNodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  })
  rfEdges.forEach((edge) => {
    g.setEdge(edge.source, edge.target)
  })

  dagre.layout(g)

  const layoutedNodes = rfNodes.map((node) => {
    const dagreNode = g.node(node.id)
    return {
      ...node,
      position: {
        x: dagreNode.x - NODE_WIDTH / 2,
        y: dagreNode.y - NODE_HEIGHT / 2,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    }
  })

  return { nodes: layoutedNodes, edges: rfEdges }
}
