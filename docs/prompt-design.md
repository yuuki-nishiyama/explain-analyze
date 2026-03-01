# プロンプト設計書

## 概要

本アプリケーションは **Claude Tool Use（ツール呼び出し）** を用いて、MySQL の実行計画を構造化 JSON として取得します。自由テキストではなくツール応答を強制することで、フロントエンドがそのまま型安全に使えるデータを確実に得られます。

```
ExplainNode[] + SQL?
       ↓
  System Prompt   ← 専門家ペルソナ + 判定基準
  User Prompt     ← ノード JSON + 評価軸の説明
  Tool Schema     ← 返却すべき構造の定義
       ↓
  tool_choice: { type: 'any' }  ← ツール必須呼び出し
       ↓
  ProblemAnnotation[] + QueryRewriteSuggestion?
```

---

## 1. System Prompt

`lib/analyzer.ts` の `buildSystemPrompt()` が生成する内容です。

```
あなたはMySQLのクエリパフォーマンス専門家です。EXPLAIN / EXPLAIN ANALYZE実行計画を分析し、
パフォーマンス問題を特定して具体的な改善策を提示します。

## Severity（深刻度）の判定基準

### 実測時間（actualTimeEnd × loops）が存在する場合は最優先で評価すること

**critical**（即座に対応必要）:
- actualTimeEnd × loops > 10000ms（合計10秒超）
- actualTimeEnd × loops > 1000ms かつ access_type = "ALL"（遅いフルスキャン）
- access_type = "ALL" かつ rows > 1000（フルテーブルスキャン）
- access_type = "index" かつ rows > 10000（フルインデックススキャン）
- JOIN条件でkey（インデックス）が null
- Using temporary + Using filesort の両方
- filtered < 10% かつ rows > 10000

**warning**（対応推奨）:
- actualTimeEnd × loops が 1000ms〜10000ms
- access_type = "ALL" かつ rows 100〜1000
- Using filesort 単独
- Using temporary 単独
- possible_keysに候補があるがkeyがnull
- filtered < 30%
- actualRows が estimatedRows の 10倍超（統計情報が古い可能性）

**ok**（許容範囲内）:
- access_type = "eq_ref", "const", "system"
- access_type = "ref" で rows が少なく actualTime も小さい
- access_type = "range"

## 実測時間の計算方法
- 合計実測時間 = actualTimeEnd × loops
- 例: actualTimeEnd=567046, loops=1 → 合計567秒 → critical

## クエリ書き換え提案 (rewriteSuggestion)
- SQLが提供された場合のみ rewriteSuggestion を記入する
- 最も効果的な改善版SQLを提案する（インデックスの活用、不要なサブクエリの除去、N+1の解消など）
- 書き換え後のSQLは完全で実行可能なものにする
- expectedImprovements には具体的な改善効果を列挙する

## ルール
1. すべてのノードに必ず1つ以上のアノテーションを付ける（ok でも記録する）
2. nodeId は入力データの id フィールドと完全一致させる
3. description には rows, cost, actualTimeMs などの具体的な数値を含める
4. suggestion は実行可能な SQL または MySQL 設定変更にする
5. actualTimeStart/End/loops が存在する場合は必ず評価に含める
6. SQLが提供された場合はクエリ構造の問題（不要なサブクエリ、N+1等）も指摘する
```

### 設計のポイント

| 項目 | 意図 |
|------|------|
| 専門家ペルソナ | 汎用的な回答ではなく、MySQL DBA 視点の具体的な診断を引き出す |
| 実測時間を最優先 | `EXPLAIN ANALYZE` の実測値は推定値より信頼性が高いため、存在する場合に優先させる |
| 判定閾値の明示 | 「10秒超=critical」のように数値を明示することで、判定の揺れを防ぐ |
| ok も記録させる | 全ノード網羅を保証し、「問題がない」という情報も可視化に活用する |
| ルール番号付き | Claude が従うべき形式上の制約を明確化し、nodeId ミスマッチを防ぐ |

---

## 2. User Prompt

`lib/analyzer.ts` の `buildUserPrompt(nodes, sql?)` が生成する内容です。

### テンプレート構造

