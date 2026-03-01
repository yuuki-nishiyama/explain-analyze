import type { ExplainNode } from '@/lib/types'

let nodeCounter = 0

function resetCounter() {
  nodeCounter = 0
}

function nextId() {
  return `node-${++nodeCounter}`
}

function parseTable(tableObj: Record<string, unknown>, _parentId?: string): ExplainNode {
  const id = nextId()
  const extraParts: string[] = []

  if (tableObj.using_filesort) extraParts.push('Using filesort')
  if (tableObj.using_temporary_table) extraParts.push('Using temporary')
  if (tableObj.backward_index_scan) extraParts.push('Backward index scan')
  if (tableObj.attached_condition) extraParts.push(`cond: ${tableObj.attached_condition}`)

  const costInfo = tableObj.cost_info as Record<string, string> | undefined
  const totalCost = costInfo
    ? parseFloat(costInfo.read_cost ?? '0') + parseFloat(costInfo.eval_cost ?? '0')
    : undefined

  const node: ExplainNode = {
    id,
    label: (tableObj.table_name as string) ?? (tableObj.alias as string) ?? 'unknown',
    accessType: (tableObj.access_type as string) ?? 'ALL',
    rows: parseInt(String(tableObj.rows_examined_per_scan ?? tableObj.rows ?? 0), 10),
    filtered: parseFloat(String(tableObj.filtered ?? 100)),
    cost: totalCost,
    extra: extraParts.length > 0 ? extraParts.join('; ') : undefined,
    possibleKeys: Array.isArray(tableObj.possible_keys)
      ? (tableObj.possible_keys as string[])
      : undefined,
    key: (tableObj.key as string) ?? undefined,
    keyLen: tableObj.key_length
      ? parseInt(tableObj.key_length as string, 10)
      : undefined,
    usingFilesort: !!tableObj.using_filesort,
    usingTemporary: !!tableObj.using_temporary_table,
    children: [],
    rawData: tableObj,
  }

  // Recursively parse nested_loop children
  const nestedLoop = tableObj.nested_loop as Record<string, unknown>[] | undefined
  if (nestedLoop) {
    for (const entry of nestedLoop) {
      if (entry.table) {
        node.children.push(parseTable(entry.table as Record<string, unknown>, id))
      }
    }
  }

  // Handle materialized subqueries
  const materializedFromSubquery = tableObj.materialized_from_subquery as
    | Record<string, unknown>
    | undefined
  if (materializedFromSubquery?.query_block) {
    const subNodes = parseQueryBlock(
      materializedFromSubquery.query_block as Record<string, unknown>,
      id
    )
    node.children.push(...subNodes)
  }

  return node
}

function parseQueryBlock(
  block: Record<string, unknown>,
  prefix?: string
): ExplainNode[] {
  const nodes: ExplainNode[] = []

  if (block.table) {
    nodes.push(parseTable(block.table as Record<string, unknown>, prefix))
  }

  // Handle nested_loop at query_block level
  if (block.nested_loop) {
    const nestedLoop = block.nested_loop as Record<string, unknown>[]
    for (const entry of nestedLoop) {
      if (entry.table) {
        nodes.push(parseTable(entry.table as Record<string, unknown>, prefix))
      }
    }
  }

  // Handle UNION
  const unionResult = block.union_result as Record<string, unknown> | undefined
  if (unionResult?.query_specifications) {
    const specs = unionResult.query_specifications as Record<string, unknown>[]
    for (const spec of specs) {
      if (spec.query_block) {
        nodes.push(
          ...parseQueryBlock(spec.query_block as Record<string, unknown>, prefix)
        )
      }
    }
  }

  return nodes
}

export function parseJsonExplain(text: string): { nodes: ExplainNode[] } {
  resetCounter()
  const raw = JSON.parse(text.trim())
  const block = raw.query_block ?? raw[0]?.query_block
  if (!block) throw new Error('No query_block found in JSON EXPLAIN output')

  const rootCost = (block.cost_info as Record<string, string> | undefined)?.query_cost
  const nodes = parseQueryBlock(block)

  if (nodes.length > 0 && rootCost && !nodes[0].cost) {
    nodes[0].cost = parseFloat(rootCost)
  }

  // Build tree from flat list: first node is root, rest are its children
  if (nodes.length > 1) {
    const root = nodes[0]
    root.children = [...root.children, ...nodes.slice(1)]
    return { nodes: [root] }
  }

  return { nodes }
}
