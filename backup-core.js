(() => {
  'use strict';
  const tables = ['categories', 'events', 'notes', 'checklist_items'];
  const fields = {
    categories: ['id','name','color','type','sort_order'],
    events: ['id','category_id','title','description','starts_at','ends_at','all_day','deleted_at'],
    notes: ['id','category_id','title','content','note_type','is_pinned','deleted_at'],
    checklist_items: ['id','note_id','content','is_checked','sort_order']
  };
  const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
  const fail = text => { throw new Error(text); };
  const object = x => x && typeof x === 'object' && !Array.isArray(x);
  const str = (x, max) => typeof x === 'string' && x.length <= max && !x.includes('\u0000');
  const date = x => {
    if(typeof x!=='string')return false;
    const m=x.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/);
    if(!m||!Number.isFinite(Date.parse(x)))return false;
    const year=+m[1],month=+m[2],day=+m[3];
    const days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31,30,31];
    return month>=1&&month<=12&&day>=1&&day<=days[month-1]&&+m[4]<24&&+m[5]<60&&+m[6]<60&&+(m[7]||0)<24&&+(m[8]||0)<60;
  };
  const integer = x => Number.isInteger(x) && x >= -2147483648 && x <= 2147483647;
  const pick = (table, row) => Object.fromEntries(fields[table].map(k => [k, row[k]]));
  const canonical = (table,row) => JSON.stringify(fields[table].filter(k=>k!=='id').map(k => {
    const v=row[k]; return /_at$/.test(k) && v ? new Date(v).toISOString() : v;
  }));
  function validate(file) {
    if (!object(file) || Object.keys(file).some(k=>!['format','schemaVersion','exportedAt','sourceHousehold','data'].includes(k)) || file.format !== 'FamilyBackup' || file.schemaVersion !== 1 || !date(file.exportedAt) || !uuid(file.sourceHousehold) || !object(file.data)) fail('FamilyBackup v1形式を確認してください。');
    if (Object.keys(file.data).length!==4 || tables.some(t=>!Array.isArray(file.data[t]))) fail('4種類のデータ配列が必要です。');
    let total=0; const maps={};
    for (const t of tables) {
      maps[t]=new Map();
      for (const r of file.data[t]) {
        if (++total>10000) fail('上限10,000行です。');
        if (!object(r) || Object.keys(r).length!==fields[t].length || fields[t].some(k=>!Object.hasOwn(r,k)) || !uuid(r.id) || r.id!==r.id.toLowerCase() || maps[t].has(r.id)) fail(`${t}: 列・ID・重複を確認してください。`);
        maps[t].set(r.id,r);
        if (t==='categories') {
          if (!str(r.name,100) || !r.name.trim() || [...r.name.trim()].length>50 || !/^#[0-9a-f]{6}$/i.test(r.color) || !['event','note'].includes(r.type) || !integer(r.sort_order)) fail('カテゴリが不正です。');
        } else if (t==='events') {
          if (!str(r.title,400) || !r.title.trim() || [...r.title.trim()].length>200 || !str(r.description,100000) || !date(r.starts_at) || !date(r.ends_at) || Date.parse(r.ends_at)<Date.parse(r.starts_at) || typeof r.all_day!=='boolean') fail('予定が不正です。');
        } else if (t==='notes') {
          if (!str(r.title,10000) || !str(r.content,100000) || !['text','checklist'].includes(r.note_type) || typeof r.is_pinned!=='boolean') fail('メモが不正です。');
        } else if (!str(r.content,100000) || typeof r.is_checked!=='boolean' || !integer(r.sort_order) || !uuid(r.note_id)) fail('チェック項目が不正です。');
        if (t==='events'||t==='notes') {
          if (r.deleted_at!==null && !date(r.deleted_at)) fail('ゴミ箱日時が不正です。');
          if (r.category_id!==null && !uuid(r.category_id)) fail('カテゴリIDが不正です。');
        }
      }
    }
    const categoryKeys=new Set();
    for(const r of file.data.categories){const key=JSON.stringify([r.type,r.name]);if(categoryKeys.has(key))fail('カテゴリ名が重複しています。');categoryKeys.add(key);}
    for(const t of ['events','notes']) for(const r of file.data[t]) if(r.category_id && maps.categories.get(r.category_id)?.type!==(t==='events'?'event':'note')) fail('カテゴリ参照または種類が不正です。');
    for(const r of file.data.checklist_items) if(maps.notes.get(r.note_id)?.note_type!=='checklist') fail('チェック項目の親が不正です。');
    return file;
  }
  function encode(snapshot, household) {
    return validate({format:'FamilyBackup',schemaVersion:1,exportedAt:new Date().toISOString(),sourceHousehold:household,data:Object.fromEntries(tables.map(t=>[t,snapshot[t].map(r=>pick(t,r))]))});
  }
  async function targetId(home, sourceHome, table, id) {
    const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`FamilyBackup/v1/${home}/${sourceHome}/${table}/${id}`)));
    bytes[6]=(bytes[6]&15)|80; bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  async function plan(file, snapshot, home) {
    validate(file); if(!uuid(home))fail('共有グループが不正です。');
    const maps={categories:new Map(),notes:new Map()}, rows=[], conflicts=[], skipped=[];
    for(const t of tables) for(const original of file.data[t]) {
      const row=pick(t,original); row.id=await targetId(home,file.sourceHousehold,t,original.id);
      if(t==='events'||t==='notes')row.category_id=original.category_id ? maps.categories.get(original.category_id) : null;
      if(t==='checklist_items')row.note_id=maps.notes.get(original.note_id);
      const candidates=snapshot[t];
      // 同じ元IDまたは再実行IDが変化していた場合は追加を止め、変更を隠さない。
      const sameId=candidates.find(r=>r.id===row.id || (file.sourceHousehold===home && r.id===original.id));
      let existing=sameId;
      if(!existing && t==='categories') existing=candidates.find(r=>r.type===row.type && r.name===row.name);
      if(!existing && t==='events') existing=candidates.find(r=>canonical(t,r)===canonical(t,row));
      // 親IDが違う同内容のメモも候補として止める。項目を誤って既存リストへ結合しない。
      if(!existing && t==='notes' && candidates.some(r=>canonical(t,r)===canonical(t,row))) conflicts.push(`notes: 同内容の別IDがあります (${original.id})。内容を確認してください。`);
      if(existing) {
        if(canonical(t,existing)!==canonical(t,row)) conflicts.push(`${t}: 既存データとの差異 (${original.id})`);
        skipped.push({table:t,sourceId:original.id,id:existing.id,expected:pick(t,existing)});
        if(maps[t])maps[t].set(original.id,existing.id);
      } else {
        // 入力ファイル内の同内容も検出し、黙って複製しない。
        if(t!=='checklist_items' && rows.some(x=>x.table===t && canonical(t,x.row)===canonical(t,row))) conflicts.push(`${t}: ファイル内の同内容重複 (${original.id})`);
        rows.push({table:t,sourceId:original.id,row:{...row,household_id:home}});
        if(maps[t])maps[t].set(original.id,row.id);
      }
    }
    // 完全一致の親を再利用する場合、子の余分な行も差異として扱う。
    for(const s of skipped.filter(s=>s.table==='notes')) {
      if(rows.some(x=>x.table==='checklist_items'&&x.row.note_id===s.id))conflicts.push(`notes: 既存リストへの項目追加は行いません (${s.sourceId})`);
      const expected=file.data.checklist_items.filter(r=>r.note_id===s.sourceId).length;
      const actual=snapshot.checklist_items.filter(r=>r.note_id===s.id).length;
      if(expected!==actual)conflicts.push(`notes: 既存リストの項目数が異なります (${s.sourceId})`);
    }
    return {household:home,rows,skipped,conflicts,counts:Object.fromEntries(tables.map(t=>[t,rows.filter(x=>x.table===t).length]))};
  }
  const check = result => {if(result.error)throw result.error;return result.data;};
  class Store {
    constructor(client,guard=()=>true){this.client=client;this.guard=guard;}
    assert(){if(!this.guard())fail('ログインまたは操作状態が変わったため停止しました。');}
    async snapshot(home){
      this.assert();const data={};
      for(const t of tables){data[t]=[];for(let offset=0;;){this.assert();const batch=check(await this.client.from(t).select(fields[t].join(',')+',household_id'+(t==='categories'?'':',version')).eq('household_id',home).order('id').range(offset,offset+499));this.assert();data[t].push(...batch);if(data[t].length>10000)fail('上限10,000行です。');if(!batch.length)break;offset+=batch.length;}}
      return data;
    }
    async stable(home){
      const a=await this.snapshot(home),b=await this.snapshot(home);
      if(JSON.stringify(a)!==JSON.stringify(b))fail('取得中にデータが変わりました。ふたりとも編集を止めて再試行してください。');
      encode(b,home);return b;
    }
    async execute(p, report){
      if(p.conflicts.length)fail('差異を解消してからやり直してください。');
      const deferred=[];report.status='実行中';
      try {
        for(const op of p.rows){
          this.assert();const entry={table:op.table,id:op.row.id,state:'結果不明'};report.operations.push(entry);
          const row={...op.row};
          if(op.table==='notes' && row.note_type==='checklist' && row.deleted_at){deferred.push(op);row.deleted_at=null;}
          const saved=check(await this.client.from(op.table).insert(row).select('id'+(op.table==='categories'?'':',version')).single());
          entry.state='追加応答あり'; entry.version=saved.version;
        }
        for(const op of deferred){
          this.assert();const entry=report.operations.find(x=>x.id===op.row.id&&x.table===op.table);entry.state='ゴミ箱状態の保存結果不明';
          const saved=check(await this.client.from('notes').update({deleted_at:op.row.deleted_at}).eq('id',op.row.id).eq('household_id',p.household).eq('version',entry.version).select('id,version').maybeSingle());
          if(!saved)fail('復元中のリストが更新されました。');entry.state='追加応答あり';entry.version=saved.version;
        }
        this.assert();const after=await this.stable(p.household);
        for(const op of p.rows){const row=after[op.table].find(r=>r.id===op.row.id);if(!row||canonical(op.table,row)!==canonical(op.table,op.row))fail('復元後の内容が一致しません。');}
        for(const op of p.skipped){const row=after[op.table].find(r=>r.id===op.id);if(!row||canonical(op.table,row)!==canonical(op.table,op.expected))fail('再利用したデータが変わりました。');}
        report.status='追加分の内容・参照整合性確認済み';
      }catch(error){report.status='途中停止・自動取り消しなし';throw error;}
      return report;
    }
  }
  window.FamilyBackup=Object.freeze({tables,fields,validate,encode,plan,Store,canonical,targetId});
})();