```
以下の MySQL EXPLAIN 実行計画ノードを分析してください。

## 実行されたSQL:          ← sql が提供された場合のみ
```sql
{sql}
```

## 実行計画ノード (JSON):
```json
{annotatedNodes}          ← _totalActualMs と _totalActualFormatted を付与済み
```

## 各ノードで評価する主なフィールド:
- **actualTimeEnd × loops**: 【最重要】実際の合計実行時間(ms)。_totalActualMsに計算済み
- **actualTimeStart / actualTimeEnd**: EXPLAIN ANALYZE の実測時間 (ms)
- **loops**: このノードが実行された回数（N+1問題の検出に有効）
- **actualRows vs rows**: 実際行数と推定行数の乖離（統計情報の古さを示す）
- **accessType**: アクセス方法（ALL=フルスキャン=悪、eq_ref/const=最適）
- **rows**: 検索推定行数（多いほど悪い）
- **filtered**: WHERE条件通過率%
- **cost**: オプティマイザのコスト推定
- **key**: 使用インデックス（null=インデックスなし=潜在的問題）
- **possibleKeys**: オプティマイザが検討した候補インデックス
- **usingFilesort**: 追加ソートパス（大規模結果セットで高コスト）
- **usingTemporary**: 一時テーブル（メモリ圧迫）

すべてのノードを分析し、report_explain_problems ツールで結果を報告してください。

SQLが提供されているため、problems の分析に加えて rewriteSuggestion も必ず記入してください。
← sql が提供された場合のみ追加
```

### `_totalActualMs` アノテーションについて

User Prompt に渡す前に、各ノードに計算済みの合計実行時間を付与します。

```typescript
// buildUserPrompt 内の前処理
if (node.actualTimeEnd !== undefined && node.loops !== undefined) {
  node['_totalActualMs'] = node.actualTimeEnd * node.loops
  node['_totalActualFormatted'] = formatActualTime(totalMs)
  // 例: 567046ms → "9.5分"
}
```

**目的**: Claude に計算をさせると誤差が生じる可能性があるため、サーバー側で事前計算した値を埋め込む。

---

## 3. Tool Schema（`report_explain_problems`）

```typescript
{
  name: 'report_explain_problems',
  description: 'MySQL EXPLAINの実行計画に含まれるすべてのパフォーマンス問題を報告する',
  input_schema: {
    type: 'object',
    properties: {

      problems: {    // 必須
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nodeId:      string  // ExplainNode.id と完全一致
            severity:    'critical' | 'warning' | 'ok'
            title:       string  // 短い問題名（例: "Full Table Scan"）
            description: string  // 具体的数値を含む説明（日本語）
            suggestion:  string  // 実行可能な改善SQL（日本語）
          },
          required: ['nodeId', 'severity', 'title', 'description', 'suggestion']
        }
      },

      rewriteSuggestion: {   // 任意（SQL提供時のみ）
        type: 'object',
        properties: {
          rewrittenSql:          string    // 完全で実行可能なSQL
          explanation:           string    // 改善理由の説明（日本語）
          expectedImprovements:  string[]  // 具体的改善効果のリスト（日本語）
        },
        required: ['rewrittenSql', 'explanation', 'expectedImprovements']
      }

    },
    required: ['problems']   // rewriteSuggestion は任意
  }
}
```

### Tool Use を採用した理由

| 方式 | 課題 |
|------|------|
| 通常テキスト応答 | JSON の解析が不安定。Markdown コードブロックに包まれたり、形式が揺れる |
| `tool_choice: { type: 'auto' }` | ツールを呼ばずテキストで返すケースがある |
| **`tool_choice: { type: 'any' }`** | 必ずいずれかのツールを呼ぶことを保証 ← 採用 |

---

## 4. 具体的な入出力例

### 入力（ユーザープロンプトの `annotatedNodes` 部分）

以下は遅いクエリのサンプルです。

```json
[
  {
    "id": "node-0",
    "label": "Nested loop left join",
    "accessType": "join",
    "rows": 0,
    "actualTimeStart": 134,
    "actualTimeEnd": 567046,
    "loops": 1,
    "actualRows": 18659,
    "_totalActualMs": 567046,
    "_totalActualFormatted": "9.5分",
    "children": [
      {
        "id": "node-1",
        "label": "Table scan on orders",
        "accessType": "ALL",
        "rows": 500000,
        "actualTimeStart": 0.5,
        "actualTimeEnd": 450000,
        "loops": 1,
        "actualRows": 500000,
        "_totalActualMs": 450000,
        "_totalActualFormatted": "7.5分",
        "children": []
      },
      {
        "id": "node-2",
        "label": "Index lookup on users using PRIMARY",
        "accessType": "eq_ref",
        "rows": 1,
        "key": "PRIMARY",
        "actualTimeStart": 0.002,
        "actualTimeEnd": 0.002,
        "loops": 500000,
        "actualRows": 1,
        "_totalActualMs": 1000,
        "_totalActualFormatted": "1.0秒",
        "children": []
      }
    ]
  }
]
```

