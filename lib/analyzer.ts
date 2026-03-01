import Anthropic from '@anthropic-ai/sdk'
import type { ExplainNode, ProblemAnnotation, QueryRewriteSuggestion } from '@/lib/types'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const ANALYSIS_TOOL: Anthropic.Tool = {
  name: 'report_explain_problems',
  description: 'MySQL EXPLAINの実行計画に含まれるすべてのパフォーマンス問題を報告する',
  input_schema: {
    type: 'object' as const,
    properties: {
      problems: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nodeId: {
              type: 'string',
              description: '問題が属する ExplainNode の id フィールド（完全一致）',
            },
            severity: {
              type: 'string',
              enum: ['critical', 'warning', 'ok'],
              description: 'critical=即座に対応必要, warning=対応推奨, ok=許容範囲内',
            },
            title: {
              type: 'string',
              description: '"Full Table Scan", "Slow Actual Time", "Missing Index" など短い問題名',
            },
            description: {
              type: 'string',
              description: 'なぜ問題か、実行計画の具体的な数値を含む説明（日本語）',
            },
            suggestion: {
              type: 'string',
              description: 'CREATE INDEXなど具体的なSQLや設定変更（日本語）',
            },
          },
          required: ['nodeId', 'severity', 'title', 'description', 'suggestion'],
        },
      },
      rewriteSuggestion: {
        type: 'object',
        description: 'SQLが提供された場合のみ記入。クエリ全体の書き換え提案。提供されていない場合は省略。',
        properties: {
          rewrittenSql: {
            type: 'string',
            description: '改善されたSQLクエリ（実行可能な完全なSQL）',
          },
          explanation: {
            type: 'string',
            description: 'なぜこの書き換えで改善されるか、具体的な説明（日本語）',
          },
          expectedImprovements: {
            type: 'array',
            items: { type: 'string' },
            description: '期待される改善効果のリスト（日本語）。例: "フルスキャンがインデックス参照に変わる"',
          },
        },
        required: ['rewrittenSql', 'explanation', 'expectedImprovements'],
      },
    },
    required: ['problems'],
  },
}

function buildSystemPrompt(): string {
  return 'あなたはMySQLのクエリパフォーマンス専門家です。EXPLAIN / EXPLAIN ANALYZE実行計画を分析し、パフォーマンス問題を特定して具体的な改善策を提示します。\n\n' +
    '## Severity（深刻度）の判定基準\n\n' +
    '### 実測時間（actualTimeEnd × loops）が存在する場合は最優先で評価すること\n\n' +
    '**critical**（即座に対応必要）:\n' +
    '- actualTimeEnd × loops > 10000ms（合計10秒超）\n' +
    '- actualTimeEnd × loops > 1000ms かつ access_type = "ALL"（遅いフルスキャン）\n' +
    '- access_type = "ALL" かつ rows > 1000（フルテーブルスキャン）\n' +
    '- access_type = "index" かつ rows > 10000（フルインデックススキャン）\n' +
    '- JOIN条件でkey（インデックス）が null\n' +
    '- Using temporary + Using filesort の両方\n' +
    '- filtered < 10% かつ rows > 10000\n\n' +
    '**warning**（対応推奨）:\n' +
    '- actualTimeEnd × loops が 1000ms〜10000ms\n' +
    '- access_type = "ALL" かつ rows 100〜1000\n' +
    '- Using filesort 単独\n' +
    '- Using temporary 単独\n' +
    '- possible_keysに候補があるがkeyがnull\n' +
    '- filtered < 30%\n' +
    '- actualRows が estimatedRows の 10倍超（統計情報が古い可能性）\n\n' +
    '**ok**（許容範囲内）:\n' +
    '- access_type = "eq_ref", "const", "system"\n' +
    '- access_type = "ref" で rows が少なく actualTime も小さい\n' +
    '- access_type = "range"\n\n' +
    '## 実測時間の計算方法\n' +
    '- 合計実測時間 = actualTimeEnd × loops\n' +
    '- 例: actualTimeEnd=567046, loops=1 → 合計567秒 → critical\n\n' +
    '## クエリ書き換え提案 (rewriteSuggestion)\n' +
    '- SQLが提供された場合のみ rewriteSuggestion を記入する\n' +
    '- 最も効果的な改善版SQLを提案する（インデックスの活用、不要なサブクエリの除去、N+1の解消など）\n' +
    '- 書き換え後のSQLは完全で実行可能なものにする\n' +
    '- expectedImprovements には具体的な改善効果を列挙する\n\n' +
    '## ルール\n' +
    '1. すべてのノードに必ず1つ以上のアノテーションを付ける（ok でも記録する）\n' +
    '2. nodeId は入力データの id フィールドと完全一致させる\n' +
    '3. description には rows, cost, actualTimeMs などの具体的な数値を含める\n' +
    '4. suggestion は実行可能な SQL または MySQL 設定変更にする\n' +
    '5. actualTimeStart/End/loops が存在する場合は必ず評価に含める\n' +
    '6. SQLが提供された場合はクエリ構造の問題（不要なサブクエリ、N+1等）も指摘する'
}

