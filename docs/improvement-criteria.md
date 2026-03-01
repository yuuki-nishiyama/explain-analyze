# 改善要否の判断基準

## 概要

本アプリケーションは MySQL の実行計画を以下の3段階で評価します。

| 重要度 | 表示色 | 意味 |
|--------|--------|------|
| **critical（重大）** | 赤 | 即座に対応が必要。本番環境に深刻な影響を与えている可能性が高い |
| **warning（警告）** | 黄 | 対応推奨。放置するとパフォーマンス劣化やスケール問題の原因になり得る |
| **ok（正常）** | 緑 | 許容範囲内。改善不要 |

---

## 評価指標と判定基準

### 1. 実測実行時間（最重要指標）

`EXPLAIN ANALYZE`（TREE形式）でのみ取得できる実測値です。推定値より信頼性が高く、**他のすべての指標に優先して評価**します。

**計算式**: `合計実行時間(ms) = actualTimeEnd × loops`

| 合計実行時間 | 判定 | 根拠 |
|-------------|------|------|
| > 10,000ms（10秒超） | **critical** | ユーザー体験への直接的な悪影響。SLA 違反水準 |
| > 1,000ms（1秒超） かつ `ALL` スキャン | **critical** | 遅いフルスキャンは行数増加に伴い指数的に悪化する |
| 1,000ms 〜 10,000ms | **warning** | 許容限界に近い。トラフィック増加で問題化するリスクあり |
| < 1,000ms かつ適切なアクセス方式 | ok | 許容範囲内 |

> **実装上の注意（フロントエンド強制ルール）**
>
> 実測時間の閾値判定は AI（Claude）の判断に依存するだけでなく、**フロントエンド側でも強制的に適用**されます（`lib/dagre-layout.ts` / `NodeDetail.tsx`）。以下のルールは AI が `ok` を返した場合でも上書きされます。
>
> | 条件 | フロントエンドによる上書き |
> |------|--------------------------|
> | `totalActualMs > 10,000ms` かつ AI が `critical` 以外 | → `critical` に強制 |
> | `totalActualMs > 1,000ms` かつ AI が `ok` | → `warning` に強制 |
>
> これにより、AI の判定ブレによる「10秒超なのに緑表示」という問題を防ぎます。

**表示例（NodeDetail パネル）**

```
⏱ 567.0s   合計実行時間        ← 赤色（critical）
[████████████████████] 95.8%  ← クエリ全体に占める割合
主要ボトルネック                ← 80% 超の場合に表示
```

---

### 2. アクセスタイプ（`accessType`）

オプティマイザが選択したテーブルアクセス方式です。

| accessType | 判定 | 説明 |
|------------|------|------|
| `ALL` | **critical** / warning | フルテーブルスキャン。行数が増えると線形に悪化する |
| `index` | warning / critical | フルインデックススキャン。ALL より速いが rows が多い場合は問題 |
| `range` | ok | インデックスの範囲スキャン。適切な挙動 |
| `ref` | ok | 非ユニークインデックスを使った参照 |
| `eq_ref` | ok | ユニークインデックスを使った1行参照（JOIN で最適） |
| `const` / `system` | ok | 定数参照（最高速） |

**`ALL` の行数による詳細判定**

| rows（推定行数） | 判定 |
|----------------|------|
| > 1,000行 | **critical** |
| 100 〜 1,000行 | **warning** |
| < 100行 | ok（小規模スキャンは許容） |

**`index` の行数による判定**

| rows（推定行数） | 判定 |
|----------------|------|
| > 10,000行 | **critical** |
| それ以下 | warning |

---

### 3. インデックス使用状況（`key`）

| 状態 | 判定 | 説明 |
|------|------|------|
| `key` = null かつ JOIN 条件 | **critical** | JOIN でインデックスが使われていない。行数の積になりうる |
| `key` = null かつ `possibleKeys` に候補あり | **warning** | 候補があるのに選ばれていない（統計情報や型の不一致が原因の可能性） |
| `key` = null かつ `possibleKeys` も null | **warning** 〜 critical | インデックスが存在しない。`rows` に応じて severity を判定 |
| `key` が設定されている | ok（他の条件次第） | インデックスを活用中 |

---

### 4. WHERE 条件のフィルタ率（`filtered`）

