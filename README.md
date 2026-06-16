# Place Organizer

Googleマップの保存リストCSVをSupabaseに投入し、Webアプリで閲覧・検索・分類編集するためのNext.jsアプリです。

## 方針

通常運用ではWeb画面から毎回アップロードしません。

1. Google Maps保存リストCSVを `data/private/` に置く
2. `npm run inspect:private-data` で件数とエラー概要を確認する
3. `npm run seed:places` でSupabaseに投入する
4. `/places` で確認・検索・分類編集する

`/import` は開発者向けの手動アップロード画面として残していますが、通常はseed scriptを使います。

## Public UI

本番公開では、閲覧ページをSupabase anon keyで読みます。`SUPABASE_SERVICE_ROLE_KEY` はVercelに入れません。

- `/` は指標とカテゴリ入口のダッシュボードです。
- `/places` は全体検索です。検索、カテゴリ、行ってみたいのシンプルな条件に絞っています。
- `/categories` と `/category/[slug]` がカテゴリ別探索の中心です。
- `/category/restaurant` ではシーン、価格帯、地域で絞り込めます。
- `/category/art` では Museum / Gallery などのサブカテゴリで絞り込めます。
- `/category/fashion` と `/category/cafe` では `category_tags` があるものだけタグフィルタできます。
- Googleマップで開くボタンは元CSV Google Maps URLを優先します。

`NEXT_PUBLIC_ENABLE_ADMIN=false` の本番公開環境では、レビュー、閉業候補、取込履歴、編集、アーカイブ、AI分類などの管理系導線は非表示になります。書き込みAPIも403になります。

## Google Maps URL Source of Truth

Place Organizerでは、Google Takeout / CSVに含まれる元Google Maps URLを正とします。

- 元CSV Google Maps URLは、ユーザーが実際に保存した地点として最優先します。
- Google Places API補完結果は参考情報です。
- 元リンクと補完結果のURL・名称・座標が矛盾する場合は、元リンクを優先します。
- 補完後の住所・座標・カテゴリ・評価・営業時間などは、元リンクと整合すると判断できる場合のみ正データとして採用します。
- 矛盾する補完候補は `/review` で「補完候補」として確認し、「元リンクを正として採用」できます。

既存データの再判定:

```bash
npm run recheck:source-url -- --dry-run --status needs_review
npm run recheck:source-url -- --dry-run --status enriched
npm run recheck:source-url -- --dry-run --status all
npm run recheck:source-url -- --apply --status needs_review
```

`source_url_confirmed` は「元リンク確認済み」の処理済みデータとして扱い、`--status all` の通常recheckから除外します。確認済みデータも含めて再チェックしたい場合だけ `--include-confirmed` を付けます。

```bash
npm run recheck:source-url -- --dry-run --status all --include-confirmed
```

ログは件数と理由別件数のみを出し、個別の場所名・住所・URLは大量出力しません。

## Privacy

`data/private/`、`sample-data/`、`*.takeout.zip` はGit管理外です。CSVには個人の保存場所情報が含まれるため、CSV本体や場所名・住所・URLの大量出力はしないでください。

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase
- Node.js CSV / JSON / GeoJSON / ZIP parser

## Environment Variables

`.env.example` を `.env.local` にコピーして設定します。

Vercel公開閲覧用:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_ENABLE_ADMIN=false
```

公開ページの `/`、`/places`、`/places/[id]`、`/closed` はSupabase anon keyで読み取ります。Vercel公開環境には `SUPABASE_SERVICE_ROLE_KEY` を入れない方針です。

ローカル管理・script実行用:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_ENABLE_ADMIN=true
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_TOKEN=
GOOGLE_MAPS_API_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=
```

seed/enrich/recheck/classifyなどのローカルscriptに必須:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Web上の書き込みAPIは管理機能です。`NEXT_PUBLIC_ENABLE_ADMIN=false` の場合は403になります。`ADMIN_TOKEN` を設定した場合は、管理API呼び出しに `Authorization: Bearer <ADMIN_TOKEN>` または `x-admin-token` が必要です。

`GOOGLE_MAPS_API_KEY` は将来のPlaces API補完用です。初期seedでは自動実行しません。
`GOOGLE_MAPS_API_KEY` はサーバー側scriptでのみ使用し、クライアントには露出しません。
`OPENAI_API_KEY` はAI分類用です。サーバー側script/APIでのみ使用し、クライアントには露出しません。

## AI Classification

AI分類は補助機能です。手動編集済みの分類は `manual_override=true` として扱い、通常は上書きしません。

