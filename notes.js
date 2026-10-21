(() => {
  'use strict';
  const $ = id => document.getElementById(id), S = window.FamilyNotesStore;
  const panels = ['notes','checklists'];
  const el = (tag,text,cls) => { const e=document.createElement(tag); if(text !== undefined)e.textContent=text; if(cls)e.className=cls; return e; };
  const message = (id,text='') => { $(id).textContent=text; $(id).hidden=!text; };
  const stamp = value => value ? new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : '—';
  const errorText = e => e?.code === '42501' ? 'アクセス権を確認できません。再取得してください。' : e?.code === '23505' ? '同じ名前のカテゴリがあるか、作成済みです。再取得してください。' : e?.code === '23503' ? '関連データが変更されています。再取得してください。' : '保存・取得に失敗しました。接続と共有権限を確認してください。入力は画面内に保持しています。';
  const normalized = value => value.normalize('NFKC').toLocaleLowerCase('ja');
  class Notes {
    constructor() {
      this.user=null; this.store=null; this.epoch=0; this.request=0; this.household=''; this.homes=[];
      this.notes=[]; this.items=[]; this.categories=[]; this.ready=false; this.writing=false;
      this.base=null; this.dirty=false; this.revision=0; this.conflicted=false; this.paused=false;
      this.itemBase=null; this.itemDirty=false; this.itemConflicted=false; this.channel=null;
      this.bind(); this.render(); this.controls();
      setInterval(()=>{if(this.user&&!document.hidden&&navigator.onLine)this.schedule();},60000);
      window.addEventListener('online',()=>this.schedule(0));
      window.addEventListener('offline',()=>{this.ready=false;clearTimeout(this.autoTimer);this.sync('オフライン · 保存できません');this.controls();});
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.schedule(0);});
      window.addEventListener('beforeunload',event=>{if(this.hasUnsaved()){event.preventDefault();event.returnValue='';}});
    }
    hasUnsaved() { return this.writing || this.dirty || this.itemDirty || !!$('item-add-content').value.trim(); }
    canLeave() { return !this.hasUnsaved() || (!this.writing && window.confirm('未保存の入力があります。入力を破棄して続けますか？')); }
    sync(text) { panels.forEach(p=>$(p+'-sync').textContent=text); }
    notices(text) { panels.forEach(p=>$(p+'-notice').textContent=text); }
    person(id) { return id ? `${id===this.user?.id?'自分':'共有メンバー'} (${id})` : '記録なし'; }
    metadata(note) { return `${note.note_type==='checklist'?'リスト本体の情報\n':''}作成：${this.person(note.created_by)} · ${stamp(note.created_at)}\n更新：${this.person(note.updated_by)} · ${stamp(note.updated_at)} · version ${note.version}`; }
    setSession(client,session) {
      const user=session?.user || null;
      if(user?.id===this.user?.id){this.user=user;return;}
      this.epoch++;this.request++;clearTimeout(this.timer);clearTimeout(this.autoTimer);this.stopChannel();
      this.user=user;this.store=client?new S.Store(client):null;this.household='';this.homes=[];
      this.notes=[];this.items=[];this.categories=[];this.ready=false;this.writing=false;
      this.clearEditor();
      panels.forEach(p=>{ $(p+'-search').value='';$(p+'-trash').checked=false;$(p+'-home').replaceChildren();message(p+'-error'); });
      for(const id of ['note-dialog','item-dialog','note-category-dialog'])if($(id).open)$(id).close();
      $('note-category-name').value='';message('note-category-error');this.notices('');this.fillCategories();this.render();this.controls();
      this.sync(user?'データを取得しています…':'ログインしてください');
      // Authコールバック内でSupabase通信をしない。
      if(user)this.schedule(0);
    }
    clearEditor() {
      this.base=null;this.draftId=null;this.dirty=false;this.revision=0;this.conflicted=false;this.paused=false;this.latest=null;this.composing=false;
      this.itemBase=null;this.itemDirty=false;this.itemConflicted=false;this.itemLatest=null;this.addId=null;
      for(const id of ['note-title','note-content','item-content','item-add-content'])$(id).value='';
      $('note-pinned').checked=false;
      for(const id of ['note-metadata','item-metadata','note-latest','item-latest','item-notice','note-status'])$(id).textContent='';
      for(const id of ['note-error','item-error'])message(id);
      $('note-conflict').hidden=true;$('item-conflict').hidden=true;$('note-remote').hidden=true;$('checklist-rows').replaceChildren();
    }
    schedule(delay=180) { clearTimeout(this.timer);if(this.user)this.timer=setTimeout(()=>this.refresh(),delay); }
    stopChannel() {
      const old=this.channel;this.channel=null;this.connected=false;
      if(old&&this.store)this.store.client.removeChannel(old).catch(()=>{});
    }
    subscribe() {
      this.stopChannel();const epoch=this.epoch,house=this.household;
      const valid=()=>this.epoch===epoch&&this.household===house;
      const changed=()=>{if(valid())this.schedule();};
      const channel=this.store.client.channel(`family-notes-${house}-${epoch}`);this.channel=channel;
      for(const table of ['notes','checklist_items','categories']){
        channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`household_id=eq.${house}`},changed);
        // DELETE通知は行内容を使わず、RLS付き再取得の契機にだけ使う。
        channel.on('postgres_changes',{event:'DELETE',schema:'public',table},changed);
      }
      channel.subscribe(status=>{
        if(!valid()||this.channel!==channel)return;
        if(status==='SUBSCRIBED'){this.connected=true;this.sync('● リアルタイム接続中');this.schedule();}
        else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){this.connected=false;this.sync('同期を再接続中 · 定期取得で補完');}
      });
    }
    async refresh() {
      if(!this.user||!this.store||!navigator.onLine)return;
      // 書き込みの前に始まった取得結果で、保存後のversionを巻き戻さない。
      if(this.writing){this.schedule(300);return;}
      const epoch=this.epoch,request=++this.request,valid=()=>epoch===this.epoch&&request===this.request;
      try{
        const homes=await this.store.households(this.user.id);if(!valid())return;
        this.homes=homes;if(!this.household&&homes.length)this.household=homes[0].id;
        panels.forEach(p=>{$(p+'-home').replaceChildren(...homes.map(h=>new Option(h.name,h.id)));$(p+'-home').value=this.household;});
        if(!homes.some(h=>h.id===this.household))throw {code:'42501'};
        if(!this.channel)this.subscribe();
        const data=await this.store.snapshot(this.household);if(!valid())return;
        if(!data.members.some(m=>m.user_id===this.user.id))throw {code:'42501'};
        this.notes=data.notes;this.items=data.items;this.categories=data.categories;this.ready=true;
        panels.forEach(p=>message(p+'-error'));
        this.sync(this.connected?'● リアルタイム接続中':'同期を接続中 · 定期取得で補完');
        this.notices(`最終取得 ${stamp(new Date())} · ${homes.find(h=>h.id===this.household).name}`);
        this.fillCategories();this.reconcileEditor();this.render();this.controls();
        if(this.dirty&&!this.paused&&!this.conflicted)this.queueSave();
      }catch(error){
        if(!valid())return;
        this.notes=[];this.items=[];this.categories=[];this.ready=false;this.stopChannel();clearTimeout(this.autoTimer);
        panels.forEach(p=>message(p+'-error',errorText(error)));this.sync('取得に失敗 · 再取得してください');
        // 編集中の入力は保持するが、保存は再確認が済むまで無効にする。
        this.fillCategories();this.render();this.renderItems();this.controls();
      }
    }
    fillCategories() {
      for(const id of ['notes-filter','checklists-filter','note-category']){
        const value=$(id).value,editor=id==='note-category';
        $(id).replaceChildren(new Option(editor?'未分類':'すべて',''),...(!editor?[new Option('未分類','__none')]:[]),...this.categories.map(c=>new Option(c.name,c.id)));
        if(value&&!this.categories.some(c=>c.id===value)&&value!=='__none')$(id).add(new Option('取得できないカテゴリ',value));
        $(id).value=value;
      }
    }
    filtered(panel) {
      const type=panel==='notes'?'text':'checklist',search=normalized($(panel+'-search').value.trim()),cat=$(panel+'-filter').value,trash=$(panel+'-trash').checked;
      return this.notes.filter(n=>n.note_type===type&&!!n.deleted_at===trash&&(!cat||(cat==='__none'?!n.category_id:n.category_id===cat))&&(!search||normalized(`${n.title}\n${n.content}\n${type==='checklist'?this.items.filter(i=>i.note_id===n.id).map(i=>i.content).join('\n'):''}`).includes(search)))
        .sort((a,b)=>Number(b.is_pinned)-Number(a.is_pinned)||Date.parse(b.updated_at)-Date.parse(a.updated_at)||a.id.localeCompare(b.id));
    }
    render() {
      for(const p of panels){
        const cards=$(p+'-cards');cards.replaceChildren();
        const rows=this.filtered(p);
        if(!rows.length){cards.append(el('p',this.ready?($(p+'-trash').checked?'ゴミ箱は空です。':'該当するデータはありません。＋ボタンから作成できます。'):'共有データを取得すると、ここに表示します。','notes-empty'));continue;}
        for(const n of rows){
          const card=el('button',undefined,'note-card');card.type='button';
          const cat=this.categories.find(c=>c.id===n.category_id);
          const dot=el('span','●','note-category-dot');dot.setAttribute('aria-hidden','true');
          dot.style.color=cat&&/^#[\da-f]{6}$/i.test(cat.color)?cat.color:'#64748b';card.append(dot);
          card.append(el('span',`${n.is_pinned?'● ピン留め · ':''}${cat?.name||'未分類'}`,'note-card-category'));
          card.append(el('strong',n.title.trim()||'無題の'+(n.note_type==='text'?'メモ':'リスト'),'note-card-title'));
          card.append(el('span',n.content.slice(0,180)||'本文なし','note-card-content'));
          if(n.note_type==='checklist'){
            const items=this.items.filter(i=>i.note_id===n.id);card.append(el('span',`${items.filter(i=>i.is_checked).length} / ${items.length} 完了`,'note-card-progress'));
          }
          card.append(el('span',`更新 ${stamp(n.updated_at)} · ${this.person(n.updated_by)}`,'note-card-meta'));
          card.addEventListener('click',()=>this.open(n));cards.append(card);
        }
      }
    }
    controls() {
      const blocked=!this.ready||!navigator.onLine||this.writing;
      for(const p of panels){$(p+'-new').disabled=blocked;$(p+'-category').disabled=blocked;$(p+'-home').disabled=this.writing||!this.homes.length;}
      const readOnly=!!this.base?.deleted_at;
      for(const id of ['note-title','note-content','note-category','note-pinned'])$(id).disabled=readOnly||(this.writing&&this.action!=='save');
      $('note-save').disabled=blocked||readOnly||this.conflicted;
      $('note-delete').disabled=blocked||!this.base||this.conflicted;
      $('note-delete').hidden=!this.base||readOnly;
      $('note-restore').disabled=blocked||this.conflicted;$('note-restore').hidden=!readOnly;
      $('note-close').disabled=this.writing;
      $('item-add').disabled=blocked||readOnly||!this.base||this.conflicted;
      $('item-add-content').disabled=readOnly||!this.base||this.writing;
      $('item-content').disabled=this.writing;
      $('item-save').disabled=blocked||readOnly||this.itemConflicted;
      $('item-close').disabled=this.writing;
      $('note-category-save').disabled=blocked;$('note-category-close').disabled=this.writing;
      $('note-category-name').disabled=this.writing;$('note-category-color').disabled=this.writing;
    }
    open(note=null,type='text') {
      if(!this.ready||this.writing)return;
      clearTimeout(this.autoTimer);this.clearEditor();
      this.base=note?{...note}:null;this.draftId=note?.id||crypto.randomUUID();this.noteType=note?.note_type||type;
      $('note-heading').textContent=this.noteType==='text'?'メモ':'チェックリスト';
      this.fillEditor();if(!$('note-dialog').open)$('note-dialog').showModal();$('note-title').focus();this.controls();
    }
    fillEditor() {
      const n=this.base;
      $('note-title').value=n?.title||'';$('note-content').value=n?.content||'';$('note-category').value=n?.category_id||'';$('note-pinned').checked=!!n?.is_pinned;
      $('note-metadata').textContent=n?this.metadata(n):'作成者・更新者は保存後に表示します。';
      $('note-status').textContent=n?(n.deleted_at?'ゴミ箱 · 読み取り専用':'保存済み'):'新規 · 入力すると自動保存します';
      $('note-checklist').hidden=this.noteType!=='checklist';
      this.renderItems();
    }
    reconcileEditor() {
      if(!$('note-dialog').open||!this.base)return;
      const current=this.notes.find(n=>n.id===this.base.id);
      if(!current){this.noteConflict(null);return;}
      if(current.version!==this.base.version){
        if(this.dirty||this.conflicted){$('note-remote').hidden=false;}
        else{this.base={...current};this.fillEditor();}
      }
      this.renderItems();
      if(this.itemBase&&$('item-dialog').open){
        const item=this.items.find(i=>i.id===this.itemBase.id);
        if(!item||item.version!==this.itemBase.version){
          if(this.itemDirty||!item)this.itemConflict(item||null);
          else{this.itemBase={...item};$('item-content').value=item.content;$('item-metadata').textContent=`更新 ${stamp(item.updated_at)} · version ${item.version}`;}
        }
      }
    }
    edited() {
      this.dirty=true;this.revision++;$('note-status').textContent=this.conflicted?'競合 · 入力は保持しています':this.paused?'未保存 · 「保存する」で再試行してください':'未保存 · 自動保存を待っています…';
      this.queueSave();
    }
    queueSave() {
      clearTimeout(this.autoTimer);
      if(this.dirty&&!this.paused&&!this.conflicted&&!this.composing&&this.ready&&navigator.onLine)this.autoTimer=setTimeout(()=>this.saveNote(),900);
    }
    noteFields() { return {title:$('note-title').value,content:$('note-content').value,category_id:$('note-category').value||null,is_pinned:$('note-pinned').checked}; }
    acceptRow(table,row) {
      if(table==='notes')this.notes=this.notes.filter(n=>n.id!==row.id).concat(row);
      else this.items=S.orderItems(this.items.filter(i=>i.id!==row.id).concat(row));
    }
    async saveNote(action='save') {
      if(!this.ready||!navigator.onLine||this.writing||this.conflicted||this.composing||!$('note-dialog').open)return;
      if(this.base?.deleted_at&&action!=='restore')return;
      clearTimeout(this.autoTimer);
      if(action==='save'&&this.base&&!this.dirty){$('note-status').textContent='保存済み';return;}
      const fields=action==='delete'?{deleted_at:new Date().toISOString()}:action==='restore'?{deleted_at:null}:this.noteFields();
      if(action==='save'&&fields.category_id&&!this.categories.some(c=>c.id===fields.category_id)){message('note-error','カテゴリを選び直してください。');this.paused=true;return;}
      const epoch=this.epoch,house=this.household,revision=this.revision,base=this.base&&{...this.base},store=this.store;
      const valid=()=>epoch===this.epoch&&house===this.household;
      this.writing=true;this.action=action;this.request++;this.controls();this.renderItems();$('note-status').textContent='保存しています…';message('note-error');
      try{
        const row=base?await store.updateRow('notes',base,fields):await store.insertRow('notes',this.draftId,{household_id:house,note_type:this.noteType,...fields});
        if(!valid())return;
        this.acceptRow('notes',row);this.base={...row};this.paused=false;
        // 通信中に入力された内容を保存済みと扱わない。
        if(revision===this.revision)this.dirty=false;
        $('note-metadata').textContent=this.metadata(row);$('note-status').textContent=this.dirty?'未保存の続きがあります…':'保存済み · '+stamp(row.updated_at);$('note-remote').hidden=true;
        if(action!=='save'){this.dirty=false;$('note-dialog').close();this.clearEditor();this.notices(action==='delete'?'ゴミ箱へ移しました。リストの項目も保持しています。':'復元しました。');}
        this.render();this.schedule();
      }catch(error){
        if(!valid())return;
        this.paused=true;$('note-status').textContent='未保存 · 自動保存を停止しました';
        if(error instanceof S.Conflict)this.noteConflict(error.latest);
        else message('note-error',errorText(error)+' 結果が不明なときは再取得し、確認後に「保存する」で再試行してください。');
      }finally{if(valid()){this.writing=false;this.controls();this.renderItems();if(this.dirty&&!this.paused)this.queueSave();}}
    }
    noteConflict(latest) {
      clearTimeout(this.autoTimer);this.conflicted=true;this.paused=true;this.latest=latest;
      $('note-conflict').hidden=false;$('note-load-latest').disabled=!latest;
      $('note-latest').textContent=latest?`最新の内容\n${latest.title}\n${latest.content}\n${latest.deleted_at?'ゴミ箱にあります\n':''}カテゴリ：${this.categories.find(c=>c.id===latest.category_id)?.name||'未分類'} · ピン：${latest.is_pinned?'あり':'なし'}\n${this.metadata(latest)}`:'現在取得できません。削除や権限変更の可能性があります。';
      message('note-error','保存を止めました。入力内容は保持しています。最新の内容と比較してください。');this.controls();
    }
    close() {
      if(this.writing)return;
      if(this.hasUnsaved()&&!window.confirm('未保存の入力を破棄して閉じますか？'))return;
      clearTimeout(this.autoTimer);$('note-dialog').close();this.clearEditor();
    }
    renderItems() {
      const rows=$('checklist-rows');rows.replaceChildren();
      if(this.noteType!=='checklist')return;
      const items=S.orderItems(this.items.filter(i=>i.note_id===this.base?.id));
      $('item-count').textContent=`${items.filter(i=>i.is_checked).length} / ${items.length}`;
      const blocked=!this.ready||this.writing||!!this.base?.deleted_at||!navigator.onLine||this.conflicted;
      items.forEach((item,index)=>{
        const row=el('div',undefined,'checklist-row'),label=el('label',undefined,'checklist-check'),check=el('input');check.type='checkbox';check.checked=item.is_checked;check.disabled=blocked;check.setAttribute('aria-label',`${item.content} を完了${item.is_checked?'解除':'にする'}`);
        check.addEventListener('change',()=>this.itemAction(item,'check',{is_checked:!item.is_checked}));label.append(check);
        const content=el('button',item.content||'（空の項目）','item-content-button'+(item.is_checked?' checked':''));content.type='button';content.disabled=blocked;content.addEventListener('click',()=>this.openItem(item));
        const buttons=el('div',undefined,'item-buttons');
        for(const [text,action,disabled] of [['↑','up',index===0],['↓','down',index===items.length-1],['削除','delete',false]]){
          const b=el('button',text,'quiet'+(action==='delete'?' danger':''));b.type='button';b.disabled=blocked||disabled;b.setAttribute('aria-label',`${item.content} ${action==='up'?'を上へ':action==='down'?'を下へ':'を削除'}`);b.addEventListener('click',()=>this.itemAction(item,action));buttons.append(b);
        }
        row.append(label,content,buttons,el('span',`更新 ${stamp(item.updated_at)} · v${item.version}`,'item-stamp'));rows.append(row);
      });
      if(!this.base)rows.append(el('p','最初にタイトルまたは本文を入力してリストを保存してください。','field-hint'));
    }
    openItem(item) {
      if(this.writing||!this.ready)return;
      this.itemBase={...item};this.itemDirty=false;this.itemConflicted=false;this.itemLatest=null;
      $('item-content').value=item.content;$('item-metadata').textContent=`更新 ${stamp(item.updated_at)} · version ${item.version}\n項目単位の作成者・更新者はDBに記録されていません。`;
      message('item-error');$('item-conflict').hidden=true;if(!$('item-dialog').open)$('item-dialog').showModal();$('item-content').focus();this.controls();
    }
    itemConflict(latest) {
      this.itemConflicted=true;this.itemLatest=latest;$('item-conflict').hidden=false;
      $('item-latest').textContent=latest?`最新：${latest.content}\n${latest.is_checked?'完了':'未完了'} · 更新 ${stamp(latest.updated_at)} · version ${latest.version}`:'現在この項目を取得できません。';
      $('item-load-latest').disabled=!latest;message('item-error','保存していません。共有先で変更された可能性があります。');this.controls();
    }
    async itemAction(base,action,fields) {
      if(!this.ready||this.writing||!navigator.onLine||!this.base||this.base.deleted_at||this.conflicted)return;
      if(action==='delete'&&!window.confirm('この項目を削除します。元に戻せません。削除しますか？'))return;
      if(action==='edit'&&(!$('item-content').value.trim()||this.itemConflicted))return;
      if(action==='add'&&!$('item-add-content').value.trim())return;
      const epoch=this.epoch,house=this.household,store=this.store,parent={...this.base},valid=()=>epoch===this.epoch&&house===this.household;
      this.writing=true;this.action='item';this.request++;this.controls();this.renderItems();message('item-notice');message('item-error');
      let completed=0;
      try{
        // 削除済みリストの項目は操作しない。DBの親検証トリガーも併用する。
        const current=await store.getRow('notes',house,parent.id);if(!valid())return;
        if(!current||current.deleted_at||current.note_type!=='checklist')throw new S.Conflict(current);
        if(action==='add'){
          const content=$('item-add-content').value;
          this.addId=this.addId||crypto.randomUUID();
          const siblings=this.items.filter(i=>i.note_id===parent.id),max=siblings.reduce((rank,item)=>Math.max(rank,item.sort_order),0);
          const rank=max<=2147482623?max+1024:max;
          const row=await store.insertRow('checklist_items',this.addId,{household_id:house,note_id:parent.id,content,is_checked:false,sort_order:rank});if(!valid())return;
          this.acceptRow('checklist_items',row);$('item-add-content').value='';this.addId=null;
        }else if(action==='delete'){
          await store.deleteItem(base);if(!valid())return;this.items=this.items.filter(i=>i.id!==base.id);
        }else if(action==='up'||action==='down'){
          const plan=S.movePlan(this.items.filter(i=>i.note_id===parent.id),base.id,action==='up'?-1:1);
          for(const step of plan){
            if(!valid())return;
            const row=await store.updateRow('checklist_items',step.base,{sort_order:step.sort_order});if(!valid())return;
            completed++;this.acceptRow('checklist_items',row);
          }
        }else{
          const row=await store.updateRow('checklist_items',base,action==='edit'?{content:$('item-content').value}:fields);if(!valid())return;
          this.acceptRow('checklist_items',row);
          if(action==='edit'){this.itemDirty=false;$('item-dialog').close();this.itemBase=null;}
        }
        if(!valid())return;
        message('item-notice','項目を保存しました。');this.render();this.schedule();
      }catch(error){
        if(!valid())return;
        if(action==='add'&&error instanceof S.Conflict&&error.latest?.id===this.addId&&error.latest.note_id===parent.id){
          this.acceptRow('checklist_items',error.latest);this.addId=null;
          if(error.latest.content===$('item-add-content').value)$('item-add-content').value='';
          message('item-notice','前回の項目は作成済みでした。重複登録を止めました。残っている入力は確認後に追加してください。');this.render();
        }
        else if(action==='edit'&&error instanceof S.Conflict)this.itemConflict(error.latest&&'note_id' in error.latest?error.latest:null);
        else message('item-notice',error instanceof S.Conflict?'競合のため操作を止めました。再取得して最新の状態を確認してください。'+(completed?' 並び順の一部は保存済みです。':''):errorText(error));
        this.schedule(0);
      }finally{if(valid()){this.writing=false;this.controls();this.renderItems();this.queueSave();}}
    }
    async addCategory() {
      if(!this.ready||this.writing||!navigator.onLine)return;
      const name=$('note-category-name').value.trim(),color=$('note-category-color').value;
      if(!name||[...name].length>50||!/^#[\da-f]{6}$/i.test(color)){message('note-category-error','名前と色を確認してください。');return;}
      const epoch=this.epoch;this.writing=true;this.action='category';this.request++;this.controls();
      try{
        const row=await this.store.category(this.household,name,color);if(epoch!==this.epoch)return;
        this.categories.push(row);this.fillCategories();$('note-category-dialog').close();this.schedule();
      }catch(error){if(epoch===this.epoch)message('note-category-error',errorText(error));}
      finally{if(epoch===this.epoch){this.writing=false;this.controls();this.queueSave();}}
    }
    bind() {
      for(const p of panels){
        for(const key of ['search','filter','trash'])$(p+'-'+key).addEventListener(key==='search'?'input':'change',()=>this.render());
        $(p+'-refresh').addEventListener('click',()=>this.schedule(0));
        $(p+'-new').addEventListener('click',()=>this.open(null,p==='notes'?'text':'checklist'));
        $(p+'-home').addEventListener('change',()=>{
          if(!this.canLeave()){ $(p+'-home').value=this.household;return; }
          this.epoch++;this.request++;clearTimeout(this.autoTimer);this.stopChannel();this.household=$(p+'-home').value;
          this.notes=[];this.items=[];this.categories=[];this.ready=false;this.clearEditor();
          panels.forEach(panel=>{$(panel+'-home').value=this.household;$(panel+'-filter').value='';$(panel+'-search').value='';$(panel+'-trash').checked=false;});
          this.render();this.controls();this.schedule(0);
        });
        $(p+'-category').addEventListener('click',()=>{$('note-category-name').value='';$('note-category-color').value='#276858';message('note-category-error');$('note-category-dialog').showModal();});
      }
      for(const id of ['note-title','note-content','note-category','note-pinned'])$(id).addEventListener(id==='note-category'||id==='note-pinned'?'change':'input',()=>this.edited());
      for(const id of ['note-title','note-content']){
        $(id).addEventListener('compositionstart',()=>{this.composing=true;clearTimeout(this.autoTimer);});
        $(id).addEventListener('compositionend',()=>{this.composing=false;this.edited();});
      }
      $('note-form').addEventListener('submit',e=>{e.preventDefault();this.paused=false;this.saveNote();});
      $('note-close').addEventListener('click',()=>this.close());$('note-dialog').addEventListener('cancel',e=>{e.preventDefault();this.close();});
      $('note-delete').addEventListener('click',()=>{if(!this.writing&&window.confirm('ゴミ箱へ移しますか？未保存の変更は破棄されます。'))this.saveNote('delete');});
      $('note-restore').addEventListener('click',()=>this.saveNote('restore'));
      $('note-load-latest').addEventListener('click',()=>{if(this.latest&&window.confirm('入力を破棄し、最新の内容を開きますか？'))this.open(this.latest);});
      $('item-add-form').addEventListener('submit',e=>{e.preventDefault();this.itemAction(null,'add');});
      $('item-add-content').addEventListener('input',()=>{/* 再送時は同じIDを保持する */});
      $('item-content').addEventListener('input',()=>{this.itemDirty=true;});
      $('item-form').addEventListener('submit',e=>{e.preventDefault();if(this.itemBase)this.itemAction(this.itemBase,'edit');});
      const closeItem=()=>{if(this.writing)return;if(this.itemDirty&&!window.confirm('未保存の項目を破棄しますか？'))return;$('item-dialog').close();this.itemBase=null;this.itemDirty=false;$('item-content').value='';};
      $('item-close').addEventListener('click',closeItem);$('item-dialog').addEventListener('cancel',e=>{e.preventDefault();closeItem();});
      $('item-load-latest').addEventListener('click',()=>{if(this.itemLatest&&window.confirm('入力を破棄して最新の項目を開きますか？'))this.openItem(this.itemLatest);});
      $('note-category-form').addEventListener('submit',e=>{e.preventDefault();this.addCategory();});
      $('note-category-close').addEventListener('click',()=>{if(!this.writing)$('note-category-dialog').close();});
      $('note-category-dialog').addEventListener('cancel',e=>{if(this.writing)e.preventDefault();});
    }
  }
  window.FamilyNotes=Notes;
})();
