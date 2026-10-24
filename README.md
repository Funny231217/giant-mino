# GIANT MINO

10個に1個、通常ミノを**縦横2倍（16マス）**にした「GIANT MINO」が降ってくる、ブラウザ向けの落ち物パズルです。
7-bag・SRS・T-Spin・HOLD・NEXT 6・ゴースト・Combo・Back-to-Back・Perfect Clear・DAS/ARR に対応しています。

- TypeScript + Vite / HTML5 Canvas 2D / Web Audio API / Vitest
- サーバー・DB不要の静的サイト。GitHub Pages（https://funny231217.github.io/giant-mino/）向けに設定済み

## 起動方法

```bash
npm install
npm run dev       # 開発サーバー（http://localhost:5173/）
npm run test      # ロジックの単体テスト（Vitest）
npm run build     # 型チェック + 本番ビルド → dist/
npm run preview   # ビルド結果をローカルで確認（http://localhost:4173/giant-mino/）
```

Node.js 20.19 以降（推奨 22 以降）が必要です。

## 操作

| 操作 | キーボード | タッチ |
|---|---|---|
| 左右移動 | `←` `→` | ◀ ▶ |
| ソフトドロップ | `↓` | ▼ |
| ハードドロップ | `Space` | ⤓ DROP |
| 右回転（時計回り） | `↑` / `X` | ⟳ |
| 左回転（反時計回り） | `Z` | ⟲ |
| HOLD | `C` / `Shift` | HOLD |
| 一時停止・再開 | `P` / `Esc` | ❚❚ |
| BGM ミュート | `M` | 設定画面 |
| 開始・リトライ | `Enter`（ゲームオーバー時は `R` も可） | ボタン |

- 長押しは OS のキーリピートを使わず独自の **DAS（初期 150ms）/ ARR（初期 30ms）** で処理します。設定画面で変更でき、ARR = 0 は DAS 後に端まで即移動します。
- 同じキーは離すまで再発火しないため、ハードドロップや HOLD を押しっぱなしにしても次のミノが誤って確定されません。
- 左右同時押しは後から押した方向が優先、離すと残った方向で DAS をやり直します。
- タブ切替・フォーカス喪失時は自動でポーズし、押下状態をリセットします。
- タッチボタンは `pointer: coarse` の端末で自動表示（設定で常に表示／非表示も可）。

## ゲームルール

### 盤面・供給
- 表示 10×20、内部 10×40（上20行は非表示バッファ）。フィールド上端に非表示バッファの下2行をスポーン領域として薄く表示しています。
- ミノは 7-bag で供給。バッグの切れ目でも同じ種類が続かないよう、**同じ種類の間には最低3個の別のミノが入ります**（`src/core/PieceGenerator.ts` の `MIN_SAME_PIECE_DISTANCE = 4`。1 にすると素の 7-bag）。供給時に**通し番号・種類・GIANT 属性**を確定し、NEXT の先読みや HOLD で変わりません。
- 通し番号が 10, 20, 30, … のミノだけが GIANT（確率10%ではなく10個ごと確定）。
- **NEXT GIANT** は「NEXT 先頭を 1 として、次の GIANT が何番目に供給されるか」を表示します。供給順だけで決まるので HOLD 交換で増減しません（空 HOLD への初回保存は NEXT から1個取り出すので 1 減ります）。

### GIANT MINO
- 通常ミノの各セルを 2×2 に置き換えた形（4セル → 16セル）。例: GIANT T は `..##.. / ..##.. / ###### / ######`、GIANT I は横 8×2、GIANT O は 4×4。
- 描画倍率ではなく盤面セル単位の形状として、衝突・回転・設置・ライン消去・ゴーストをすべて処理します。
- 各姿勢は「通常ミノの回転後の形」を 2×2 展開したもの。4回回すと元に戻ります。
- 回転は GIANT 専用キックを盤面セル単位で規定順に試します（Y 下向き正）:
  `(0,0) (-1,0) (1,0) (-2,0) (2,0) (0,-1) (0,-2) (-1,-1) (1,-1) (-2,-1) (2,-1) (-1,-2) (1,-2) (-2,-2) (2,-2)`
- GIANT I だけは 8×2 ⇔ 2×8 の変形でずれが大きいため、横 ±4・上 4 までを「上方向 0→4 の各段で横 0, -1, +1, … ±4」の順に探索します。下方向へのキックはありません。
- HOLD・移動・回転・ハードドロップ可能。GIANT T は T-Spin の対象外です。
- 出現時に `GIANT MINO!` 表示と専用効果音、太めの輪郭線と控えめな発光。NEXT/HOLD では通常ミノと同じ縮尺で描くため大きさの違いがそのまま分かります。