```bash
npm run classify:ai -- --dry-run --limit 5
npm run classify:ai -- --dry-run --category Other --limit 10
npm run classify:ai -- --apply --category Other --limit 20
npm run classify:ai -- --apply --only-missing-region --limit 20
```

- まず小さい `--limit` のdry-runで確認してください。
- `--apply` を付けた場合のみDBに保存します。
- `--force` を付けた場合のみ手動優先の分類も上書き対象にできます。
- ログは件数中心にし、個別の場所名・住所・URLは大量出力しません。

## Supabase Setup

1. Place Organizer用のSupabase projectを作成
2. `supabase/migrations/001_initial_place_organizer.sql` をSupabase SQL editorまたはCLIで実行
3. `.env.local` にSupabase URLとservice role keyを設定

作成される主なテーブル:

- `places`
- `place_classifications`
- `source_links`
- `import_batches`
- `google_takeout_snapshots`
- `google_takeout_snapshot_items`

## CSV Setup

`data/private/` にCSVを置きます。

想定ファイル例:

- `Art.csv`
- `Cafe.csv`
- `Fashion.csv`
- `Hotel.csv`
- `Others.csv`
- `Restaurant.csv`
- `行ってみたい.csv`
- `風呂.csv`

一部ファイルがなくても、存在するCSVだけ処理します。

## Inspect

```bash
npm run inspect:private-data
```

出力内容:

- 読み込んだファイル数
- ファイル別件数
- リスト別件数
- 総解析件数
- skipped rows
- real errors
- duplicate candidates
- source list names

個別の場所名・住所・URLは出力しません。

## API-ready Dataset Export

Google Places APIへ直接投げる前に、Takeout CSVのURL列をsource of truthとして保持したまま、APIに渡しやすい中間データを作れます。既存DBには書き込みません。

```bash
npm run export:api-ready
npm run export:api-ready -- --limit 100
npm run export:api-ready -- --list Cafe --limit 50
npm run export:api-ready -- --json
npm run export:api-ready -- --csv
```

出力先:

- `data/derived/api-ready-places.json`
- `data/derived/api-ready-places.csv`
- `data/derived/api-ready-summary.json`

`data/derived/` はGit管理外です。CSV由来の場所名・URLを含むため、共有やコミットはしないでください。

`api_strategy` の意味:

- `place_id_details`: URLからplace_idが取れるため、Place Detailsに渡せます。
- `coordinate_bias_search`: URL由来の座標とquery/name hintを使い、周辺候補として確認します。
- `query_with_bias`: CIDは直接解決できないが、URL由来queryで補助確認できます。
- `source_url_only`: API補完より元CSV URLの保持を優先します。
- `manual_review`: Text Search単独依存など誤マッチリスクが高く、レビュー前提です。

主な `risk_flags`:

- `text_search_only_risky`: タイトルやqueryだけのText Searchになりやすい候補です。
- `chain_or_multi_location_risk`: チェーン店・複数拠点ブランドの可能性があります。
- `generic_name_risk`: 名称が短い、または一般語寄りです。
- `cid_not_directly_supported`: URLからCIDは取れますが、現行Places APIに直接渡せません。
- `no_coordinates`: URLから座標が取れていません。
- `no_place_id`: URLからplace_idが取れていません。
- `short_url_expansion_failed`: 短縮URLの展開に失敗した可能性があります。
- `coordinate_only`: 座標だけの保存地点です。
- `event_or_exhibition_name`: 展示・イベント名の可能性があり、施設名と混同しやすい候補です。

Places APIへ直接渡してよいのは主に `place_id_details` です。`coordinate_bias_search` と `query_with_bias` は候補確認用、`source_url_only` と `manual_review` は元リンク保持または人間レビューを前提にします。

現時点の全件実測では、Takeout URLは1,443件すべて解析できていますが、ほとんどがCID + query中心です。

- `place_url`: 1,442件
- `search_url`: 1件
- `query_with_bias`: 1,198件
- `source_url_only`: 244件
- `manual_review`: 1件
- `no_coordinates`: 1,443件
- `no_place_id`: 1,443件
- `cid_not_directly_supported`: 1,442件
- `chain_or_multi_location_risk`: 236件
- `generic_name_risk`: 73件
- `event_or_exhibition_name`: 8件
- `text_search_only_risky`: 1件

運用方針:

- CSVのURL列を常にsource of truthにします。
- `source_url_confirmed` は例外状態ではなく、通常の正規状態として扱います。
- `query_with_bias` はGoogle Places候補を取得しても自動で `enriched` にしません。
- `source_url_only` は `source_url_confirmed` として扱います。
- `chain_or_multi_location_risk` / `generic_name_risk` / `event_or_exhibition_name` / `text_search_only_risky` / `cid_not_directly_supported` がある場合は、補完結果を正データではなく候補として扱います。
- Places API由来の情報は、元リンクと整合確認できた場合だけ採用します。

