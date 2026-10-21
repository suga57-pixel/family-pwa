(() => {
  'use strict';
  const NOTE_COLUMNS = 'id,household_id,category_id,title,content,note_type,is_pinned,created_by,updated_by,created_at,updated_at,deleted_at,version';
  const ITEM_COLUMNS = 'id,household_id,note_id,content,is_checked,sort_order,created_at,updated_at,version';
  const check = r => { if (r.error) throw r.error; return r.data; };
  class Conflict extends Error {
    constructor(latest) { super('内容が変更されたか、アクセスできなくなりました。'); this.latest = latest; }
  }
  const columns = table => table === 'notes' ? NOTE_COLUMNS : ITEM_COLUMNS;
  const allowed = { notes: ['title','content','category_id','is_pinned','deleted_at'], checklist_items: ['content','is_checked','sort_order'] };
  function changes(table, fields) {
    if (Object.keys(fields).some(k => !allowed[table].includes(k))) throw new Error('更新できない列が含まれています。');
    return { ...fields };
  }
  const orderItems = items => [...items].sort((a,b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  // 一つの項目だけを更新できる場合は中間の整数を使う。隙間がなければ順序を整えてから移動する。
  function movePlan(items, id, direction) {
    const sorted = orderItems(items), from = sorted.findIndex(i => i.id === id), to = from + direction;
    if (from < 0 || to < 0 || to >= sorted.length || ![-1,1].includes(direction)) return [];
    const [item] = sorted.splice(from,1); sorted.splice(to,0,item);
    const left = sorted[to-1]?.sort_order, right = sorted[to+1]?.sort_order;
    const rank = left === undefined ? right - 1024 : right === undefined ? left + 1024 : Math.floor((left + right) / 2);
    if (Number.isSafeInteger(rank) && rank >= -2147483648 && rank <= 2147483647 && (left === undefined || rank > left) && (right === undefined || rank < right)) return [{ base:item, sort_order:rank }];
    if (sorted.length > 1000000) throw new Error('項目数が多すぎます。');
    return sorted.map((base,i) => ({base,sort_order:(i+1)*1024})).filter(p => p.base.sort_order !== p.sort_order);
  }
  class Store extends window.FamilyStore.Store {
    async snapshot(household) {
      const results = await Promise.allSettled([
        this.pages('notes', NOTE_COLUMNS, [['household_id',household]]),
        this.pages('checklist_items', ITEM_COLUMNS, [['household_id',household]]),
        this.pages('categories','id,household_id,name,color,type,sort_order',[['household_id',household],['type','note']]),
        this.pages('household_members','household_id,user_id',[['household_id',household]])
      ]);
      const failure = results.find(r => r.status === 'rejected'); if (failure) throw failure.reason;
      return { notes:results[0].value, items:orderItems(results[1].value), categories:results[2].value.sort((a,b)=>a.sort_order-b.sort_order||a.name.localeCompare(b.name)), members:results[3].value };
    }
    async getRow(table, household, id) {
      return check(await this.client.from(table).select(columns(table)).eq('household_id',household).eq('id',id).maybeSingle());
    }
    async insertRow(table, id, fields) {
      const r = await this.client.from(table).insert({id,...fields}).select(columns(table)).single();
      if (r.error?.code === '23505') throw new Conflict(await this.getRow(table,fields.household_id,id));
      return check(r);
    }
    async updateRow(table, base, fields) {
      let query = this.client.from(table).update(changes(table,fields)).eq('household_id',base.household_id).eq('id',base.id).eq('version',base.version);
      if (table === 'checklist_items') query = query.eq('note_id',base.note_id);
      const row = check(await query.select(columns(table)).maybeSingle());
      if (!row) throw new Conflict(await this.getRow(table,base.household_id,base.id));
      return row;
    }
    async deleteItem(base) {
      const row = check(await this.client.from('checklist_items').delete().eq('household_id',base.household_id).eq('note_id',base.note_id).eq('id',base.id).eq('version',base.version).select(ITEM_COLUMNS).maybeSingle());
      if (!row) throw new Conflict(await this.getRow('checklist_items',base.household_id,base.id));
      return row;
    }
    async category(household,name,color) {
      return check(await this.client.from('categories').insert({household_id:household,name,color,type:'note'}).select('id,household_id,name,color,type,sort_order').single());
    }
  }
  window.FamilyNotesStore = Object.freeze({Store,Conflict,NOTE_COLUMNS,ITEM_COLUMNS,orderItems,movePlan});
})();