```sql
SELECT o.*, u.name
FROM orders o
LEFT JOIN users u ON u.id = o.user_id
WHERE o.status = 'pending'
```

---

### 出力（Claude が `report_explain_problems` ツールに返す値）

```json
{
  "problems": [
    {
      "nodeId": "node-0",
      "severity": "critical",
      "title": "Slow Query - 9.5分",
      "description": "クエリ全体の合計実行時間が 567,046ms（約9.5分）と非常に長いです。ルートノードの合計実行時間が 567秒 に達しており、即座の対応が必要です。",
      "suggestion": "以下の問題ノードを優先的に改善してください。特に orders テーブルのフルスキャンを解消することで大幅な改善が見込まれます。"
    },
    {
      "nodeId": "node-1",
      "severity": "critical",
      "title": "Full Table Scan on orders",
      "description": "orders テーブルに対してフルテーブルスキャン（ALL）が発生しています。500,000行を全件スキャンし、合計実行時間は 450,000ms（7.5分）です。status='pending' の絞り込みにインデックスが使われていません。",
      "suggestion": "status カラムにインデックスを追加してください:\nCREATE INDEX idx_orders_status ON orders (status);\nさらに、user_id も一緒に含む複合インデックスが有効な場合があります:\nCREATE INDEX idx_orders_status_user ON orders (status, user_id);"
    },
    {
      "nodeId": "node-2",
      "severity": "ok",
      "title": "Efficient Primary Key Lookup",
      "description": "users テーブルへのアクセスは PRIMARY KEY を使用した eq_ref（1行ルックアップ）です。500,000回のループで合計 1,000ms と、1回あたり 0.002ms の高速なアクセスです。",
      "suggestion": "このノードは最適な状態です。改善不要です。"
    }
  ],
  "rewriteSuggestion": {
    "rewrittenSql": "SELECT o.*, u.name\nFROM orders o\nINNER JOIN users u ON u.id = o.user_id\nWHERE o.status = 'pending'",
    "explanation": "LEFT JOIN を INNER JOIN に変更し、orders.status にインデックスを作成することで、500,000行のフルスキャンを排除できます。status='pending' の行のみを先にインデックスで絞り込んでから users との JOIN を行うため、スキャン行数が大幅に削減されます。また、user_id が NULL になり得ない場合、LEFT JOIN より INNER JOIN の方がオプティマイザが最適な結合順序を選択しやすくなります。",
    "expectedImprovements": [
      "orders テーブルのスキャン行数が 500,000行 → 該当件数のみに削減",
      "フルテーブルスキャン（ALL）がインデックス参照（range または ref）に変わる",
      "実行時間が 9.5分 → 数十ms オーダーへの改善が見込まれる",
      "INNER JOIN により結合順序の最適化がオプティマイザに委ねられる"
    ]
  }
}
```

---

## 5. API 呼び出し設定

```typescript
const response = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  system: buildSystemPrompt(),
  messages: [{ role: 'user', content: buildUserPrompt(nodes, sql) }],
  tools: [ANALYSIS_TOOL],
  tool_choice: { type: 'any' },   // ← ツール呼び出しを強制
})
```

| パラメータ | 値 | 理由 |
|------------|-----|------|
| `model` | `claude-sonnet-4-6` | 速度とコストのバランス。複雑な実行計画の解析に十分な性能 |
| `max_tokens` | `4096` | 多ノードの実行計画でも結果が切れないよう余裕を確保 |
| `tool_choice` | `{ type: 'any' }` | 必ずツールを呼ばせる。`'auto'` だと稀にテキスト応答になる |
| `maxDuration` | `60` (秒) | Next.js の Serverless Functions タイムアウト設定 |

---

## 6. レスポンス後処理

```typescript
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
```

`tool_choice: { type: 'any' }` を指定しているため、ツールブロックが存在しないケースは通常起こりませんが、防御的にチェックしています。

---

## 7. プロンプト改善のガイドライン

新しい判定ロジックを追加・変更する場合は、以下の順序で対応します。

1. **System Prompt の `Severity` セクションを修正** (`buildSystemPrompt`)
   - 新しい閾値条件を追加、または既存の条件を変更する

2. **Tool Schema を拡張** (`ANALYSIS_TOOL.input_schema`)
   - 新しいフィールドが必要な場合はここに追加する
   - `required` に含めると Claude が必ず埋めるようになる

3. **型定義を更新** (`lib/types.ts`)
   - Tool Schema の変更と `ProblemAnnotation` / `QueryRewriteSuggestion` を合わせる

4. **フロントエンドの表示を更新** (該当コンポーネント)
   - 新しいフィールドを UI に反映する
