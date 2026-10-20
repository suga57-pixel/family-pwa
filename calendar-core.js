/* 日付は端末の設定に依存せず、日本時間で扱う。終日は終了日を含まない。 */
(() => {
  'use strict';
  const zone = 'Asia/Tokyo';
  const parts = value => Object.fromEntries(new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(value)).map(p => [p.type, p.value]));
  const day = value => { const p = parts(value); return `${p.year}-${p.month}-${p.day}`; };
  const time = value => { const p = parts(value); return `${p.hour}:${p.minute}`; };
  const addDays = (key, count) => new Date(Date.parse(`${key}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
  const instant = (key, clock = '00:00') => new Date(`${key}T${clock}:00+09:00`).toISOString();
  const weekday = key => new Date(`${key}T00:00:00Z`).getUTCDay();
  function range(key, mode) {
    if (mode === 'day') return { start: key, count: 1 };
    if (mode === 'week') return { start: addDays(key, -weekday(key)), count: 7 };
    const first = `${key.slice(0, 7)}-01`;
    return { start: addDays(first, -weekday(first)), count: 42 };
  }
  function move(key, mode, step) {
    if (mode !== 'month') return addDays(key, step * (mode === 'week' ? 7 : 1));
    const d = new Date(`${key.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + step);
    return d.toISOString().slice(0, 10);
  }
  function overlaps(event, key) {
    const start = Date.parse(event.starts_at), end = Date.parse(event.ends_at);
    const a = Date.parse(instant(key)), b = Date.parse(instant(addDays(key, 1)));
    return start < b && (end > a || (end === start && start >= a));
  }
  function payload(form, household) {
    const title = form.title.trim();
    if (!title || [...title].length > 200) throw new Error('タイトルは1〜200文字で入力してください。');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(form.endDate)) throw new Error('開始日と終了日を入力してください。');
    const starts_at = instant(form.startDate, form.allDay ? '00:00' : form.startTime);
    const ends_at = instant(form.allDay ? addDays(form.endDate, 1) : form.endDate, form.allDay ? '00:00' : form.endTime);
    if (Date.parse(ends_at) < Date.parse(starts_at) || (form.allDay && form.endDate < form.startDate)) throw new Error('終了は開始以降にしてください。');
    return { household_id: household, title, description: form.description, category_id: form.category || null, starts_at, ends_at, all_day: form.allDay };
  }
  function displayEnd(event) {
    // 既存の終了=開始の終日データも1日として開ける。
    return event.all_day && Date.parse(event.ends_at) > Date.parse(event.starts_at)
      ? day(Date.parse(event.ends_at) - 1) : day(event.ends_at);
  }
  window.FamilyCore = Object.freeze({ zone, day, time, addDays, instant, weekday, range, move, overlaps, payload, displayEnd });
})();
