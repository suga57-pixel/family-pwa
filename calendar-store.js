(() => {
  'use strict';
  const EVENT_COLUMNS = 'id,household_id,category_id,title,description,starts_at,ends_at,all_day,created_by,updated_by,created_at,updated_at,deleted_at,version';
  class Conflict extends Error { constructor(latest) { super('予定が更新されたか、アクセスできなくなりました。'); this.latest = latest; } }
  const check = result => { if (result.error) throw result.error; return result.data; };
  class Store {
    constructor(client) { this.client = client; }
    async pages(table, columns, filters = []) {
      const rows = [];
      for (let offset = 0; ;) {
        let query = this.client.from(table).select(columns);
        query = table === 'household_members' ? query.order('household_id').order('user_id') : query.order('id');
        for (const [key, value] of filters) query = query.eq(key, value);
        const batch = check(await query.range(offset, offset + 499));
        rows.push(...batch);
        if (!batch.length) return rows;
        offset += batch.length;
      }
    }
    async households(user) {
      const memberships = await this.pages('household_members', 'household_id,user_id', [['user_id', user]]);
      const homes = await this.pages('households', 'id,name');
      return homes.filter(h => memberships.some(m => m.household_id === h.id));
    }
    async snapshot(household) {
      const results = await Promise.allSettled([
        this.pages('events', EVENT_COLUMNS, [['household_id', household]]),
        this.pages('categories', 'id,household_id,name,color,type,sort_order', [['household_id', household], ['type', 'event']]),
        this.pages('household_members', 'household_id,user_id', [['household_id', household]])
      ]);
      const failure = results.find(r => r.status === 'rejected');
      if (failure) throw failure.reason;
      return { events: results[0].value, categories: results[1].value.sort((a,b) => a.sort_order-b.sort_order || a.name.localeCompare(b.name)), members: results[2].value };
    }
    async get(household, id) {
      return check(await this.client.from('events').select(EVENT_COLUMNS).eq('household_id', household).eq('id', id).maybeSingle());
    }
    async create(id, fields) {
      const result = await this.client.from('events').insert({ id, ...fields }).select(EVENT_COLUMNS).single();
      // 通信切断後の再送で同じ予定を二重登録しない。
      if (result.error?.code === '23505') throw new Conflict(await this.get(fields.household_id, id));
      return check(result);
    }
    async update(base, fields) {
      const { household_id, ...changes } = fields;
      const result = check(await this.client.from('events').update(changes)
        .eq('household_id', base.household_id).eq('id', base.id).eq('version', base.version)
        .select(EVENT_COLUMNS).maybeSingle());
      if (!result) throw new Conflict(await this.get(base.household_id, base.id));
      return result;
    }
    async category(household, name, color) {
      return check(await this.client.from('categories').insert({ household_id: household, name, color, type: 'event' }).select('id,household_id,name,color,type,sort_order').single());
    }
  }
  window.FamilyStore = Object.freeze({ Store, Conflict, EVENT_COLUMNS });
})();