## Place ID Normalization

Place ID正規化は任意・実験的な補助機能です。このTakeoutデータではURLから `place_id` は取得できず、ほぼ全件がCID + query中心です。`normalize:place-ids` のdry-runでも高信頼候補は出ていないため、通常運用として `normalize:place-ids --apply` を推奨しません。

判断根拠:

- `place_id_count`: 0件
- `cid_count`: 1,442件
- `coordinate_count`: 0件
- `query_count`: 1,443件
- `normalize:place-ids --dry-run --limit 20`: high 0件 / medium 0件 / low 20件
- `confirmed_count`: 0件

通常は `source_url_confirmed` を正規データとして扱い、CSV由来のGoogle Maps URLを開ける状態を維持します。Place ID候補生成は、必要なときだけ検証用に使います。CSV URLを正とする方針は変えず、`google_place_id` は人間が承認した正データだけに使います。候補は `place_id_candidate` に保存し、`normalized_place_id` / `place_id_confidence` / `place_id_review_reason` で確認できます。

```bash
npm run normalize:place-ids -- --dry-run --limit 20
npm run normalize:place-ids -- --dry-run --strategy query_with_bias --limit 20
npm run normalize:place-ids -- --apply --limit 20
npm run normalize:place-ids -- --strategy query_with_bias --limit 50
npm run normalize:place-ids -- --list Cafe --limit 20
npm run normalize:place-ids -- --status source_url_confirmed --limit 50
```

`query_with_bias` やリスクフラグ付きの候補は、Text Searchだけで自動確定しません。`/review?status=place_id_candidate` は任意の検証画面です。候補を確認する場合だけ使い、承認・却下・元リンク確認済みのまま保持を選びます。

## Seed

```bash
npm run seed:places
```

実行内容:

- `data/private/` 配下のCSVをparse
- normalized itemへ変換
- ファイル名から `source_list_name` を推定
- 重複排除
- ルールベース分類・地域分類
- `places` / `source_links` / `place_classifications` にupsert
- `import_batches` とsnapshotを作成
- 前回snapshotと比較して差分を記録

同じCSVを複数回実行しても、`places` と同じ `source_links` は重複作成されません。CSVから消えたリスト所属は `source_links.active=false` になり、場所自体は物理削除しません。

## Google Places API Enrichment

Google Places APIで、CSV由来の仮登録データに住所・座標・評価・カテゴリ・営業時間・Webサイト・写真参照を補完できます。

Google Cloudで有効化するAPI:

- Places API

`.env.local` に設定:

```bash
GOOGLE_MAPS_API_KEY=
```

料金が発生する可能性があります。初回から全件実行せず、必ずdry-runと少数件数で確認してください。

dry-runではAPIを呼ばず、対象件数と解決戦略だけを確認します。

```bash
npm run enrich:places -- --dry-run --limit 10
```

初回の実行例:

```bash
npm run enrich:places -- --limit 10
```

問題なければ50件単位で実行します。

```bash
npm run enrich:places -- --limit 50
npm run enrich:places -- --limit 50 --reclassify
```

`enrich:places` はデフォルトで、今回 `enriched` になった場所だけ地域分類を再実行します。地域再分類を止めたい場合は `--no-reclassify` を付けます。

```bash
npm run enrich:places -- --limit 50 --no-reclassify
```

対象ステータスを指定できます。

```bash
npm run enrich:places -- --status error --limit 10
npm run enrich:places -- --status not_found --limit 10
```

補完後は `places` の `enrichment_status` が `enriched` / `not_found` / `needs_review` / `error` に更新され、`place_classifications` もGoogleの住所・座標・typesを使って再分類されます。

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

主な画面:

- `/` ダッシュボード
- `/places` 場所一覧
- `/places/[id]` 場所詳細・分類編集
- `/imports` 取込履歴
- `/import` 開発者向け手動アップロード

## Verification

```bash
npm run lint
npm run build
npm test
npm run inspect:private-data
npm run enrich:places -- --dry-run --limit 10
npm run normalize:place-ids -- --dry-run --limit 20
```

Supabase envが設定されている場合:

```bash
npm run seed:places
```

## Vercel Deploy

1. Vercel projectを作成
2. Supabase関連の環境変数を設定
3. Deploy
4. seedはローカルまたはCIから `npm run seed:places` で実行
5. `/places` で登録内容を確認

## Future TODO

- Google Maps共有URLからの手動登録
- Google Places APIのバッチ補完
- AI分類
- より強い近似重複検出
- per-user auth / RLS
- snapshot差分の詳細UI