テーブルアクセス後に WHERE 条件で絞り込まれる割合（%）です。低いほどインデックスが効いていないことを示します。

| filtered | 判定 | 説明 |
|----------|------|------|
| < 10% かつ `rows` > 10,000 | **critical** | 大量行を読んだあとで 90% 以上を捨てている |
| < 30% | **warning** | インデックス設計の見直しで改善できる可能性がある |
| ≥ 30% | ok |

---

### 5. ソート・一時テーブル（`extra`フィールド）

| extra の内容 | 判定 | 説明 |
|-------------|------|------|
| `Using filesort` + `Using temporary` | **critical** | ディスクソートを伴う一時テーブル。最もコストが高い |
| `Using filesort` 単独 | **warning** | ソートにインデックスが使えていない。`ORDER BY` カラムへのインデックス追加を検討 |
| `Using temporary` 単独 | **warning** | `GROUP BY` や `DISTINCT` に一時テーブルが必要。インデックスで解消できる場合あり |
| `Using index` | ok | カバリングインデックス使用中（高速） |

---

### 6. ループ回数（`loops`）と N+1 問題

`EXPLAIN ANALYZE` で取得できる、このノードが実行された回数です。

| loops の値 | 判定 | 説明 |
|-----------|------|------|
| > 1,000 | **warning**（UI 警告表示） | N+1 問題の可能性。アプリケーション側での JOIN 化を検討 |
| 高 loops × 低 actualTimeEnd | ok | 1回あたりは速く、合計時間も許容範囲内 |
| 高 loops × 高 actualTimeEnd | **critical** | 合計実行時間が膨大になる（`actualTimeEnd × loops` で評価） |

**N+1 問題の典型例**

```
-> Index lookup on users using PRIMARY (loops=500000, actualTimeEnd=0.002ms)
   合計 = 0.002 × 500,000 = 1,000ms
```

1回あたり 0.002ms でも 50万回実行されれば合計 1 秒になります。アプリ側でまとめて取得（JOIN や IN句）することで解消できます。

---

### 7. 推定行数と実測行数の乖離

オプティマイザの統計情報が古い場合、推定行数と実測行数が大きく乖離します。

**乖離率の計算**: `実測行数（actualRows） / 推定行数（estimatedRows または rows）`

| 乖離率 | 判定 | 説明 |
|--------|------|------|
| > 9倍（実測が推定の9倍超） | **warning** | 統計情報が古く、オプティマイザが悪い実行計画を選ぶ可能性がある |
| < 0.11倍（実測が推定の1/9未満） | **warning** | 同上（過大推定） |
| 0.11 〜 9倍の範囲内 | ok |

**対処法**: `ANALYZE TABLE テーブル名;` を実行して統計情報を更新する

**UI での表示例（NodeDetail パネル）**

```
⚠ 推定 vs 実測 行数
推定: 500  →  実測: 8,200  (16.4× 過大)
統計情報が古い可能性があります。ANALYZE TABLE の実行を検討してください。
```

---

## 優先順位スコアとランク付け

複数の問題が検出された場合、以下のスコアで優先順位を付けます（`lib/scoring.ts`）。

### スコア計算式

```
スコア = 深刻度重み × 1,000,000
       + クエリ全体に占める時間% × 1,000
       + min(合計実行時間ms, 999,999) / 1,000
```

| 深刻度 | 重み |
|--------|------|
| critical | 3 |
| warning | 2 |
| ok | 1 |

**設計意図**:
- 深刻度が最も重要な判断軸（1,000,000 倍のウェイト）
- 同じ深刻度の中では、クエリ全体に占める時間割合が高いものを優先
- 同じ時間割合の中では、絶対時間が長いものを優先

### スコア計算例

| 問題 | 深刻度 | 時間割合 | 合計時間 | スコア |
|------|--------|--------|--------|-------|
| orders フルスキャン | critical | 79.4% | 450,000ms | 3,079,450 |
| クエリ全体の遅延 | critical | 100% | 567,046ms | 3,100,567 |
| users ルックアップ | ok | 0.2% | 1,000ms | 1,001,200 |

---

## 相対ボトルネック表示

`EXPLAIN ANALYZE` を使用した場合のみ有効な機能です。

**計算方法**:
1. ルートノード（クエリ全体）の合計実行時間を 100% のベースラインとする
2. 各ノードの合計実行時間 / ルートの合計実行時間 × 100 = 時間割合（%）