### 回転（通常ミノ）・T-Spin
- 通常ミノは SRS（JLSTZ 用・I 専用テーブル、O は回転のみ）。tetris.wiki の表（Y 上向き）を内部の Y 下向き座標へ符号変換して使用しています。
- **T-Spin 判定（通常の T のみ）**: 最後の操作が成功した回転で、T 中心の斜め4角のうち3つ以上が埋まっている（壁・床も埋まり扱い）。判定はライン消去前。
  - 前方（凸側）2角が両方埋まっていれば **T-Spin**
  - そうでなければ **T-Spin Mini**。ただし SRS の5番目のキック（TST/Fin 形など）で入った場合は T-Spin に格上げ
  - 回転後に左右移動・落下（自然落下・ソフトドロップ・距離のあるハードドロップ）すると T-Spin 扱いは解除されます

### 落下・ロックディレイ
- 自然落下 `(0.8 − (Level−1)×0.007)^(Level−1)` 秒/段（Level 20 で上限）、ソフトドロップはその 20 倍速。
- 接地後 **500ms** で固定。接地中の移動・回転の成功でタイマーをリセットでき、**最大15回**まで。それまでの最下段より下に落ちたときだけ回数が戻ります（Extended Placement 方式）。
- 経過時間ベースで更新し、1回の更新は最大 100ms に制限（タブ復帰時の時間ジャンプ対策）。
- スポーン位置が塞がっている（Block Out）、または非表示領域だけに固定された（Lock Out）場合はゲームオーバー。

### ライン消去・スコア
消去行数に上限はありません（GIANT で5行以上も可）。点数は `基本点 × Level`。

| 消去 | 基本点 |
|---|---|
| Single / Double / Triple / Tetris | 100 / 300 / 500 / 800 |
| **MEGA CLEAR**（5行以上・n 行） | 800 × (n − 3) → 5行 1600, 6行 2400, 7行 3200, 8行 4000 |
| T-Spin（0 / 1 / 2 / 3行） | 400 / 800 / 1200 / 1600 |
| T-Spin Mini（0 / 1 / 2行） | 100 / 200 / 400 |
| Perfect Clear 追加（1 / 2 / 3 / 4行、n≥5 行） | 800 / 1200 / 1800 / 2000、2000 + 400 × (n − 4) |
| ソフトドロップ / ハードドロップ | 1 / 2 点 × 段数（Level 倍なし） |

- **Back-to-Back**: 「難しい消去」= Tetris・**MEGA CLEAR**・ライン消去を伴う T-Spin / T-Spin Mini。難しい消去が連続すると基本点 ×1.5。通常の1〜3行消去で途切れ、0ラインの固定（0ライン T-Spin を含む）では継続も途切れもしません。Perfect Clear 追加点と Combo には掛かりません。
- **Combo**: ライン消去を伴う固定が連続した回数。2連続目から `50 × combo × Level`。MEGA CLEAR も1回の消去として数えます。ラインを消さない固定でリセット。
- **Level**: 1 から開始し、10ライン消去ごとに +1。

計算は `src/core/ScoreSystem.ts` の純粋関数 `computeClear` にまとめ、テストしています。

## 設定・保存
`localStorage` に保存: 最高スコア、BGM/効果音の音量とミュート、DAS/ARR、ゴースト表示、タッチボタン表示。読み込みに失敗・値が壊れている場合は項目ごとに初期値へ戻します。

## 音楽・効果音と権利について
- BGM は 19 世紀のロシア民謡「コロベイニキ（Коробейники / Korobeiniki）」の旋律をモチーフに、**Web Audio API でその場で合成する独自アレンジ**（音符データは `src/audio/KorobeinikiArrangement.ts`）です。既存ゲームの録音・公式 BGM・既存アレンジの音色や録音は使用しておらず、音源ファイルも同梱していません。
- 旋律自体は一般にパブリックドメインの民謡とされていますが、**公開前に旋律・編曲の取り扱いを各自で確認してください**。特定ゲームを想起させる文脈での利用は権利者の主張を受ける可能性があります。
- 効果音もすべて独自の合成音です。
- 「Tetris」は The Tetris Company の商標です。本作は非公式のオリジナル作品で、ロゴ・画面・音源は流用していません。4ライン消去の表示名に「TETRIS」を用いていますが、公開時は `src/core/ScoreSystem.ts` の `LINE_NAMES` で「QUAD」等へ変更することを推奨します。ゲーム名・内容の公開可否も各自で確認してください。

