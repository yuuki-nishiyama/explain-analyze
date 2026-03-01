import type { ExplainNode } from '@/lib/types'

const PATTERNS = {
  estimatedCost: /\(cost=([\d.]+)/,
  estimatedRows: /cost=[^)]*\brows=([\d.]+)/,
  actualTime: /\(actual time=([\d.]+)\.\.([\d.]+) rows=(\d+) loops=(\d+)\)/,
  tableScan: /Table scan on (\w+)/i,
  indexLookup: /Index (?:lookup|scan) on (\w+)(?: using (\w+))?/i,
  indexRangeScan: /Index range scan on (\w+)(?: using (\w+))?/i,
  nestedLoop: /Nested loop (inner|left|right|outer|semi|anti)?\s*join/i,
  singleRow: /Single-row index lookup on (\w+)/i,
  filter: /^Filter:/i,
  sort: /^Sort:/i,
  aggregate: /^Aggregate:/i,
  groupAggregate: /^Group aggregate:/i,
  materialize: /^Materialize/i,
  union: /^Union materialize/i,
  limit: /^Limit\/Offset:/i,
}

function extractAccessType(text: string): string {
  if (PATTERNS.tableScan.test(text)) return 'ALL'
  if (PATTERNS.indexRangeScan.test(text)) return 'range'
  if (PATTERNS.singleRow.test(text)) return 'eq_ref'
  if (PATTERNS.indexLookup.test(text)) return 'ref'
  if (PATTERNS.nestedLoop.test(text)) return 'join'
  if (PATTERNS.sort.test(text)) return 'sort'
  if (PATTERNS.aggregate.test(text) || PATTERNS.groupAggregate.test(text)) return 'aggregate'
  if (PATTERNS.filter.test(text)) return 'filter'
  if (PATTERNS.materialize.test(text) || PATTERNS.union.test(text)) return 'materialize'
  if (PATTERNS.limit.test(text)) return 'limit'
  return 'operation'
}

function extractLabel(text: string): string {
  const tableScanMatch = text.match(PATTERNS.tableScan)
  if (tableScanMatch) return tableScanMatch[1]

  const indexRangeMatch = text.match(PATTERNS.indexRangeScan)
  if (indexRangeMatch) return indexRangeMatch[1]

  const indexMatch = text.match(PATTERNS.indexLookup)
  if (indexMatch) return indexMatch[1]

  const singleRowMatch = text.match(PATTERNS.singleRow)
  if (singleRowMatch) return singleRowMatch[1]

  const cleaned = text
    .replace(/\s*\(cost[^)]*\)[^)]*\)?/g, '')
    .replace(/\s*\(actual[^)]*\)/g, '')
    .replace(/^->\s*/, '')
    .trim()

  return cleaned.length > 40 ? cleaned.substring(0, 40) + '...' : cleaned
}

interface IndentedLine {
  indent: number
  text: string
}

function parseLine(line: string): IndentedLine | null {
  const match = line.match(/^(\s*)->\s*(.+)$/)
  if (!match) return null
  return {
    indent: match[1].length,
    text: match[2].trim(),
  }
}

let treeNodeCounter = 0

function buildTree(
  lines: IndentedLine[],
  start: number,
  parentIndent: number
): { node: ExplainNode | null; nextIndex: number } {
  if (start >= lines.length) return { node: null, nextIndex: start }

  const line = lines[start]
  if (line.indent <= parentIndent && start > 0) return { node: null, nextIndex: start }

  const id = 'node-' + (++treeNodeCounter)
  const costMatch = line.text.match(PATTERNS.estimatedCost)
  const estimatedRowsMatch = line.text.match(PATTERNS.estimatedRows)
  const actualMatch = line.text.match(PATTERNS.actualTime)

  const estimatedRows = estimatedRowsMatch
    ? parseFloat(estimatedRowsMatch[1])
    : undefined

  const actualTimeStart = actualMatch ? parseFloat(actualMatch[1]) : undefined
  const actualTimeEnd = actualMatch ? parseFloat(actualMatch[2]) : undefined
  const actualRows = actualMatch ? parseInt(actualMatch[3], 10) : undefined
  const loops = actualMatch ? parseInt(actualMatch[4], 10) : undefined

  // Prefer actual rows over estimated; estimated can be fractional
  const rows = actualRows ?? Math.round(estimatedRows ?? 0)

  const node: ExplainNode = {
    id,
    label: extractLabel(line.text),
    accessType: extractAccessType(line.text),
    rows,
    estimatedRows,
    cost: costMatch ? parseFloat(costMatch[1]) : undefined,
    actualTimeStart,
    actualTimeEnd,
    actualRows,
    loops,
    usingFilesort: line.text.toLowerCase().includes('using filesort'),
    extra: line.text.toLowerCase().includes('using filesort') ? 'Using filesort' : undefined,
    children: [],
    rawData: { originalText: line.text },
  }

  let i = start + 1
  while (i < lines.length && lines[i].indent > line.indent) {
    const result = buildTree(lines, i, line.indent)
    if (result.node) {
      node.children.push(result.node)
      i = result.nextIndex
    } else {
      i++
    }
  }

  return { node, nextIndex: i }
}

export function parseTreeExplain(text: string): { nodes: ExplainNode[] } {
  treeNodeCounter = 0
  const rawLines = text.split('\n')
  const indentedLines: IndentedLine[] = rawLines
    .map(parseLine)
    .filter((l): l is IndentedLine => l !== null)

  if (indentedLines.length === 0) return { nodes: [] }

  const { node } = buildTree(indentedLines, 0, -1)
  return { nodes: node ? [node] : [] }
}