```
ルートノード合計時間 = actualTimeEnd × loops
各ノードの時間割合 = (ノードの actualTimeEnd × loops) / ルートの合計時間 × 100
```

**グラフノード上の表示**

```
[████████████████████] 79.4%   ← 赤（> 50%）
[█████              ] 23.1%   ← 黄（> 20%）
[                   ]  0.2%   ← 緑（≤ 20%）
```

---

## クエリ書き換え提案の判断基準

SQL が入力された場合に、以下のパターンを検知して書き換えを提案します。

| パターン | 提案内容 |
|--------|--------|
| フルスキャン + WHERE 条件 | SELECT カラムに対するインデックス追加 |
| JOIN でインデックス未使用 | JOIN カラムへのインデックス追加 |
| LEFT JOIN かつ NULL チェックなし | INNER JOIN への変更（オプティマイザ最適化の向上） |
| 高 loops（N+1の可能性） | IN句 / JOIN での一括取得への書き換え |
| Using filesort + ORDER BY | ORDER BY カラムを含む複合インデックスの追加 |
| サブクエリの多用 | JOIN / EXISTS への書き換え |

---

## 判断フローチャート

```
EXPLAIN 実行計画を取得
        │
        ▼
EXPLAIN ANALYZE（TREE形式）か？
    │               │
   Yes              No
    │               │
    ▼               ▼
actualTimeEnd × loops     accessType で判定
で合計時間を計算           ├── ALL + rows > 1000 → critical
    │                      ├── ALL + rows 100-1000 → warning
    ├── > 10秒 → critical   ├── index + rows > 10000 → critical
    ├── 1〜10秒 → warning   └── range/ref/eq_ref → ok 方向
    └── < 1秒 → ok方向
        │
        ▼
    key（インデックス）の確認
        ├── null + JOIN → critical
        ├── null + possibleKeys あり → warning
        └── 設定済み → ok方向
        │
        ▼
    filtered の確認
        ├── < 10% + rows > 10000 → critical
        ├── < 30% → warning
        └── ≥ 30% → ok方向
        │
        ▼
    extra の確認
        ├── filesort + temporary → critical
        ├── filesort 単独 → warning
        ├── temporary 単独 → warning
        └── なし / Using index → ok方向
        │
        ▼
    最終 severity を決定
    （複数条件がある場合は最も高い severity を採用）
```

---

## よくある問題パターンと改善策

### パターン 1: フルテーブルスキャン

**症状**: `accessType = "ALL"`, `rows = 大きな値`, `key = null`

```sql
-- 改善前
SELECT * FROM orders WHERE status = 'pending';
-- accessType: ALL, rows: 500000

-- 改善策
CREATE INDEX idx_orders_status ON orders (status);

-- 改善後
-- accessType: ref, rows: 18659
```

---

### パターン 2: 統計情報の古さによる悪い実行計画

**症状**: `actualRows >> estimatedRows`（乖離率 > 9倍）

```sql
-- 統計情報を更新
ANALYZE TABLE orders;
ANALYZE TABLE users;
```

---

### パターン 3: N+1 クエリ

**症状**: `loops = 大きな値`（例: 500,000回）

```sql
-- 改善前（アプリ側で N+1 が発生している場合）
SELECT * FROM users WHERE id = ?;  -- 50万回実行

-- 改善策: 一括取得に変える
SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE status = 'pending');
-- または
SELECT o.*, u.name FROM orders o
INNER JOIN users u ON u.id = o.user_id
WHERE o.status = 'pending';
```

---

### パターン 4: filesort の解消

**症状**: `extra = "Using filesort"`, `ORDER BY` を使用

```sql
-- 改善前
SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC;
-- extra: Using filesort

-- 改善策: ORDER BY カラムを含む複合インデックス
CREATE INDEX idx_orders_status_created ON orders (status, created_at DESC);
```

---

### パターン 5: 一時テーブルの回避

**症状**: `extra = "Using temporary"`, `GROUP BY` や `DISTINCT` を使用

```sql
-- 改善前
SELECT user_id, COUNT(*) FROM orders GROUP BY user_id;
-- extra: Using temporary

-- 改善策: GROUP BY カラムにインデックス
CREATE INDEX idx_orders_user_id ON orders (user_id);
```
