# Family — 第2段階：共有カレンダー

第1段階のHTML / CSS / JavaScriptと同梱Supabase JSを維持して共有カレンダーを追加しました。ビルド不要、GitHub Pagesのサブパスに対応する構成です。既存のSupabaseのテーブル・RLS・関数・トリガー・publicationは変更していません。

## 実装内容

- 月表示（6週）、週表示（日曜始まりの日別リスト）、日表示、前後移動、今日への移動。
- 日付から予定作成、詳細・編集、ゴミ箱への論理削除、復元。物理削除APIは呼びません。
- 時刻付き、終日、複数日予定。端末の地域設定によらず日本時間（Asia/Tokyo）です。終日の終了日は画面ではその日を含み、DBでは翌日0時を終了として保存します。
- 予定用カテゴリの選択・色分け、新規カテゴリの追加。カテゴリ名は1〜50文字。カテゴリ編集・削除は今回対象外。
- タイトル・詳細の全期間検索、カテゴリ・未分類の絞り込み、ゴミ箱の全期間一覧。ページ分割で全件取得し、APIの1ページ上限で切り捨てません。
- 作成者・更新者・時刻・version表示。氏名の列がないため「自分」「共有メンバー」とUUIDを表示します。相手のメールや氏名は取得しません。
- events / categoriesのRealtime購読。再接続・オンライン復帰・画面復帰時の再取得、表示中は60秒ごとの補完取得、手動再取得。
- 保存・削除・復元すべてでid / household_id / 読み込み時versionを条件として更新。versionや監査情報は既存トリガーが設定します。
- 更新0件の場合は最新内容を表示し、上書きを止め、編集中の入力を保持します。新規作成の通信再送には同じUUIDを使い、二重作成を防ぎます。
- アカウント・家族の切替後は古い通信結果を反映しません。家族データをlocalStorageやService Workerキャッシュには保存しません。
- スマホは月マスの予定を3件＋残件数で表示し、残件数から日表示に移れます。週・日は時間軸ではなく日別一覧です。PC / iPad / スマホ向けCSS、配色切替、キーボード操作に対応しています。

既存のログイン・セッション保持・ログアウトと、登録画面を設けない方針を引き継いでいます。メモとチェックリストは準備中の画面のままです。

## ファイル

| ファイル | 内容 |
| --- | --- |
| index.html | 認証画面、カレンダー、予定・カテゴリダイアログ |
| app.js | 第1段階の認証・ナビゲーションとカレンダーへの認証通知 |
| calendar-core.js | 日本時間、日付計算、表示期間、入力の変換 |
| calendar-store.js | 確認済みの列で取得・作成・version条件付き更新 |
| calendar.js | カレンダー画面、競合処理、Realtime、再取得 |
| calendar.css / styles.css | カレンダーUI / 既存共通UI |
| config.js | 公開用Project URLとpublishable / anon key |
| sw.js | 静的資産だけのキャッシュ。番号をstage2-v1へ更新済み |
| manifest.webmanifest / icons/ / .nojekyll | 既存のPWA・Pages関連 |
| vendor/ | 第1段階と同じSupabase JS 2.57.4とライセンス |
| DB-SCHEMA.json | ユーザー提供のDB定義。レコードデータは含みません |
| TEST-GUIDE.md / TEST-RESULTS.md | 実機テスト手順 / 実施済み確認と未検証点 |
| tests/ | Node.jsで再実行できる代替テスト。公開には不要 |

## 接続情報

今回のconfig.jsには、第1段階の作業フォルダーにあった公開用設定を引き継ぎました。**現在ログインできている公開サイトのconfig.jsと異なる場合は、稼働中のconfig.jsをそのまま使用してください。** キーの作り直しは不要です。

ブラウザに置けるのはpublishable / anon keyだけです。既存の入力チェックはservice_role JWTとsb_secretキーを拒否します。パスワード・service_role・DB接続文字列は置かないでください。

認証ストレージキーは既存と同じ `family-auth-<Supabaseホスト名>` です。同じ公開URL・Project URL・保存領域で更新すればセッションを引き継ぐ設計です。Safariとホーム画面PWAの両方で確認してください。

## GitHub Pages更新手順

1. 現在のリポジトリのファイルをバックアップします。特に稼働中のconfig.jsを保存してください。
2. ZIPを展開し、**Familyフォルダーの中身**を現在の公開元と同じ場所へ上書きします。公開元がmainのルートならindex.htmlがルートにある配置を維持し、Familyフォルダーをもう一段追加しないでください。
3. 新規のcalendar関連4ファイル、sw.js、icons/、vendor/、.nojekyllを含めます。ドキュメント・tests/・DB-SCHEMA.jsonは公開動作に不要です。
4. config.jsを稼働中のものと照合し、現在公開に使っているブランチへコミットします。Pages設定は変更不要です。
5. GitHubのデプロイ完了後、[既存の公開URL](https://suga57-pixel.github.io/family-pwa/)を開き、「第2段階 · カレンダー」と月/週/日・予定作成ボタンを確認します。
6. 旧画面なら、Safariの該当タブとホーム画面PWAをすべて閉じて開き直します。更新したService Workerの取得後、もう一度閉じて開く必要がある場合があります。セッション保持の確認前にサイトデータを消さないでください。
7. TEST-GUIDE.mdに沿って夫婦・2端末で確認します。

今回、GitHubへの書き込みや本番サイトの更新は実行していません。

## 起動とテスト

FamilyフォルダーをVS CodeのLive ServerなどのHTTPサーバーで開きます。file://で直接起動しないでください。PWAはHTTPSまたはlocalhostで使います。

Node.jsがあれば、Familyフォルダーで次を実行できます。外部パッケージは不要です。

```text
node tests/core-store.cjs
node tests/ui-auth.cjs
```

## DBとの対応・範囲

DB-SCHEMA.jsonを確認して実装しました。households.id/nameとhousehold_members.household_id/user_idを読み、本人の所属が確認できたグループを表示します。所属がない場合にテーブル作成やメンバー自動登録は行いません。

eventsはtitle（1〜200文字）、description、starts_at、ends_at、all_day、category_id、deleted_atを使用し、ends_at >= starts_atを検証します。category_idは同じ家族のtype='event'だけを選びます。監査情報とversionはset_creation_metadata / set_update_metadataに任せます。新規UUIDだけは再送の重複防止のためブラウザで発行します。

categoriesにはversion列がないため、今回のUIは参照と追加だけです。name/color/type='event'/household_idを送信し、sort_orderはDB既定値を使います。

RealtimeのDELETE通知はフィルタできないため、通知内容を画面に使わずRLS付き再取得のきっかけにだけ使います。RLS定義は確認しましたが、実ログインでの権限・実Realtime接続は今回実証していません。

既存の終了=開始の予定も表示します。既存の終日データが「終了日23:59」などの場合、表示できますが、この画面から保存すると終了日翌日0時へ揃います。

検索はゴミ箱を含む家族の予定を全件取得後に行います。大規模データ向けのサーバー検索・仮想スクロールは含みません。通信失敗時は部分的な取得を成功扱いせず、再取得を案内します。保存結果不明の際は、入力をコピーして一覧と最新内容を確認してください。

未実装：メモCRUD、チェックリストCRUD、JSONバックアップ、繰り返し、通知、オフライン保存、時間軸のドラッグ編集。

仕様参考：[Supabase公式・Realtime購読](https://supabase.com/docs/reference/javascript/on)、[Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)、[条件付き更新](https://supabase.com/docs/reference/javascript/update)。
