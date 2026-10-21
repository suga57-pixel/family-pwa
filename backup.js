(() => {
  'use strict';
  const B=window.FamilyBackup, $=id=>document.getElementById(id);
  class Backup {
    constructor(calendar,notes){
      this.calendar=calendar;this.notes=notes;this.epoch=0;this.busy=false;
      $('backup-open').addEventListener('click',()=>this.open());
      $('backup-close').addEventListener('click',()=>{if(!this.busy)$('backup-dialog').close();});
      $('backup-dialog').addEventListener('cancel',e=>{if(this.busy)e.preventDefault();});
      $('backup-home').addEventListener('change',()=>this.reset());
      $('backup-file').addEventListener('change',()=>this.preview());
      $('backup-export').addEventListener('click',()=>this.export());
      $('backup-import').addEventListener('click',()=>this.import());
      $('backup-report').addEventListener('click',()=>{if(this.report)this.download(this.report,'Family-import-report');});
      $('backup-plan').addEventListener('click',()=>{if(this.plan)this.download({format:'FamilyImportPlan',at:new Date().toISOString(),...this.plan},'Family-import-plan');});
      window.addEventListener('beforeunload',e=>{if(this.busy){e.preventDefault();e.returnValue='';}});
    }
    setSession(client,session){
      if(this.user===session?.user?.id)return;
      this.epoch++;this.user=session?.user?.id;this.client=client;this.busy=false;this.file=null;this.report=null;
      $('backup-preview').textContent='';$('backup-status').textContent='';$('backup-file').value='';$('backup-home').replaceChildren();this.reset();
      if($('backup-dialog').open)$('backup-dialog').close();
    }
    canLeave(){return !this.busy;}
    reset(){this.file=null;this.plan=null;$('backup-confirm').checked=false;$('backup-file').value='';$('backup-preview').textContent='';this.controls();}
    controls(){
      for(const id of ['backup-home','backup-file','backup-export','backup-close'])$(id).disabled=this.busy;
      $('backup-import').disabled=this.busy||!this.plan||!!this.plan.conflicts.length;
      $('backup-report').disabled=!this.report;
      $('backup-plan').disabled=this.busy||!this.plan;
      $('backup-confirm').disabled=this.busy;
    }
    status(text){$('backup-status').textContent=text;}
    async open(){
      if(!this.user||this.busy)return;this.reset();this.status('共有グループを確認しています…');$('backup-dialog').showModal();
      const epoch=this.epoch;this.busy=true;this.controls();
      try{const homes=await new window.FamilyStore.Store(this.client).households(this.user);if(epoch!==this.epoch)return;$('backup-home').replaceChildren(...homes.map(h=>new Option(h.name,h.id)));this.status(homes.length?'書き出し、またはJSONファイルを選択してください。':'所属する共有グループがありません。');}
      catch{if(epoch===this.epoch)this.status('所属情報を確認できません。通信とログイン状態を確認してください。');}
      finally{if(epoch===this.epoch){this.busy=false;this.controls();}}
    }
    store(epoch,home){return new B.Store(this.client,()=>this.user&&this.epoch===epoch&&$('backup-home').value===home&&navigator.onLine);}
    async member(home){const homes=await new window.FamilyStore.Store(this.client).households(this.user);if(!homes.some(h=>h.id===home))throw new Error('共有グループの所属を確認できません。');}
    download(data,name){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${name}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
    async export(){
      if(this.busy)return;const home=$('backup-home').value,epoch=this.epoch;this.busy=true;this.controls();this.status('2回取得して整合性を確認しています…');
      try{await this.member(home);const data=await this.store(epoch,home).stable(home);if(epoch!==this.epoch)return;const file=B.encode(data,home);if(new Blob([JSON.stringify(file,null,2)]).size>10*1024*1024)throw new Error('上限を超えています。');this.download(file,'Family-backup');this.status('JSONを作成しました。端末のダウンロード先を確認してください。');}
      catch{if(epoch===this.epoch)this.status('書き出せませんでした。編集を止め、通信・所属情報を確認して再試行してください。');}
      finally{if(epoch===this.epoch){this.busy=false;this.controls();}}
    }
    async preview(){
      if(this.busy)return;const input=$('backup-file').files?.[0],home=$('backup-home').value,epoch=this.epoch;this.file=null;this.plan=null;$('backup-confirm').checked=false;
      if(!input){this.controls();return;}this.busy=true;this.controls();this.status('検証しています…');
      try{
        if(input.size>10*1024*1024)throw new Error('ファイルは10MB以下にしてください。');
        const file=B.validate(JSON.parse(await input.text()));await this.member(home);const store=this.store(epoch,home),snapshot=await store.stable(home),plan=await B.plan(file,snapshot,home);store.assert();
        if(epoch!==this.epoch)return;this.file=file;this.plan=plan;
        const labels={categories:'カテゴリ',events:'予定',notes:'メモ・リスト',checklist_items:'チェック項目'};
        $('backup-preview').textContent=`方式：新規追加のみ（既存行の上書き・削除なし）\n元グループ：${file.sourceHousehold}\n追加先：${home}\n`+B.tables.map(t=>`${labels[t]}：追加 ${plan.counts[t]}件 / ファイル ${file.data[t].length}件`).join('\n')+`\n一致・再利用：${plan.skipped.length}件\nゴミ箱の予定・メモも状態を復元します。作成者・日時・versionは今回の追加時に再記録されます。\n`+(plan.conflicts.length?`停止理由：\n${plan.conflicts.join('\n')}`:'差異なし。追加後に内容と参照を再確認します。');
        this.status(plan.conflicts.length?'差異があります。追加は実行できません。':'プレビューを確認してください。実行前のバックアップを別途保管してください。');
      }catch(error){if(epoch===this.epoch)this.status(error instanceof SyntaxError?'JSONを読み取れません。':error.message||'検証に失敗しました。');}
      finally{if(epoch===this.epoch){this.busy=false;this.controls();}}
    }
    async import(){
      if(this.busy||!this.plan||this.plan.conflicts.length)return;
      if(!$('backup-confirm').checked){this.status('確認欄にチェックしてください。');return;}
      if(this.notes.hasUnsaved()||this.calendar.dirty||this.notes.writing||this.calendar.writing){this.status('編集中の内容を保存して閉じてから実行してください。');return;}
      if(!window.confirm('選択した共有グループへ追加します。途中停止すると一部が追加された状態になります。ふたりとも編集を止め、バックアップを保管しましたか？'))return;
      const home=this.plan.household,epoch=this.epoch,preview=this.plan;this.busy=true;this.controls();this.status('追加前の再検証中です…');
      const report={format:'FamilyImportReport',startedAt:new Date().toISOString(),household:home,planned:preview.rows.map(x=>({table:x.table,id:x.row.id,sourceId:x.sourceId})),operations:[],status:'開始前'};this.report=report;
      try{
        await this.member(home);const store=this.store(epoch,home),now=await B.plan(this.file,await store.stable(home),home);store.assert();
        if(JSON.stringify(now)!==JSON.stringify(preview))throw new Error('プレビュー後にデータが変わりました。ファイルを選び直してください。');
        await store.execute(now,report);if(epoch!==this.epoch)return;this.status(report.status+'。実行記録を保存してください。');
      }catch(error){report.error='追加・確認に失敗。操作記録のIDを再取得して確認してください。';if(epoch===this.epoch)this.status((report.status==='開始前'?error.message:'途中停止しました。自動取り消しや自動再送は行いません。実行記録を保存し、追加済み・結果不明のIDを確認してください。'));}
      finally{if(epoch===this.epoch){this.busy=false;this.plan=null;this.controls();this.calendar.schedule(0);this.notes.schedule(0);}}
    }
  }
  window.FamilyBackupUI=Backup;
})();
