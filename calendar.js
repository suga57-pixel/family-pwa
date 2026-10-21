(() => {
  'use strict';
  const C = window.FamilyCore;
  const $ = id => document.getElementById(id);
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  function message(id, text = '') { $(id).textContent = text; $(id).hidden = !text; }
  const dateLabel = key => `${Number(key.slice(0,4))}年${Number(key.slice(5,7))}月${Number(key.slice(8))}日`;
  const stamp = value => value ? `${C.day(value)} ${C.time(value)}` : '記録なし';
  function errorText(error) {
    if (!navigator.onLine) return 'オフラインです。接続してから再取得してください。';
    if (error.code === '23505') return '同じ名前のカテゴリが既にあります。再取得して確認してください。';
    if (['23503', '23514', 'P0001'].includes(error.code)) return '入力またはカテゴリの整合性を確認できません。再取得して内容を確認してください。';
    if (['42501', 'PGRST301', 'PGRST302'].includes(error.code)) return 'アクセスできません。ログイン状態とグループ所属を確認してください。';
    return '通信またはアクセス確認に失敗しました。入力は保持しています。再取得して確認してください。';
  }
  class Calendar {
    constructor() {
      this.user = null; this.store = null; this.epoch = 0; this.request = 0;
      this.household = ''; this.homes = []; this.events = []; this.categories = []; this.members = [];
      this.anchor = C.day(new Date()); this.mode = 'month'; this.ready = false; this.writing = false;
      this.channel = null; this.base = null; this.dirty = false; this.latest = null; this.conflicted = false;
      this.bind(); this.render();
      window.addEventListener('beforeunload', event => { if(this.dirty || this.writing){event.preventDefault();event.returnValue='';} });
      this.poll = setInterval(() => { if (this.user && !document.hidden && navigator.onLine && window.FamilySync?.backgroundAllowed !== false) this.schedule(); }, 60000);
      window.addEventListener('online', () => { if(window.FamilySync?.backgroundAllowed !== false) this.schedule(); });
      window.addEventListener('offline', () => { this.ready = false; this.sync('オフライン · 保存できません'); this.controls(); });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) { this.render(); if(window.FamilySync?.backgroundAllowed !== false) this.schedule(); } });
    }
    canLeave() { return !this.writing && (!this.dirty || window.confirm('未保存の予定があります。入力を破棄して続けますか？')); }
    sync(text) { $('sync-status').textContent = text; }
    controls() {
      const disabled = !this.ready || this.writing || !navigator.onLine;
      for (const id of ['new-event', 'open-category', 'save-event', 'delete-event', 'restore-event', 'save-category','event-time-toggle']) $(id).disabled = disabled;
      if (this.conflicted) { $('save-event').disabled = true; $('delete-event').disabled = true; $('restore-event').disabled = true; }
      $('household-select').disabled = this.writing || !this.homes.length;
      $('close-event').disabled = this.writing;
      $('close-category').disabled = this.writing;
      for (const id of ['event-title','event-description','event-all-day','event-start-date','event-end-date','event-category']) $(id).disabled = this.writing || !!this.base?.deleted_at;
      for (const id of ['event-start-time','event-end-time']) $(id).disabled = this.writing || !!this.base?.deleted_at || $('event-all-day').checked;
      $('category-name').disabled = this.writing; $('category-color').disabled = this.writing;
    }
    setSession(client, session) {
      const user = session?.user;
      if (user?.id === this.user?.id) { this.user = user || null; return; }
      this.epoch++; this.request++; clearTimeout(this.timer);
      const old = this.channel; this.channel = null;
      if (old) setTimeout(() => client.removeChannel(old).catch(() => {}), 0);
      this.user = user || null; this.store = client ? new window.FamilyStore.Store(client) : null;
      this.household = ''; this.homes = []; this.events = []; this.categories = []; this.members = [];
      this.ready = false; this.writing = false; this.base = null; this.latest = null; this.conflicted = false;
      this.dirty = false; this.draftId = null;
      for (const id of ['event-dialog','category-dialog']) if ($(id).open) $(id).close();
      $('event-form').reset(); $('category-form').reset(); $('event-search').value = ''; $('show-trash').checked = false;
      $('event-metadata').textContent = ''; $('conflict-latest').textContent = '';
      $('household-select').replaceChildren(); $('category-filter').replaceChildren(new Option('すべて', ''));
      $('event-category').replaceChildren(new Option('未分類', ''));
      message('event-error'); message('category-error'); message('calendar-error'); message('calendar-notice');
      this.sync(user ? '予定を取得しています…' : 'ログインしてください');
      this.controls(); this.render();
      // Authコールバックが完了してから追加通信する。
      if (user) this.schedule(0);
    }
    schedule(delay = 180) {
      clearTimeout(this.timer);
      if (this.user) this.timer = setTimeout(() => this.refresh(), delay);
    }
    clearData() {
      this.events = []; this.categories = []; this.members = []; this.ready = false;
      this.fillCategories(); this.controls(); this.render();
    }
    async refresh() {
      if (!this.user || !this.store) return;
      if (!navigator.onLine) { this.ready = false; this.controls(); return; }
      const epoch = this.epoch, request = ++this.request, user = this.user.id;
      const valid = () => this.epoch === epoch && this.request === request;
      $('calendar').setAttribute('aria-busy', 'true');
      try {
        const homes = await this.store.households(user);
        if (!valid()) return;
        this.homes = homes;
        const previous = this.household;
        if (!this.household && homes.length) this.household = homes[0].id;
        const allowed = homes.some(h => h.id === this.household);
        $('household-select').replaceChildren(...homes.map(h => new Option(h.name, h.id)));
        $('household-select').value = this.household;
        if (!allowed) {
          this.clearData(); this.stopChannel();
          if ($('event-dialog').open) $('event-dialog').close();
          if ($('category-dialog').open) $('category-dialog').close();
          this.sync('共有グループを確認できません');
          message('calendar-error', '所属する共有グループが見つかりません。登録済みの所属情報とログイン状態を確認してください。');
          return;
        }
        if (!this.channel || previous !== this.household) this.subscribe();
        const snapshot = await this.store.snapshot(this.household);
        if (!valid()) return;
        if (!snapshot.members.some(m => m.user_id === user)) throw { code: '42501' };
        this.events = snapshot.events; this.categories = snapshot.categories; this.members = snapshot.members;
        this.ready = true;
        this.fillCategories(); this.render(); this.controls();
        this.sync(this.realtimeConnected ? '● リアルタイム接続中' : '同期を接続中 · 定期取得で補完');
        message('calendar-error');
        message('calendar-notice', `最終取得 ${C.time(new Date())} · ${homes.find(h => h.id === this.household).name} · 日本時間`);
        if (this.base && $('event-dialog').open) {
          const current = this.events.find(e => e.id === this.base.id);
          $('remote-change').hidden = !!current && current.version === this.base.version;
        }
      } catch (error) {
        if (!valid()) return;
        // 古い所属データを表示し続けない。ダイアログの入力は消さない。
        this.clearData(); message('calendar-error', errorText(error)); this.sync('取得に失敗 · 再取得してください');
      } finally {
        if (valid()) { $('calendar').setAttribute('aria-busy', 'false'); this.controls(); }
      }
    }
    stopChannel() {
      const old = this.channel; this.channel = null;
      this.realtimeConnected = false;
      if (old) this.store.client.removeChannel(old).catch(() => {});
    }
    subscribe() {
      this.stopChannel();
      if(window.FamilySync?.mode === 'poll') return;
      const epoch = this.epoch, household = this.household;
      const current = () => this.epoch === epoch && this.household === household;
      const changed = () => { if (current()) { window.FamilySync?.received('events/categories'); this.schedule(); } };
      const channel = this.store.client.channel(`family-calendar-${household}-${epoch}`);
      this.channel = channel;
      for (const table of ['events', 'categories']) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `household_id=eq.${household}` }, changed);
        // DELETEはフィルタできないため、通知内容を表示せず再取得のきっかけだけに使う。
        channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, changed);
      }
      channel.subscribe(status => {
        if (!current() || this.channel !== channel) return;
        if (status === 'SUBSCRIBED') { this.realtimeConnected = true; this.sync(navigator.onLine ? '● リアルタイム接続中' : 'オフライン · 保存できません'); this.schedule(); }
        else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) { this.realtimeConnected = false; this.sync('同期を再接続中 · 定期取得で補完'); }
      });
    }
    fillCategories() {
      const filter = $('category-filter').value, selected = $('event-category').value;
      const options = () => this.categories.map(c => new Option(c.name, c.id));
      $('category-filter').replaceChildren(new Option('すべて', ''), new Option('未分類', '__none'), ...options());
      if (filter === '__none' || this.categories.some(c => c.id === filter)) $('category-filter').value = filter;
      $('event-category').replaceChildren(new Option('未分類', ''), ...options());
      // 編集中に削除されたカテゴリは、勝手に未分類へ書き換えない。
      if (selected && !this.categories.some(c => c.id === selected)) $('event-category').add(new Option('削除済み・取得できないカテゴリ（選び直してください）', selected));
      $('event-category').value = selected;
    }
    filtered() {
      const search = $('event-search').value.trim().normalize('NFKC').toLocaleLowerCase('ja');
      const category = $('category-filter').value, trash = $('show-trash').checked;
      return this.events.filter(e => !!e.deleted_at === trash && (!category || (category === '__none' ? !e.category_id : e.category_id === category))
        && (!search || `${e.title}\n${e.description}`.normalize('NFKC').toLocaleLowerCase('ja').includes(search)))
        .sort((a,b) => Date.parse(a.starts_at)-Date.parse(b.starts_at) || a.id.localeCompare(b.id));
    }
    eventButton(event, key) {
      const button = el('button', undefined, 'event-chip'); button.type = 'button';
      const author = window.FamilyUI.mark(button, event.created_by, this.members, this.user);
      const category = this.categories.find(c => c.id === event.category_id);
      const color = category && /^#[\da-f]{6}$/i.test(category.color) ? category.color : '#64748b';
      const dot = el('span', '●', 'event-dot'); dot.style.color = color; dot.setAttribute('aria-hidden', 'true');
      let clock = event.all_day ? '終日' : C.time(event.starts_at);
      if (key && C.day(event.starts_at) < key) clock = event.all_day ? '終日' : '継続';
      button.append(dot, el('span', `${event.all_day ? '' : clock + ' '}${event.title}`, 'event-chip-text'));
      button.title = `${author.label} · ${event.title} · ${category?.name || '未分類'} · ${stamp(event.starts_at)} 〜 ${stamp(event.ends_at)}`;
      button.addEventListener('click', () => this.openEvent(event));
      return button;
    }
    render() {
      window.FamilyUI.legend($('calendar-owner-legend'), this.members, this.user);
      $('holiday-coverage').textContent = window.FamilyUI.holidayYears.includes(Number(this.anchor.slice(0,4))) ? '祝日：2026–2027年収録' : 'この年の祝日は未収録です';
      const key = this.anchor, {start, count} = C.range(key, this.mode), today = C.day(new Date());
      $('month-label').textContent = this.mode === 'month' ? `${Number(key.slice(0,4))}年 ${Number(key.slice(5,7))}月` : this.mode === 'week' ? `${dateLabel(start)} 〜 ${Number(C.addDays(start,6).slice(5,7))}/${Number(C.addDays(start,6).slice(8))}` : dateLabel(key);
      document.querySelectorAll('[data-calendar-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.calendarMode === this.mode)));
      const grid = $('calendar-grid'), results = $('event-results'), events = this.filtered();
      grid.replaceChildren(); results.replaceChildren();
      const searching = !!$('event-search').value.trim() || $('show-trash').checked;
      grid.hidden = searching; results.hidden = !searching;
      if (searching) {
        results.append(el('h3', `${$('show-trash').checked ? 'ゴミ箱' : '検索結果'} · 全期間 ${events.length}件`));
        if (!events.length) results.append(el('p', this.ready ? '該当する予定はありません。' : 'データを取得してください。', 'muted'));
        for (const event of events) {
          const row = el('div', undefined, 'result-row');
          row.append(el('p', `${C.day(event.starts_at)} 〜 ${C.displayEnd(event)}`, 'muted'), this.eventButton(event));
          results.append(row);
        }
        return;
      }
      grid.className = `calendar-grid mode-${this.mode}`;
      if (this.mode === 'month') for (const [i, name] of ['日','月','火','水','木','金','土'].entries()) grid.append(el('div', name, `weekday ${i === 0 ? 'sunday' : i === 6 ? 'saturday' : ''}`));
      for (let i = 0; i < count; i++) {
        const date = C.addDays(start, i), wd = C.weekday(date), holiday = window.FamilyUI.holiday(date);
        const cell = el('div', undefined, `day${date.slice(0,7) !== key.slice(0,7) && this.mode === 'month' ? ' outside' : ''}${date === today ? ' today' : ''}${holiday ? ' holiday' : ''}${wd === 0 ? ' sunday' : wd === 6 ? ' saturday' : ''}`);
        const head = el('button', undefined, 'day-head'); head.type = 'button'; head.disabled = !this.ready || this.writing;
        const time = el('time', this.mode === 'month' ? Number(date.slice(8)).toString() : `${Number(date.slice(5,7))}/${Number(date.slice(8))}（${['日','月','火','水','木','金','土'][wd]}）`);
        time.dateTime = date; if (holiday) { head.title = holiday; time.title = holiday; } if (date === today) time.setAttribute('aria-current','date');
        head.setAttribute('aria-label', this.mode === 'month' ? `${dateLabel(date)}の予定を見る` : `${dateLabel(date)}に予定を作成`); head.append(time);
        head.addEventListener('click', () => { if (this.mode === 'month') { this.mode = 'day'; this.anchor = date; this.render(); } else this.openEvent(null, date); }); cell.append(head);
        const matches = events.filter(e => C.overlaps(e, date));
        if (this.mode === 'month') {
          if (matches.length) {
            matches.slice(0,3).forEach((event, index) => {
              const label = el('span', event.title, 'month-event-title'); label.setAttribute('data-title-index',String(index));
              const author = window.FamilyUI.mark(label, event.created_by, this.members, this.user);
              label.title = `${author.label}：${event.title}`; head.append(label);
            });
            if (matches.length > 1) head.append(el('span', `＋${matches.length - 1}`, 'month-more more-short'));
            if (matches.length > 3) head.append(el('span', `＋${matches.length - 3}`, 'month-more more-tall'));
          }
          head.setAttribute('aria-label', `${dateLabel(date)}${holiday ? '、'+holiday : ''}、${matches.map(e=>e.title).join('、') || '予定なし'}。日表示を開く`);
          grid.append(cell); continue;
        }
        const maximum = Infinity;
        for (const event of matches.slice(0,maximum)) cell.append(this.eventButton(event, date));
        if (matches.length > maximum) {
          const more = el('button', `ほか${matches.length-maximum}件`, 'more-events'); more.type = 'button';
          more.addEventListener('click', () => { this.mode = 'day'; this.anchor = date; this.render(); }); cell.append(more);
        }
        if (!matches.length && this.mode !== 'month') cell.append(el('p','予定はありません','day-empty'));
        grid.append(cell);
      }
    }
    person(id) {
      if (!id) return '記録なし';
      return id === this.user?.id ? `自分（${id}）` : this.members.some(m => m.user_id === id) ? `共有メンバー（${id}）` : `ユーザー（${id}）`;
    }
    openEvent(event = null, key = this.anchor) {
      if (!this.ready || this.writing) return;
      this.base = event ? { ...event } : null; this.draftId = event?.id || crypto.randomUUID();
      this.latest = null; this.conflicted = false; this.dirty = false;
      $('event-form').reset(); this.fillCategories();
      $('event-dialog-title').textContent = `${Number((event ? C.day(event.starts_at) : key).slice(5,7))}/${Number((event ? C.day(event.starts_at) : key).slice(8))} ${event ? event.deleted_at ? 'ゴミ箱の予定' : '予定の編集' : '予定を作成'}`;
      $('event-title').value = event?.title || '';
      $('event-description').value = event?.description || '';
      $('event-all-day').checked = event ? !!event.all_day : true;
      $('event-schedule').hidden = true; $('event-options').open = false;
      $('event-start-date').value = event ? C.day(event.starts_at) : key;
      $('event-end-date').value = event ? C.displayEnd(event) : key;
      $('event-start-time').value = event ? C.time(event.starts_at) : '09:00';
      $('event-end-time').value = event ? C.time(event.ends_at) : '10:00';
      if (event?.category_id && !this.categories.some(c => c.id === event.category_id)) $('event-category').add(new Option('取得できないカテゴリ（選び直してください）',event.category_id));
      $('event-category').value = event?.category_id || '';
      $('event-metadata').textContent = event ? `作成：${this.person(event.created_by)}\n${stamp(event.created_at)}\n更新：${this.person(event.updated_by)}\n${stamp(event.updated_at)} · version ${event.version}${event.deleted_at ? `\n削除：${stamp(event.deleted_at)}` : ''}` : '保存すると作成者・更新者が記録されます。';
      $('delete-event').hidden = !event || !!event.deleted_at;
      $('restore-event').hidden = !event?.deleted_at;
      $('save-event').hidden = !!event?.deleted_at;
      for (const id of ['event-title','event-description','event-all-day','event-start-date','event-end-date','event-category']) $(id).disabled = !!event?.deleted_at;
      this.toggleAllDay(); message('event-error'); $('conflict-panel').hidden = true; $('remote-change').hidden = true;
      this.controls();
      if (!$('event-dialog').open) $('event-dialog').showModal();
      $('event-title').focus();
    }
    toggleAllDay() {
      const all = $('event-all-day').checked, deleted = !!this.base?.deleted_at;
      for (const id of ['event-start-time','event-end-time']) { $(id).disabled = all || deleted; $(id).required = !all; }
      $('event-time-toggle').textContent = all ? '時刻指定なし' : `${$('event-start-date').value.slice(5).replace('-', '/')} ${$('event-start-time').value} 〜 ${$('event-end-date').value.slice(5).replace('-', '/')} ${$('event-end-time').value}`;
      $('event-time-toggle').setAttribute('aria-expanded', String(!$('event-schedule').hidden));
    }
    closeEvent() {
      if (this.writing || (this.dirty && !window.confirm('入力中の内容を破棄して閉じますか？'))) return;
      $('event-dialog').close(); this.base = null; this.latest = null; this.dirty = false;
    }
    readForm() {
      return C.payload({ title:$('event-title').value, description:$('event-description').value,
        startDate:$('event-start-date').value, endDate:$('event-end-date').value,
        startTime:$('event-start-time').value, endTime:$('event-end-time').value,
        allDay:$('event-all-day').checked, category:$('event-category').value }, this.household);
    }
    async save(action) {
      if (!this.ready || this.writing || this.conflicted || !navigator.onLine) return;
      message('event-error');
      let fields;
      try {
        fields = action === 'save' ? this.readForm() : { deleted_at: action === 'delete' ? new Date().toISOString() : null };
        if (action === 'save' && fields.category_id && !this.categories.some(c => c.id === fields.category_id)) throw new Error('カテゴリを選び直してください。');
      } catch (error) { message('event-error', error.message); return; }
      if (action === 'delete' && !window.confirm('この予定をゴミ箱へ移しますか？ 後で復元できます。')) return;
      this.writing = true; this.controls();
      const epoch = this.epoch, house = this.household, base = this.base, store = this.store;
      try {
        const saved = base ? await store.update(base, fields) : await store.create(this.draftId, fields);
        if (epoch !== this.epoch || house !== this.household) return;
        this.events = this.events.filter(e => e.id !== saved.id).concat(saved);
        this.dirty = false; $('event-dialog').close(); this.base = null;
        message('calendar-notice', action === 'delete' ? 'ゴミ箱へ移しました。ゴミ箱から復元できます。' : action === 'restore' ? '予定を復元しました。' : '予定を保存しました。');
        this.render(); this.schedule();
      } catch (error) {
        if (epoch !== this.epoch || house !== this.household) return;
        if (error instanceof window.FamilyStore.Conflict) {
          this.latest = error.latest; this.conflicted = true;
          $('conflict-panel').hidden = false;
          $('conflict-latest').textContent = error.latest
            ? `最新の内容\n${error.latest.title}\n${stamp(error.latest.starts_at)} 〜 ${stamp(error.latest.ends_at)}${error.latest.all_day ? '（終日）' : ''}\n${error.latest.description}\nカテゴリ：${this.categories.find(c => c.id === error.latest.category_id)?.name || '未分類'}\n${error.latest.deleted_at ? 'ゴミ箱にあります\n' : ''}更新：${this.person(error.latest.updated_by)}\n${stamp(error.latest.updated_at)} · version ${error.latest.version}`
            : '現在この予定を取得できません。削除や権限変更の可能性があります。入力をコピーしてから閉じ、再取得してください。';
          $('load-latest').disabled = !error.latest;
          message('event-error', '更新の競合を検出しました。今回の変更は保存していません。');
        } else {
          message('event-error', `${errorText(error)} 保存結果が不明な場合は、再取得して確認してください。新規予定の再送には同じIDを使います。`);
        }
      } finally {
        if (epoch === this.epoch && house === this.household) { this.writing = false; this.controls(); }
      }
    }
    bind() {
      for (const id of ['event-search','category-filter','show-trash']) $(id).addEventListener(id === 'event-search' ? 'input' : 'change', () => this.render());
      document.querySelectorAll('[data-calendar-mode]').forEach(b => b.addEventListener('click', () => { this.mode = b.dataset.calendarMode; this.render(); }));
      $('previous-month').addEventListener('click', () => { this.anchor = C.move(this.anchor,this.mode,-1); this.render(); });
      $('next-month').addEventListener('click', () => { this.anchor = C.move(this.anchor,this.mode,1); this.render(); });
      $('today').addEventListener('click', () => { this.anchor = C.day(new Date()); this.render(); });
      $('refresh-calendar').addEventListener('click', () => this.schedule(0));
      $('household-select').addEventListener('change', () => {
        this.epoch++; this.request++; this.stopChannel(); this.household = $('household-select').value;
        $('event-search').value = ''; $('show-trash').checked = false;
        $('category-filter').value = ''; this.clearData(); this.sync('予定を取得しています…'); this.schedule(0);
      });
      $('new-event').addEventListener('click', () => this.openEvent());
      $('close-event').addEventListener('click', () => this.closeEvent());
      $('event-dialog').addEventListener('cancel', e => { e.preventDefault(); this.closeEvent(); });
      $('event-form').addEventListener('input', () => { this.dirty = true; });
      $('event-time-toggle').addEventListener('click', () => {
        const opening = $('event-schedule').hidden; $('event-schedule').hidden = !opening;
        if (opening && $('event-all-day').checked && !this.base?.deleted_at) { $('event-all-day').checked = false; this.dirty = true; }
        this.toggleAllDay();
      });
      for (const id of ['event-start-date','event-end-date','event-start-time','event-end-time','event-all-day']) $(id).addEventListener('change', () => this.toggleAllDay());
      $('event-form').addEventListener('submit', e => { e.preventDefault(); this.save('save'); });
      $('delete-event').addEventListener('click', () => this.save('delete'));
      $('restore-event').addEventListener('click', () => this.save('restore'));
      $('load-latest').addEventListener('click', () => { if (this.latest && window.confirm('入力中の内容を破棄し、最新の予定を開きますか？')) this.openEvent(this.latest); });
      $('open-category').addEventListener('click', () => { $('category-form').reset(); message('category-error'); $('category-dialog').showModal(); });
      $('close-category').addEventListener('click', () => { if (!this.writing) $('category-dialog').close(); });
      $('category-dialog').addEventListener('cancel', e => { if (this.writing) e.preventDefault(); });
      $('category-form').addEventListener('submit', async e => {
        e.preventDefault(); if (!this.ready || this.writing || !navigator.onLine) return;
        const name = $('category-name').value.trim(), color = $('category-color').value;
        if (!name || [...name].length > 50 || !/^#[\da-f]{6}$/i.test(color)) { message('category-error', '名前と色を確認してください。'); return; }
        this.writing = true; this.controls(); const epoch = this.epoch;
        try {
          const category = await this.store.category(this.household,name,color);
          if (this.epoch !== epoch) return;
          this.categories.push(category); this.fillCategories(); $('category-dialog').close(); this.schedule();
        } catch (error) { if (this.epoch === epoch) message('category-error', errorText(error)); }
        finally { if (this.epoch === epoch) { this.writing = false; this.controls(); } }
      });
    }
  }
  window.FamilyCalendar = Calendar;
})();
