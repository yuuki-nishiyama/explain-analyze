# SQL 実行計画アナライザー

MySQL の `EXPLAIN` 出力を貼り付けると、AI（Claude）が問題箇所を特定し、インタラクティブなグラフとして可視化するウェブアプリケーションです。

## 主な機能

- **3フォーマット対応**: `EXPLAIN FORMAT=JSON` / テーブル形式 / `EXPLAIN ANALYZE`（TREE形式）を自動判定
- **AI診断**: Claude が各ノードの問題を重要度付きで分析
- **インタラクティブグラフ**: 実行計画ツリーを色分けして可視化
- **相対ボトルネック表示**: 各ノードがクエリ全体に占める実行時間の割合をバーで表示
- **優先順位スコア**: 深刻度 × 時間割合 × 絶対時間で問題を優先度順に表示
- **クエリ書き換え提案**: SQL を入力すると AI が改善版クエリを提案
- **Before/After 比較**: 最適化前後の実行計画を並べて比較

## スクリーンショット

### 通常解析ビュー

```
┌─ ヘッダー: タイトル + 問題件数 + リセット ─────────────────────┐
├────────────────────────────────────────────────────────────────┤
│ 左サイドバー       │  グラフ（中央）          │ 右サイドバー      │
│ ・優先度付き問題一覧│  ・ノードツリー可視化    │ ・選択ノード詳細  │
│ ・クエリ書き換え提案│  ・ズーム/パン対応       │ ・AI診断結果     │
└────────────────────────────────────────────────────────────────┘
```

ノードはボトルネックの深刻度に応じて色分けされます。

| 重要度 | 色 | 条件例 |
|--------|-----|-------|
| 重大 (critical) | 赤 | フルスキャン（rows > 1000）、インデックスなし JOIN |
| 警告 (warning) | 黄 | filesort、rows 100〜1000 のスキャン |
| 正常 (ok) | 緑 | eq_ref / const / 低コスト ref |

## セットアップ

### 必要環境

