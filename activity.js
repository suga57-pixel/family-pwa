(() => {
  'use strict';
  const parts = date => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
  }).formatToParts(date).map(p => [p.type,p.value]));
  const day = date => { const p = parts(date); return p.year+p.month+p.day; };
  const stamp = value => {
    if (!value || !Number.isFinite(Date.parse(value))) return '未確認';
    const p = parts(new Date(value));
    return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second} JST`;
  };
  function status(value, now = new Date()) {
    const valid = value && Number.isFinite(Date.parse(value));
    const p = parts(now);
    // 初回+3リトライ（5分間隔、各最大60秒）に余裕を加え09:20まで待つ。
    return {date:valid ? day(new Date(value)) : '未確認',
      failed:(Number(p.hour)*60+Number(p.minute) >= 560) && (!valid || day(new Date(value)) !== day(now))};
  }
  window.FamilyActivityCore = Object.freeze({status, stamp});
  if (typeof document === 'undefined') return;
  let client = null, user = null, epoch = 0, data = null, confirmed = false, running = false;
  const render = () => {
    const s = status(data?.last_updated_at);
    const label = document.querySelector('.brand-fetch');
    if (label) label.textContent = `最終更新日時：${s.date} vol_1.2.2`;
    const warning = document.getElementById('activity-warning');
    if (warning) { warning.hidden = !user || !s.failed; warning.textContent = '自動更新失敗'; }
    const info = document.getElementById('settings-activity');
    if (info) info.textContent = user ? `自動フラグ最終成功日時：${stamp(data?.last_success_at)}${confirmed ? '' : '（更新状況を確認できません）'}。実行予定：毎日09:00・15:00・18:00 JST。失敗判定は09:20以降。` : 'ログイン後に更新状況を確認できます。';
  };
  async function refresh() {
    if (!client || !user || running) return;
    running = true; const current = epoch;
    try {
      const r = await client.rpc('family_activity_status');
      if (current !== epoch) return;
      if (r.error || !r.data?.length) { confirmed = false; }
      else { data = r.data[0]; confirmed = true; }
    } catch { if (current === epoch) confirmed = false; }
    finally { running = false; render(); }
  }
  window.FamilyActivity = {
    setSession(nextClient, session) {
      const next = session?.user?.id || null;
      client = nextClient;
      if (next === user) return;
      user = next; epoch++; data = null; confirmed = false; render();
      // Supabase認証コールバック内で通信を待たない。
      setTimeout(refresh, 0);
    }, refresh
  };
  setInterval(() => { render(); refresh(); }, 30000);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('family-data-written', refresh);
  document.getElementById('settings-open').addEventListener('click', refresh);
})();
