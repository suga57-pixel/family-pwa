/* Shared display rules. No network requests or database writes. */
(() => {
  'use strict';
  // Cabinet Office, checked 2026-10-21. Future years must be updated from the official list.
  // https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html
  const holidays = {
    '2026-01-01':'元日','2026-01-12':'成人の日','2026-02-11':'建国記念の日','2026-02-23':'天皇誕生日',
    '2026-03-20':'春分の日','2026-04-29':'昭和の日','2026-05-03':'憲法記念日','2026-05-04':'みどりの日',
    '2026-05-05':'こどもの日','2026-05-06':'振替休日','2026-07-20':'海の日','2026-08-11':'山の日',
    '2026-09-21':'敬老の日','2026-09-22':'国民の休日','2026-09-23':'秋分の日','2026-10-12':'スポーツの日',
    '2026-11-03':'文化の日','2026-11-23':'勤労感謝の日',
    '2027-01-01':'元日','2027-01-11':'成人の日','2027-02-11':'建国記念の日','2027-02-23':'天皇誕生日',
    '2027-03-21':'春分の日','2027-03-22':'振替休日','2027-04-29':'昭和の日','2027-05-03':'憲法記念日',
    '2027-05-04':'みどりの日','2027-05-05':'こどもの日','2027-07-19':'海の日','2027-08-11':'山の日',
    '2027-09-20':'敬老の日','2027-09-23':'秋分の日','2027-10-11':'スポーツの日','2027-11-03':'文化の日','2027-11-23':'勤労感謝の日'
  };
  function owner(id, members, user) {
    const ids = [...new Set((members || []).map(m=>m.user_id))].sort();
    const index = id ? ids.indexOf(id) : -1;
    if (index < 0) return {slot:'unknown',label:'作成者不明'};
    return {slot:String(index % 4),label:`${String.fromCharCode(65 + index)}${id === user?.id ? '（自分）' : '（共有）'}`};
  }
  function mark(node, id, members, user) {
    const info = owner(id, members, user);
    node.setAttribute('data-owner', info.slot);
    return info;
  }
  function badge(id, members, user) {
    const info = owner(id, members, user), node = document.createElement('span');
    node.className = 'owner-badge'; node.textContent = info.label; node.setAttribute('data-owner',info.slot);
    return node;
  }
  function legend(node, members, user) {
    node.replaceChildren();
    const title = document.createElement('span'); title.textContent = '作成者：'; node.append(title);
    for (const id of [...new Set((members || []).map(m=>m.user_id))].sort()) node.append(badge(id,members,user));
  }
  window.FamilyUI = Object.freeze({holiday:key=>holidays[key] || '',holidayYears:[2026,2027],owner,mark,badge,legend});
})();
