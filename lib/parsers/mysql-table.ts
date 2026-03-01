import type { ExplainNode } from '@/lib/types'

const KNOWN_HEADERS = [
  'id',
  'select_type',
  'table',
  'partitions',
  'type',
  'possible_keys',
  'key',
  'key_len',
  'ref',
  'rows',
  'filtered',
  'extra',
]

function normalizeNull(val: string | undefined): string | undefined {
  if (!val || val === 'NULL' || val === 'null') return undefined
  return val
}

interface RawRow {
  id: string
  select_type: string
  table: string
  partitions?: string
  type: string
  possible_keys?: string
  key?: string
  key_len?: string
  ref?: string
  rows: string
  filtered?: string
  extra?: string
}

function splitLine(line: string): string[] {
  if (line.includes('|')) {
    return line
      .split('|')
      .slice(1, -1)
      .map((s) => s.trim())
  }
  return line.trim().split(/\t|\s{2,}/).map((s) => s.trim())
}

function parseRow(headers: string[], values: string[]): RawRow {
  const obj: Record<string, string | undefined> = {}
  headers.forEach((h, i) => {
    obj[h.toLowerCase()] = normalizeNull((values[i] ?? '').trim())
  })
  return obj as unknown as RawRow
}

function buildTabularTree(flat: ExplainNode[]): { nodes: ExplainNode[] } {
  const roots: ExplainNode[] = []
  const subqueryTypes = ['SUBQUERY', 'DERIVED', 'UNION', 'DEPENDENT SUBQUERY', 'UNCACHEABLE SUBQUERY']

  for (const node of flat) {
    if (!subqueryTypes.includes((node.selectType ?? '').toUpperCase())) {
      roots.push(node)
    } else {
      if (roots.length > 0) {
        roots[roots.length - 1].children.push(node)
      } else {
        roots.push(node)
      }
    }
  }

  // If multiple roots, wrap under a virtual root
  if (roots.length > 1) {
    const virtualRoot: ExplainNode = {
      id: 'node-root',
      label: 'Query',
      accessType: 'operation',
      rows: 0,
      children: roots,
    }
    return { nodes: [virtualRoot] }
  }

  return { nodes: roots }
}

export function parseTabularExplain(text: string): { nodes: ExplainNode[] } {
  const lines = text.split('\n').filter((l) => l.trim())
  const dataLines: string[] = []
  let headers: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    // Skip MySQL separator lines like "+----+-------------+..."
    if (/^[+\-=]+$/.test(trimmed.replace(/[\s|]/g, ''))) continue

    const parts = splitLine(line)
    if (parts.length === 0) continue

    const isHeader = KNOWN_HEADERS.includes(parts[0]?.toLowerCase() ?? '')
    if (isHeader && headers.length === 0) {
      headers = parts.map((h) => h.toLowerCase())
    } else if (headers.length > 0 && /^\d+$/.test(parts[0])) {
      dataLines.push(line)
    }
  }

  let nodeIndex = 0
  const nodes: ExplainNode[] = dataLines.map((line) => {
    const values = splitLine(line)
    const row = parseRow(headers, values)

    const extraStr = normalizeNull(row.extra ?? '')
    const usingFilesort = extraStr?.toLowerCase().includes('using filesort') ?? false
    const usingTemporary = extraStr?.toLowerCase().includes('using temporary') ?? false

    return {
      id: `node-${++nodeIndex}`,
      label: row.table ?? 'unknown',
      accessType: row.type ?? 'ALL',
      rows: parseInt(row.rows ?? '0', 10),
      filtered: row.filtered ? parseFloat(row.filtered) : undefined,
      extra: extraStr,
      possibleKeys: row.possible_keys
        ? row.possible_keys.split(',').map((k) => k.trim())
        : undefined,
      key: normalizeNull(row.key ?? ''),
      keyLen: row.key_len ? parseInt(row.key_len, 10) : undefined,
      ref: normalizeNull(row.ref ?? ''),
      selectType: row.select_type,
      partitions: normalizeNull(row.partitions ?? ''),
      usingFilesort,
      usingTemporary,
      children: [],
    }
  })

  return buildTabularTree(nodes)
}
