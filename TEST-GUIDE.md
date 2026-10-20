# 公開後の実機テスト

夫・妻が別端末・別ブラウザ保存領域でログインして確認します。タイトルに「テスト」を付けた検証専用予定を使い、既存の大切な予定は使わないでください。SQL Editorの管理者テストは、この確認の代わりにはなりません。

## 更新・認証

PCとiPhoneで既存URLを開き、「第2段階 · カレンダー」と月/週/日・作成ボタンを確認します。保存済みログインを保持し、再読込しても家族を表示することを確認。一方の端末でログアウトし、その端末では予定・作成者情報が消え、他方のログインは維持されることを確認してから再ログインします。

取得エラーや所属なしになる場合、RLSを変更せず画面のメッセージを記録してください。

## 夫婦の作成・編集・削除・復元

1. 夫が「テスト・時刻付き」を今日09:00〜10:00で作成。作成者「自分」、version 1を確認。
2. 妻側に再読込なしで現れるか確認。作成者に夫のUUIDが出ることを確認。
3. 妻が詳細を編集。更新者が妻になり、versionが増え、夫側へ反映することを確認。
4. 夫がゴミ箱へ移し、双方の通常表示から消えることを確認。「ゴミ箱」で双方が同じ予定を見られることを確認。
5. 妻が復元し、双方に戻り、versionがさらに増えることを確認。
6. 妻が作成した別のテスト予定でも、夫が編集・削除・復元できることを確認。

## 日付・表示・検索

- 同日開始/終了の終日はその日だけに表示。
- 月末から3日間の終日は、終了日も表示し、その翌日は表示しない。
- 23:00〜翌日01:00は両日に表示。翌日00:00終了なら翌日には表示しない。
- 開始=終了の時刻付き予定は開始日に表示。
- 月/週/日、前後移動、今日、月マスの残件数から日表示への移動。
- カテゴリ追加・色・分類が双方に反映。同名カテゴリ、空タイトル、終了が開始より前の入力を拒否。
- 表示月外の予定をタイトル・詳細で全期間検索。カテゴリ・未分類・ゴミ箱の絞り込み。

## 同時編集の競合

1. 夫と妻が同じ予定の編集画面を開きます。
2. 夫がタイトルを変更して保存します。
3. 妻は編集画面を開いたまま別のタイトルを入力し、保存します。
4. 妻の保存が止まり、夫の最新内容と妻の入力が両方残ることを確認。夫の変更を上書きしていないことを確認します。
5. 必要な入力をコピー後「最新の内容を開く」で確認して再編集します。
6. 一方が編集中に他方が削除した場合、両方がゴミ箱の予定を開いた後に一方が復元した場合も、古い編集・復元が止まることを確認します。

古い入力で上書きできた場合は、versionを記録して利用を止めて報告してください。version条件を外す変更は行いません。

## Realtime・切断と復帰

双方で「リアルタイム接続中」を確認。作成・更新・削除・復元・カテゴリ追加が相手へ数秒程度で反映するか確認します。60秒後にだけ反映した場合は定期取得の可能性があり、Realtime成功とは判定しません。

片方をオフラインにして保存が無効になることを確認。他方で変更してからオンラインへ戻し、最新になることを確認します。iPhoneの画面ロック、Safari/PWAの背面からの復帰も確認。「再接続中」が続く場合は設定変更せず、端末・時刻・表示を記録してください。

## RLS：未認証の読み取り

PCでFamilyページの開発者ツールのConsoleを開き、以下を実行します。既存セッションとは別の未認証クライアントです。キーやデータをチャットへ貼らないでください。

```javascript
const anonCheck = window.supabase.createClient(
  window.FAMILY_CONFIG.supabaseUrl, window.FAMILY_CONFIG.supabaseKey,
  { auth: { persistSession: false, autoRefreshToken: false,
            detectSessionInUrl: false, storageKey: 'family-rls-check-anonymous' } }
);
for (const table of ['households','household_members','categories','events']) {
  const { data, error } = await anonCheck.from(table).select('*').limit(1);
  console.log(table, { rows: data?.length ?? null, errorCode: error?.code ?? null });
}
```

すべて0件またはアクセス拒否が期待結果です。1件でも取得できたら公開利用を進めず、テーブル名・件数を記録してください。

## RLS：所属外ユーザー

所属外の既存テストユーザーがある場合だけ、別ブラウザでそのユーザーとしてログインし、家族データが表示されないことを確認します。いなければ「所属外RLSは未検証」と記録します。このために新規登録を許可したり、夫婦の所属を外したりしないでください。

直接APIの書込拒否も確認する場合は、夫婦側で作った検証専用予定のidとhousehold_idを用意し、**所属外ユーザーとしてログインしたConsoleでだけ**以下を実行します。最初の2変数を実際の検証用IDに置き換えます。

```javascript
const testHouseholdId = '検証専用予定のhousehold_id';
const testEventId = '検証専用予定のid';
const outsideCheck = window.supabase.createClient(
  window.FAMILY_CONFIG.supabaseUrl, window.FAMILY_CONFIG.supabaseKey,
  { auth: { persistSession: true, autoRefreshToken: true,
            detectSessionInUrl: false,
            storageKey: `family-auth-${new URL(window.FAMILY_CONFIG.supabaseUrl).hostname}` } }
);
const deniedUpdate = await outsideCheck.from('events')
  .update({ description: 'RLS拒否テスト・この変更が見えたら失敗' })
  .eq('household_id', testHouseholdId).eq('id', testEventId).select('id');
console.log('所属外UPDATE', {
  rows: deniedUpdate.data?.length ?? null,
  errorCode: deniedUpdate.error?.code ?? null
});
const deniedInsert = await outsideCheck.from('events').insert({
  household_id: testHouseholdId, title: 'RLS拒否テスト・作成されたら失敗',
  starts_at: '2026-10-21T00:00:00+09:00',
  ends_at: '2026-10-21T01:00:00+09:00', all_day: false
}).select('id');
console.log('所属外INSERT', {
  rows: deniedInsert.data?.length ?? null,
  errorCode: deniedInsert.error?.code ?? null
});
```

UPDATEは0件または拒否、INSERTは拒否が期待結果です。夫婦側でもテスト予定が変わっていないこと、拒否テストの新規予定がないことを確認します。予想外に成功した場合は結果を報告し、発生した検証用予定は夫婦側のUIからゴミ箱へ移せます。RLS設定変更が必要ならそこで止めてください。

## 端末・PWA

スマホ縦横、iPad縦横、PCで横のはみ出し、文字、タッチ、ダイアログのスクロール、保存/閉じる、ソフトキーボードを確認します。PCはTabとEsc、ライト/ダーク両方を確認。ホーム画面PWAでも認証・共有を確認します。

確認したテスト予定はゴミ箱へ移します。カテゴリは今回のUIで削除できないため、追加するなら実際に使う名前にしてください。
