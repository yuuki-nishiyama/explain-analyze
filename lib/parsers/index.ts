import type { ExplainFormat, ParseResult } from '@/lib/types'
import { parseJsonExplain } from './mysql-json'
import { parseTabularExplain } from './mysql-table'
import { parseTreeExplain } from './mysql-tree'

export function detectFormat(text: string): ExplainFormat {
  const trimmed = text.trim()

  // JSON format: starts with { and contains query_block
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed?.query_block || parsed?.[0]?.query_block) {
        return 'json'
      }
    } catch {
      // Not valid JSON
    }
  }

  // TREE format: first meaningful line starts with "->"
  const firstMeaningfulLine =
    trimmed
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ''

  if (firstMeaningfulLine.startsWith('->')) {
    return 'tree'
  }

  // Tabular format: has pipe-separated header or space-aligned header
  const headerPatterns = [
    /id\s*\|\s*select_type/i,
    /\|\s*id\s*\|\s*select_type\s*\|/i,
    /^\s*id\s+select_type\s+table/im,
  ]
  if (headerPatterns.some((p) => p.test(trimmed))) {
    return 'tabular'
  }

  return 'unknown'
}

export function parseExplain(
  text: string,
  hintFormat?: ExplainFormat
): ParseResult {
  const format =
    hintFormat && hintFormat !== 'unknown' ? hintFormat : detectFormat(text)

  switch (format) {
    case 'json':
      return { ...parseJsonExplain(text), format: 'json' }
    case 'tree':
      return { ...parseTreeExplain(text), format: 'tree' }
    case 'tabular':
      return { ...parseTabularExplain(text), format: 'tabular' }
    default:
      throw new Error(
        'EXPLAIN のフォーマットを自動判定できませんでした。' +
          'JSON形式（{で始まる）、TREE形式（->で始まる）、またはテーブル形式（id | select_type ヘッダー）で入力してください。'
      )
  }
}