- Node.js 18以上
- Anthropic API キー（[取得方法](https://console.anthropic.com/)）

### インストール

```bash
git clone <repo-url>
cd explain-analyze
npm install
```

### 環境変数

`.env.local` を作成し、API キーを設定します。

```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

### 起動

```bash
# 開発サーバー
npm run dev

# 本番ビルド
npm run build
npm start
```

ブラウザで `http://localhost:3000` を開きます。

## 使い方

### 通常解析

1. `EXPLAIN` 出力をテキストエリアに貼り付ける
2. フォーマットを選択（通常は「自動判定」で問題なし）
3. SQL クエリを入力すると書き換え提案の精度が上がる（任意）
4. 「解析する」をクリック

### Before/After 比較

1. 「Before / After 比較」タブに切り替える
2. 最適化前後の `EXPLAIN` 出力をそれぞれ貼り付ける
3. 「比較解析する」をクリック
4. 改善前後の実行時間・問題件数の変化が比較表示される

### サンプルデータ

「サンプルを使用」ボタンで動作確認用のデータが自動入力されます。500,000行のフルスキャンが発生するクエリと最適化後のクエリが用意されています。

## 対応フォーマット

### TREE 形式（`EXPLAIN ANALYZE`、MySQL 8.0+）

実行時間・ループ回数などの実測値が含まれる最も詳細な形式です。ボトルネック表示や行数精度チェックが有効になります。

```sql
EXPLAIN ANALYZE SELECT ...
```

```
-> Nested loop left join  (cost=365 rows=0.52) (actual time=134..567046 rows=18659 loops=1)
    -> Table scan on orders  (cost=200 rows=500000) (actual time=0.5..450000 rows=500000 loops=1)
    -> Index lookup on users using PRIMARY (id=orders.user_id)  (cost=0.35 rows=1) ...
```

### JSON 形式

コスト情報が詳細に含まれます。

```sql
EXPLAIN FORMAT=JSON SELECT ...
```

### テーブル形式（標準）

MySQL の標準 EXPLAIN 出力です。

```sql
EXPLAIN SELECT ...
```

```
+----+-------------+--------+-------+...
| id | select_type | table  | type  |...
+----+-------------+--------+-------+...
```

## AI 診断の仕組み

Claude（`claude-sonnet-4-6`）がツール呼び出し（Tool Use）で構造化 JSON を返す方式を採用しています。各ノードについて以下の観点で評価します。

| 指標 | 評価基準 |
|------|---------|
| `actualTimeEnd × loops` | 合計実行時間（最重要指標） |
| `accessType` | ALL > index > range > ref > eq_ref の順で問題度大 |
| `rows` | 推定行数が多いほどリスク大 |
| `filtered` | 低い値（例: 1〜5%）はインデックス未活用の可能性 |
| `key` | NULL の場合はインデックスが使われていない |
| `extra` | Using filesort / Using temporary は追加コスト |
| 推定 vs 実測 行数 | 乖離が大きい場合は統計情報が古い可能性 |

### 優先順位スコア式

```
スコア = 深刻度重み × 1,000,000
       + クエリ全体に占める時間% × 1,000
       + min(合計実行時間ms, 999,999) / 1,000
```

深刻度重み: `critical=3`, `warning=2`, `ok=1`

深刻度が最優先で、同じ深刻度内では時間割合・絶対時間の順で比較されます。

## プロジェクト構成

```
explain-analyze/
├── app/
│   ├── page.tsx                    # メインページ（状態管理）
│   ├── layout.tsx                  # ルートレイアウト
│   ├── api/analyze/route.ts        # POST /api/analyze エンドポイント
│   └── components/
│       ├── ExplainInput.tsx        # 入力フォーム（通常 + 比較モード）
│       ├── ExplainGraph.tsx        # React Flow グラフ
│       ├── ExplainGraphWrapper.tsx # SSR 境界（dynamic import）
│       ├── NodeDetail.tsx          # ノード詳細サイドパネル
│       ├── ProblemSummary.tsx      # 問題一覧サイドバー
│       ├── QueryRewrite.tsx        # クエリ書き換え提案パネル
│       ├── CompareView.tsx         # Before/After 比較ビュー
│       └── nodes/ExplainNode.tsx  # React Flow カスタムノード
└── lib/
    ├── types.ts                    # 共有 TypeScript 型定義
    ├── analyzer.ts                 # Claude API 呼び出し
    ├── scoring.ts                  # 優先順位スコア・時間割合計算
    ├── dagre-layout.ts             # グラフレイアウト計算
    └── parsers/
        ├── index.ts                # フォーマット自動判定 + ディスパッチ
        ├── mysql-json.ts           # JSON 形式パーサー
        ├── mysql-table.ts          # テーブル形式パーサー
        └── mysql-tree.ts           # TREE 形式パーサー
```

## API リファレンス

### `POST /api/analyze`

**リクエスト**

```typescript
{
  explainText: string       // EXPLAIN 出力（必須）
  hintFormat?: ExplainFormat  // 'json' | 'tabular' | 'tree' | 'unknown'
  sql?: string              // SQL クエリ（任意）
}
```

**レスポンス（成功）**

```typescript
{
  success: true,
  data: {
    nodes: ExplainNode[]
    problems: ProblemAnnotation[]
    rawExplain: string
    detectedFormat: ExplainFormat
    sql?: string
    rewriteSuggestion?: QueryRewriteSuggestion  // SQL 入力時のみ
  }
}
```

**レスポンス（エラー）**

```typescript
{
  success: false,
  error: string
  details?: string
}
```

**ステータスコード**

| コード | 意味 |
|--------|------|
| 200 | 成功 |
| 400 | `explainText` が空 |
| 422 | パース失敗またはノード取得不可 |
| 500 | サーバー内部エラー |

## 主要な型定義

```typescript
// 実行計画の1ノード
interface ExplainNode {
  id: string
  label: string
  accessType: AccessType        // ALL / index / range / ref / eq_ref / const ...
  rows: number
  estimatedRows?: number
  filtered?: number
  cost?: number
  actualTimeStart?: number      // TREE形式のみ
  actualTimeEnd?: number        // TREE形式のみ
  loops?: number                // TREE形式のみ
  actualRows?: number           // TREE形式のみ
  key?: string
  extra?: string
  children: ExplainNode[]
}

// 問題アノテーション
interface ProblemAnnotation {
  nodeId: string
  severity: 'critical' | 'warning' | 'ok'
  title: string
  description: string
  suggestion: string
}

// クエリ書き換え提案
interface QueryRewriteSuggestion {
  rewrittenSql: string
  explanation: string
  expectedImprovements: string[]
}
```

## 技術スタック

| 役割 | ライブラリ |
|------|-----------|
| フレームワーク | Next.js 16 (App Router) |
| 言語 | TypeScript |
| UI | React 19 + Tailwind CSS |
| グラフ可視化 | @xyflow/react v12 |
| グラフレイアウト | @dagrejs/dagre |
| AI 解析 | @anthropic-ai/sdk (claude-sonnet-4-6) |

## ライセンス

MIT
