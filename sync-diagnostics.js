(() => {
  'use strict';
  const value=new URLSearchParams(location.search).get('sync');
  const mode=['realtime','poll'].includes(value)?value:'normal';
  const notifications=[];
  if(mode!=='normal'){
    const notice=document.createElement('p');notice.className='error';notice.setAttribute('role','status');
    notice.textContent=mode==='realtime'?'共有確認モード：通知のみ。定期取得・復帰時の自動取得を停止しています。確認後はURLの ?sync=realtime を外してください。':'共有確認モード：定期取得のみ。Realtime接続を停止しています。確認後はURLの ?sync=poll を外してください。';
    document.getElementById('app-error').after(notice);
  }
  window.FamilySync=Object.freeze({mode,backgroundAllowed:mode!=='realtime',received(scope){notifications.push({at:new Date().toISOString(),scope});if(notifications.length>100)notifications.shift();},snapshot(){return {mode,notifications:notifications.map(x=>({...x}))};}});
})();
