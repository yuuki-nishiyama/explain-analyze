'use client'

import { useCallback, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ExplainNodeComponent } from './nodes/ExplainNode'
import { computeDagreLayout } from '@/lib/dagre-layout'
import type { AnalysisResult, ExplainNodeData, Severity } from '@/lib/types'

// Defined outside component to avoid re-creating on every render
const nodeTypes = {
  explainNode: ExplainNodeComponent,
}

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: '#EF4444',
  warning: '#F59E0B',
  ok: '#10B981',
}

interface ExplainGraphProps {
  result: AnalysisResult
  onNodeSelect: (nodeId: string | null) => void
  selectedNodeId: string | null
}

export default function ExplainGraph({
  result,
  onNodeSelect,
  selectedNodeId,
}: ExplainGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  useEffect(() => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = computeDagreLayout(
      result.nodes,
      result.problems
    )
    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
  }, [result, setNodes, setEdges])

  // Update isSelected when selectedNodeId changes
  useEffect(() => {
    setNodes((nds: Node[]) =>
      nds.map((n: Node) => ({
        ...n,
        data: {
          ...n.data,
          isSelected: n.id === selectedNodeId,
        },
      }))
    )
  }, [selectedNodeId, setNodes])

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onNodeSelect(node.id === selectedNodeId ? null : node.id)
    },
    [selectedNodeId, onNodeSelect]
  )

  const onPaneClick = useCallback(() => {
    onNodeSelect(null)
  }, [onNodeSelect])

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        attributionPosition="bottom-right"
      >
        <Background color="#e2e8f0" gap={20} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const severity = (node.data as ExplainNodeData)?.severity ?? 'ok'
            return SEVERITY_COLORS[severity as Severity]
          }}
          maskColor="rgba(248, 250, 252, 0.7)"
        />
      </ReactFlow>
    </div>
  )
}
