import { NextRequest, NextResponse } from 'next/server'
import { parseExplain } from '@/lib/parsers'
import { analyzeWithClaude } from '@/lib/analyzer'
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  AnalyzeErrorResponse,
} from '@/lib/types'

export const maxDuration = 60
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body: AnalyzeRequest = await req.json()

    if (!body.explainText?.trim()) {
      return NextResponse.json<AnalyzeErrorResponse>(
        { success: false, error: 'explainText は必須です' },
        { status: 400 }
      )
    }

    // Step 1: Parse EXPLAIN output
    let parseResult
    try {
      parseResult = parseExplain(body.explainText, body.hintFormat)
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : 'パース失敗'
      return NextResponse.json<AnalyzeErrorResponse>(
        { success: false, error: message },
        { status: 422 }
      )
    }

    if (parseResult.nodes.length === 0) {
      return NextResponse.json<AnalyzeErrorResponse>(
        {
          success: false,
          error: 'EXPLAIN 出力からノードを取得できませんでした。入力内容を確認してください。',
        },
        { status: 422 }
      )
    }

    // Step 2: AI analysis
    const { problems, rewriteSuggestion } = await analyzeWithClaude(
      parseResult.nodes,
      body.sql
    )

    return NextResponse.json<AnalyzeResponse>({
      success: true,
      data: {
        nodes: parseResult.nodes,
        problems,
        rawExplain: body.explainText,
        detectedFormat: parseResult.format,
        sql: body.sql,
        rewriteSuggestion,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    console.error('[analyze] Error:', message)
    return NextResponse.json<AnalyzeErrorResponse>(
      { success: false, error: '解析中にエラーが発生しました', details: message },
      { status: 500 }
    )
  }
}