## テスト
`npm run test` で以下を検証しています（`src/tests/`）。
- 7-bag、10個ごとの GIANT、NEXT 先読みで番号がずれないこと、NEXT GIANT の値
- GIANT が全7種・全姿勢で16個の重複しないセル、T/I/O の形、2×2 展開、4回転で元に戻る
- GIANT が衝突・場外へ回転しない（全周を塞いだ盤面 + ランダム盤面 3000 ケース）、壁際・床での GIANT 回転
- SRS の Y 変換・壁蹴り・床蹴り・I 専用キック・5番目のキックまでの探索順・回転失敗
- T-Spin Single / Double / Mini / 0ライン、回転していない T・回転後に移動した T は非 T-Spin、5番目キックによる格上げ、GIANT T 対象外
- HOLD の回数制限・GIANT 属性と通し番号の維持・交換で供給が進まない
- GIANT のゴースト位置、MEGA CLEAR（5行・8行 + Perfect Clear）
- Combo / Back-to-Back / Perfect Clear の計算
- ロックディレイ 500ms・最大15回リセット・最下段更新でのリセット回数復帰
- Block Out によるゲームオーバー
- ハードドロップ長押しで連続確定しない、DAS/ARR・ARR=0・左右同時押し
- ポーズ中に時間が進まない、復帰時の巨大 dt のクランプ、フレームレート非依存の落下
- 設定保存とフォールバック

## GitHub Pages で公開する

公開URL: **https://funny231217.github.io/giant-mino/**（リポジトリ `funny231217/giant-mino`）

### 仕組み
- `vite.config.ts` で本番ビルドの `base` を `/giant-mino/` に設定しています。JS・CSS はこのサブパス付きの絶対パスで出力されます（開発サーバー `npm run dev` は従来どおり `/` で動作）。
- BGM・効果音は Web Audio API でその場で合成し、アイコンも HTML に埋め込んでいるため、追加の画像・音声ファイルはありません。今後 `public/` に画像などを置く場合は、コードから `import.meta.env.BASE_URL + 'ファイル名'` で参照するか、`src/` から `import` してください（`/xxx.png` のような先頭 `/` の直書きはサブパスで 404 になります）。
- `.github/workflows/deploy.yml` が `main` ブランチへの push（または Actions 画面からの手動実行）で、Node.js LTS + `npm ci` → テスト → ビルド → `dist/` を GitHub Pages へデプロイします。テストかビルドが失敗した場合は公開されません。

### 初回公開
1. GitHub で **`giant-mino`** という名前の空のリポジトリを作成（README などは追加しない）
2. ローカルで初回コミットして push

   ```bash
   git init
   git add .
   git commit -m "Initial commit: GIANT MINO"
   git branch -M main
   git remote add origin https://github.com/funny231217/giant-mino.git
   git push -u origin main
   ```

3. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定
4. **Actions** タブで「Deploy to GitHub Pages」が成功すると公開されます（初回は Source 設定前に走ったワークフローが失敗することがあるので、その場合は Actions 画面から **Re-run jobs** または **Run workflow**）

### 更新
```bash
npm run test && npm run build   # ローカルで確認（任意）
git add .
git commit -m "変更内容"
git push
```
`main` に push すると自動で再ビルド・再デプロイされます。

### 公開前のローカル確認
```bash
npm run build
npm run preview   # http://localhost:4173/giant-mino/ で本番と同じパス構成を確認
```

### リポジトリ名を変える場合
`vite.config.ts` の `PAGES_BASE` を `/新しいリポジトリ名/` に変更してください。独自ドメインやユーザーサイト（`<ユーザー名>.github.io` リポジトリ）で配信する場合は `/` にします。

## ディレクトリ構成

```text
src/
  main.ts                    画面遷移・ループ・各モジュールの接続
  core/
    types.ts                 型と定数
    Board.ts                 10×40 盤面・ライン検出/消去
    Piece.ts                 SRS 形状・GIANT 2×2 展開・スポーン位置
    PieceGenerator.ts        7-bag・通し番号・GIANT 判定
    RotationSystem.ts        SRS キック表・GIANT 専用キック
    CollisionSystem.ts       衝突・落下距離
    LockSystem.ts            ロックディレイ
    SpinDetector.ts          T-Spin 判定（3-corner rule）
    ScoreSystem.ts           スコア・レベル・重力
    InputManager.ts          DAS/ARR・多重発火防止
    GameEngine.ts            ゲーム進行（DOM 非依存）
  rendering/CanvasRenderer.ts  盤面・プレビュー・演出の描画
  audio/AudioManager.ts        BGM スケジューラ・効果音合成
  audio/KorobeinikiArrangement.ts  BGM の音符データ
  ui/UIManager.ts              メニュー・HUD・設定フォーム・タッチボタン
  storage/StorageManager.ts    localStorage
  styles/main.css
  tests/                       Vitest
```
