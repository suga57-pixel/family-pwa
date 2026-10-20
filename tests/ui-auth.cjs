process.chdir(require('node:path').resolve(__dirname,'..'));
// 画面処理の代替DOMテスト。ブラウザ描画・Safariの代替にはならない。
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const html=fs.readFileSync('index.html','utf8');
class Element {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.events={};this.attrs={};this.dataset={};this.style={};this._value='';this._text='';this.hidden=false;this.disabled=false;this.checked=false;this.open=false;this.type='';}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
 set value(v){this._value=String(v);}get value(){return this._value;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this._text='';this.children=[...nodes];}
 add(node){this.children.push(node);}
 setAttribute(k,v){this.attrs[k]=String(v);}removeAttribute(k){delete this.attrs[k];}
 addEventListener(k,fn){(this.events[k]??=[]).push(fn);}
 async emit(k){for(const fn of this.events[k]||[])await fn({preventDefault(){},target:this});}
 showModal(){this.open=true;}close(){this.open=false;}focus(){}
 reset(){for(const e of Object.values(elements))if(e.tagName==='input'||e.tagName==='textarea'||e.tagName==='select'){e._value=e.initial||'';e.checked=false;}}
}
const elements={},views=[],modes=[];
for(const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)){
 const tag=match[1],attrs=Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
 const e=new Element(tag);e.attrs=attrs;e.id=attrs.id;e.type=attrs.type||'';e.initial=attrs.value||'';e._value=e.initial;e.hidden=/\bhidden\b/.test(match[2]);
 if(attrs.id)elements[attrs.id]=e;
 if(attrs['data-view']){e.dataset.view=attrs['data-view'];views.push(e);}
 if(attrs['data-calendar-mode']){e.dataset.calendarMode=attrs['data-calendar-mode'];modes.push(e);}
}
function Option(text,value){const e=new Element('option');e.textContent=text;e.value=value;return e;}
let timers=[],callbacks={},confirmValue=true;
const document={getElementById:id=>{assert(elements[id],`missing DOM id ${id}`);return elements[id];},createElement:t=>new Element(t),querySelectorAll:s=>s==='[data-view]'?views:s==='[data-calendar-mode]'?modes:[],querySelector:()=>views[0],documentElement:{dataset:{}},hidden:false,addEventListener:(e,f)=>callbacks['doc:'+e]=f};
const window={addEventListener:(e,f)=>callbacks[e]=f,confirm:()=>confirmValue};
const context={window,document,Option,Intl,Date,Error,URL,atob,crypto,navigator:{onLine:true},location:{protocol:'file:',hostname:''},localStorage:{getItem:()=>null,setItem(){}},setTimeout:f=>{timers.push(f);return timers.length;},clearTimeout(){},setInterval:()=>1,console};
vm.createContext(context);
for(const name of ['calendar-core','calendar-store','calendar'])vm.runInContext(fs.readFileSync(`${name}.js`,'utf8'),context);
const C=window.FamilyCore,Calendar=window.FamilyCalendar;
const cal=new Calendar(),home='h', user={id:'me',email:'me@example.invalid'};
let events=[{id:'e',household_id:home,title:'もとの予定',description:'テスト詳細',starts_at:C.instant('2026-10-21','09:00'),ends_at:C.instant('2026-10-21','10:00'),all_day:false,category_id:null,version:1,created_by:'me',updated_by:'partner',created_at:C.instant('2026-10-21'),updated_at:C.instant('2026-10-21'),deleted_at:null}];
let status,changed,fail=false,homes=[{id:home,name:'Family'}],writeResolver;
const client={removeChannel:async()=>{},channel:()=>{const channel={on:(_k,_f,fn)=>{changed=fn;return channel;},subscribe:fn=>{status=fn;return channel;}};return channel;}};
function store(){return {client,households:async()=>homes,snapshot:async()=>{if(fail)throw {code:'42501'};return {events:events.map(e=>({...e})),categories:[{id:'cat',name:'用事',color:'#276858',sort_order:0}],members:[{user_id:'me'},{user_id:'partner'}]};},update:async(base,fields)=>{const row=events.find(e=>e.id===base.id);if(!row||base.version!==row.version)throw new window.FamilyStore.Conflict(row);Object.assign(row,fields,{version:row.version+1});return {...row};},create:async(id,fields)=>new Promise(resolve=>{writeResolver=()=>resolve({id,...fields,version:1});}),category:async()=>({id:'new-cat',name:'new',color:'#123456',sort_order:0})};}
let n=0;async function test(name,fn){await fn();console.log('PASS',name);n++;}
(async()=>{
cal.setSession(client,{user});cal.store=store();await cal.refresh();
await test('initial household load and 42-day month',()=>{assert(cal.ready);assert.equal(cal.household,home);assert.equal(elements['calendar-grid'].children.length,49);assert(!elements['new-event'].disabled);});
await test('week/day navigation and dates',async()=>{cal.anchor='2026-10-21';cal.mode='week';cal.render();assert.equal(elements['calendar-grid'].children.length,7);await elements['next-month'].emit('click');assert.equal(cal.anchor,'2026-10-28');cal.mode='day';cal.render();assert.equal(elements['calendar-grid'].children.length,1);});
await test('search crosses visible period and text is not HTML',()=>{cal.anchor='2027-01-01';elements['event-search'].value='テスト詳細';cal.render();assert(elements['event-results'].textContent.includes('もとの予定'));assert(elements['calendar-grid'].hidden);events[0].title='<img src=x onerror=alert(1)>';cal.events=events.map(e=>({...e}));elements['event-search'].value='img';cal.render();assert(elements['event-results'].textContent.includes('<img'));events[0].title='もとの予定';});
await test('category and trash filters',()=>{elements['event-search'].value='';elements['category-filter'].value='cat';assert.equal(cal.filtered().length,0);elements['category-filter'].value='__none';assert.equal(cal.filtered().length,1);elements['show-trash'].checked=true;assert.equal(cal.filtered().length,0);elements['show-trash'].checked=false;elements['category-filter'].value='';});
await test('editor shows audit ids, draft preserved by refresh',async()=>{cal.openEvent(events[0]);assert(elements['event-dialog'].open);assert(elements['event-metadata'].textContent.includes('partner'));elements['event-title'].value='入力中';cal.dirty=true;events[0].version++;events[0].title='相手の変更';await cal.refresh();assert.equal(elements['event-title'].value,'入力中');assert(!elements['remote-change'].hidden);});
await test('stale editor blocks overwrite and keeps draft',async()=>{await cal.save('save');assert(cal.conflicted);assert(!elements['conflict-panel'].hidden);assert.equal(elements['event-title'].value,'入力中');assert.equal(events[0].title,'相手の変更');assert(elements['save-event'].disabled);});
await test('reload latest then delete and restore',async()=>{await elements['load-latest'].emit('click');assert.equal(elements['event-title'].value,'相手の変更');await cal.save('delete');assert(events[0].deleted_at);assert(!elements['event-dialog'].open);cal.openEvent(events[0]);assert(!elements['restore-event'].hidden);assert(elements['event-title'].disabled);await cal.save('restore');assert.equal(events[0].deleted_at,null);});
await test('all-day disables time and retains date',()=>{cal.openEvent(null,'2026-10-21');elements['event-title'].value='終日';elements['event-all-day'].checked=true;cal.toggleAllDay();assert(elements['event-start-time'].disabled);assert.equal(cal.readForm().all_day,true);});
await test('cancel prompt retains dirty draft when declined',()=>{cal.dirty=true;confirmValue=false;cal.closeEvent();assert(elements['event-dialog'].open);confirmValue=true;cal.closeEvent();assert(!elements['event-dialog'].open);});
await test('offline disables writes and online schedules refetch',()=>{context.navigator.onLine=false;callbacks.offline();assert(elements['new-event'].disabled);const before=timers.length;context.navigator.onLine=true;callbacks.online();assert(timers.length>before);});
await cal.refresh();
await test('Realtime subscription and reconnect trigger a fresh read',()=>{const before=timers.length;status('CHANNEL_ERROR');assert(elements['sync-status'].textContent.includes('再接続'));status('SUBSCRIBED');changed();assert(timers.length>=before+2);});
await test('permission failure clears visible cached rows and blocks save',async()=>{fail=true;await cal.refresh();assert(!cal.ready);assert.equal(cal.events.length,0);assert(elements['new-event'].disabled);assert(!elements['calendar-error'].hidden);fail=false;await cal.refresh();});
await test('logout during read discards late response',async()=>{let release;cal.store.households=()=>new Promise(r=>release=r);const pending=cal.refresh();cal.setSession(client,null);release([{id:home,name:'Family'}]);await pending;assert(!cal.ready);assert.equal(cal.events.length,0);assert.equal(elements['event-title'].value,'');assert.equal(elements['event-results'].textContent,'');});
cal.setSession(client,{user});cal.store=store();await cal.refresh();
await test('logout during save does not restore data into UI',async()=>{cal.openEvent(null,'2026-10-21');elements['event-title'].value='新規';const pending=cal.save('save');assert(cal.writing);assert(elements['event-title'].disabled);cal.setSession(client,null);writeResolver();await pending;assert.equal(cal.events.length,0);assert(!elements['event-dialog'].open);});
cal.setSession(client,{user});cal.store=store();await cal.refresh();
await test('membership loss clears household data',async()=>{homes=[];await cal.refresh();assert(!cal.ready);assert.equal(cal.events.length,0);assert.equal(cal.categories.length,0);assert.equal(cal.channel,null);homes=[{id:home,name:'Family'}];});
await test('late read from old household cannot replace current data',async()=>{cal.household='';await cal.refresh();let release;cal.store.snapshot=()=>new Promise(r=>release=r);const pending=cal.refresh();await new Promise(setImmediate);cal.epoch++;cal.household='different';cal.clearData();release({events, categories:[],members:[{user_id:'me'}]});await pending;assert.equal(cal.events.length,0);assert.equal(cal.household,'different');});
// 第1段階の認証を、変更後のapp.jsを実行して確認。
await test('auth config rejects secret keys',async()=>{window.FamilyCalendar=class{setSession(){}};window.FAMILY_CONFIG={supabaseUrl:'https://example.supabase.co',supabaseKey:'sb_secret_forbidden'};window.supabase={createClient:()=>{throw new Error('must not create client');}};vm.runInContext(fs.readFileSync('app.js','utf8'),context);assert(elements.submit.disabled);assert(elements['login-error'].textContent.includes('未設定'));});
await test('login session restore, sign out, login errors and password clearing',async()=>{
 for(const e of Object.values(elements))e.events={};for(const e of views)e.events={};
 let authFn,signOutScope,signedIn=false;
 window.FAMILY_CONFIG={supabaseUrl:'https://example.supabase.co',supabaseKey:'sb_publishable_test'};
 window.supabase={createClient:(_url,_key,opts)=>{assert(opts.auth.persistSession&&opts.auth.autoRefreshToken);assert.equal(opts.auth.storageKey,'family-auth-example.supabase.co');return {auth:{onAuthStateChange:fn=>authFn=fn,getSession:async()=>({data:{session:{user}},error:null}),signOut:async opts=>{signOutScope=opts.scope;authFn('SIGNED_OUT',null);return {error:null};},signInWithPassword:async()=>signedIn?{data:{session:{user}},error:null}:{error:{status:400}}}};}};
 vm.runInContext(fs.readFileSync('app.js','utf8'),context);await new Promise(setImmediate);
 assert(!elements.app.hidden);assert.equal(elements['account-email'].textContent,user.email);
 await elements.logout.emit('click');assert.equal(signOutScope,'local');assert(elements.app.hidden);assert(!elements.login.hidden);assert.equal(elements['account-email'].textContent,'');
 elements.password.value='bad';await elements['login-form'].emit('submit');assert(!elements['login-error'].hidden);assert.equal(elements.password.value,'');
 signedIn=true;elements.password.value='good';await elements['login-form'].emit('submit');assert(!elements.app.hidden);assert.equal(elements.password.value,'');
});
console.log(`\n${n} DOM/auth checks passed. No browser rendering or real backend involved.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
