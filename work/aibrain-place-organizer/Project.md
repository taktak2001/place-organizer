# Place Organizer

## 概要
Googleマップの保存リストCSVをSupabaseに投入し、Webアプリで閲覧・検索・分類編集するためのNext.jsアプリ。

## 現在の方針
Web画面から毎回インポートする方式ではなく、プロジェクト内の `data/private/` にCSVを置き、seed scriptでSupabaseへ投入する構成を主軸にする。

## 技術スタック
- Next.js / TypeScript / Tailwind CSS
- Supabase
- Node.js CSV / JSON / GeoJSON / ZIP parser
- Vercel deploy想定

## 主要画面
- `/`: ダッシュボード
- `/places`: 場所一覧、検索、フィルタ
- `/places/[id]`: 詳細、分類編集、元リスト確認
- `/imports`: 取込履歴
- `/import`: 開発者向け手動アップロード画面。通常運用では非推奨。

## 通常運用
1. Google Maps保存リストCSVを `data/private/` に置く
2. `npm run inspect:private-data` で件数・エラー概要を確認
3. `npm run seed:places` でSupabaseに投入
4. `/places` で確認・検索・分類編集

## Privacy
CSVには個人の保存場所情報が含まれるため、`data/private/`、`sample-data/`、`*.takeout.zip` はGit管理外。ログやREADMEには場所名・住所・URLを大量出力しない。