function formatActualTime(ms: number): string {
  if (ms >= 60000) return (ms / 60000).toFixed(1) + '分'
  if (ms >= 1000) return (ms / 1000).toFixed(1) + '秒'
  return ms.toFixed(1) + 'ms'
}

function buildUserPrompt(nodes: ExplainNode[], sql?: string): string {
  const annotatedNodes = JSON.parse(JSON.stringify(nodes)) as ExplainNode[]

  function annotate(node: ExplainNode): void {
    if (node.actualTimeEnd !== undefined && node.loops !== undefined) {
      const totalMs = node.actualTimeEnd * node.loops
      ;(node as unknown as Record<string, unknown>)['_totalActualMs'] = totalMs
      ;(node as unknown as Record<string, unknown>)['_totalActualFormatted'] = formatActualTime(totalMs)
    }
    node.children.forEach(annotate)
  }
  annotatedNodes.forEach(annotate)

  const sqlSection = sql?.trim()
    ? '\n## 実行されたSQL:\n```sql\n' + sql.trim() + '\n```\n'
    : ''

  const rewriteInstruction = sql?.trim()
    ? '\n\nSQLが提供されているため、problems の分析に加えて rewriteSuggestion も必ず記入してください。'
    : ''

  return '以下の MySQL EXPLAIN 実行計画ノードを分析してください。' + sqlSection + '\n' +
    '## 実行計画ノード (JSON):\n```json\n' +
    JSON.stringify(annotatedNodes, null, 2) +
    '\n```\n\n' +
    '## 各ノードで評価する主なフィールド:\n' +
    '- **actualTimeEnd × loops**: 【最重要】実際の合計実行時間(ms)。_totalActualMsに計算済み\n' +
    '- **actualTimeStart / actualTimeEnd**: EXPLAIN ANALYZE の実測時間 (ms)\n' +
    '- **loops**: このノードが実行された回数（N+1問題の検出に有効）\n' +
    '- **actualRows vs rows**: 実際行数と推定行数の乖離（統計情報の古さを示す）\n' +
    '- **accessType**: アクセス方法（ALL=フルスキャン=悪、eq_ref/const=最適）\n' +
    '- **rows**: 検索推定行数（多いほど悪い）\n' +
    '- **filtered**: WHERE条件通過率%\n' +
    '- **cost**: オプティマイザのコスト推定\n' +
    '- **key**: 使用インデックス（null=インデックスなし=潜在的問題）\n' +
    '- **possibleKeys**: オプティマイザが検討した候補インデックス\n' +
    '- **usingFilesort**: 追加ソートパス（大規模結果セットで高コスト）\n' +
    '- **usingTemporary**: 一時テーブル（メモリ圧迫）\n\n' +
    'すべてのノードを分析し、report_explain_problems ツールで結果を報告してください。' +
    rewriteInstruction
}

export async function analyzeWithClaude(
  nodes: ExplainNode[],
  sql?: string
): Promise<{ problems: ProblemAnnotation[]; rewriteSuggestion?: QueryRewriteSuggestion }> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: buildSystemPrompt(),
    messages: [
      {
        role: 'user',
        content: buildUserPrompt(nodes, sql),
      },
    ],
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: 'any' },
  })

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
  )

  if (!toolUseBlock || toolUseBlock.name !== 'report_explain_problems') {
    throw new Error('AI が構造化レスポンスを返しませんでした')
  }

  const input = toolUseBlock.input as {
    problems: ProblemAnnotation[]
    rewriteSuggestion?: QueryRewriteSuggestion
  }
  return {
    problems: input.problems ?? [],
    rewriteSuggestion: input.rewriteSuggestion,
  }
}
