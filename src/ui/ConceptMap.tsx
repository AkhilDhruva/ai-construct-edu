import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import type { ConceptGraph } from '../mantle/engine/graph'

export interface ConceptMapProps {
  graph: ConceptGraph
  mastery: (id: string) => number
  threshold: number
  routeOf: (tentacleId: string) => string
  /** Display name for a tentacle lane. */
  laneTitle?: (tentacleId: string) => string
  /** Concepts to dim (for example out of the learner's scope). */
  dimmed?: Set<string>
  height?: number
}

/** Longest-path layering: a concept sits one column right of its deepest prerequisite. */
export function layerOf(graph: ConceptGraph): Map<string, number> {
  const layer = new Map<string, number>()
  for (const id of graph.topo) {
    const pre = graph.concepts.get(id)!.prerequisites
    layer.set(id, pre.length ? Math.max(...pre.map((p) => layer.get(p) ?? 0)) + 1 : 0)
  }
  return layer
}

export function ConceptMap({ graph, mastery, threshold, routeOf, laneTitle = (t) => t, dimmed, height = 520 }: ConceptMapProps) {
  const navigate = useNavigate()
  const { nodes, edges } = useMemo(() => {
    const layer = layerOf(graph)
    // One horizontal lane per tentacle (in install order), columns by prerequisite depth.
    const lanes = [...new Set(graph.topo.map((id) => graph.concepts.get(id)!.tentacle))]
    const rowOf = new Map<string, number>()
    const cellCount = new Map<string, number>()
    const laneRows = new Map<string, number>()
    for (const id of graph.topo) {
      const t = graph.concepts.get(id)!.tentacle
      const cell = `${t}|${layer.get(id)}`
      const row = cellCount.get(cell) ?? 0
      rowOf.set(id, row)
      cellCount.set(cell, row + 1)
      laneRows.set(t, Math.max(laneRows.get(t) ?? 0, row + 1))
    }
    const laneTop = new Map<string, number>()
    let top = 0
    for (const t of lanes) {
      laneTop.set(t, top)
      top += (laneRows.get(t) ?? 1) * 84 + 70
    }
    const laneLabels: Node[] = lanes.map((t) => ({
      id: `lane:${t}`,
      position: { x: -230, y: laneTop.get(t)! },
      data: { label: laneTitle(t) },
      className: 'cmap-lane',
      draggable: false,
      selectable: false,
      focusable: false,
    }))
    const conceptNodes: Node[] = graph.topo.map((id) => {
      const c = graph.concepts.get(id)!
      const l = layer.get(id)!
      const row = rowOf.get(id)!
      const m = mastery(id)
      const state = m >= threshold ? 'mastered' : m >= 0.4 ? 'progress' : 'new'
      return {
        id,
        position: { x: l * 230, y: laneTop.get(c.tentacle)! + row * 84 },
        data: { label: `${c.title} · ${Math.round(m * 100)}%` },
        className: `cmap-node cmap-${state}${dimmed?.has(id) ? ' cmap-dim' : ''}`,
        ariaLabel: `${c.title}, ${c.tentacle}, mastery ${Math.round(m * 100)}%`,
      }
    })
    const nodes = [...laneLabels, ...conceptNodes]
    const edges: Edge[] = graph.topo.flatMap((id) =>
      graph.concepts.get(id)!.prerequisites.map((p) => ({
        id: `${p}->${id}`,
        source: p,
        target: id,
        markerEnd: { type: MarkerType.ArrowClosed },
        className: 'cmap-edge',
      })),
    )
    return { nodes, edges }
  }, [graph, mastery, threshold, dimmed, laneTitle])

  return (
    <div style={{ height, border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }} data-testid="concept-map">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        minZoom={0.3}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_, n) => {
          const c = graph.concepts.get(n.id)
          if (c) navigate(`${routeOf(c.tentacle)}/c/${c.id}`)
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--border)" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
