process.chdir(require('node:path').resolve(__dirname,'..'));
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const context = {window:{},Intl,Date,Error}; vm.createContext(context);
for(const name of ['calendar-core','calendar-store']) vm.runInContext(fs.readFileSync(`${name}.js`,'utf8'),context);
const C=context.window.FamilyCore, {Store,Conflict}=context.window.FamilyStore;
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS',name);}
test('JST midnight independent of host timezone',()=>{assert.equal(C.day('2026-10-20T15:00:00Z'),'2026-10-21');assert.equal(C.time('2026-10-20T15:00:00Z'),'00:00');});
test('leap year and year/month navigation',()=>{assert.equal(C.addDays('2028-02-28',1),'2028-02-29');assert.equal(C.addDays('2026-12-31',1),'2027-01-01');assert.equal(C.move('2026-01-31','month',1),'2026-02-01');assert.equal(C.range('2026-10-21','week').start,'2026-10-18');});
const form={title:'  予定  ',description:'説明',startDate:'2026-10-21',endDate:'2026-10-23',startTime:'09:00',endTime:'10:00',allDay:true,category:''};
const all=C.payload(form,'house');
test('all day inclusive input to exclusive DB ending',()=>{assert.equal(all.starts_at,'2026-10-20T15:00:00.000Z');assert.equal(all.ends_at,'2026-10-23T15:00:00.000Z');assert.equal(C.displayEnd(all),'2026-10-23');assert(C.overlaps(all,'2026-10-21'));assert(C.overlaps(all,'2026-10-23'));assert(!C.overlaps(all,'2026-10-24'));});
test('timed overnight ending at midnight excludes next day',()=>{const e={starts_at:C.instant('2026-10-21','23:00'),ends_at:C.instant('2026-10-22')};assert(C.overlaps(e,'2026-10-21'));assert(!C.overlaps(e,'2026-10-22'));});
test('zero-duration events and same-day legacy all day',()=>{const e={starts_at:C.instant('2026-10-21'),ends_at:C.instant('2026-10-21'),all_day:true};assert(C.overlaps(e,'2026-10-21'));assert(!C.overlaps(e,'2026-10-20'));assert.equal(C.displayEnd(e),'2026-10-21');});
test('form constraints and allowed columns',()=>{assert.throws(()=>C.payload({...form,title:' '},'h'));assert.throws(()=>C.payload({...form,title:'a'.repeat(201)},'h'));assert.throws(()=>C.payload({...form,endDate:'2026-10-20'},'h'));assert.throws(()=>C.payload({...form,allDay:false,startDate:'2026-10-21',endDate:'2026-10-21',startTime:'12:00',endTime:'11:00'},'h'));assert.equal(all.title,'予定');assert.equal(all.category_id,null);for(const k of ['created_by','updated_by','version','created_at','updated_at'])assert(!(k in all));});
const db={events:[],categories:[],household_members:[{household_id:'h',user_id:'me'}],households:[{id:'h',name:'Family'},{id:'not-member',name:'Other'}]};
let injectedError=null, queries=[];
class Query{
 constructor(table){this.table=table;this.filters=[];this.operation='select';this.a=0;this.b=Infinity;}
 select(){return this;}order(){return this;}eq(k,v){this.filters.push([k,v]);return this;}
 range(a,b){this.a=a;this.b=b;return this;}maybeSingle(){this.one=true;return this;}single(){this.one=true;return this;}
 insert(row){this.operation='insert';this.row=row;return this;}update(row){this.operation='update';this.row=row;return this;}
 then(resolve,reject){return Promise.resolve().then(()=>{
  queries.push(this);
  if(injectedError){let error=injectedError;injectedError=null;return {error,data:null};}
  let rows=db[this.table], matches=rows.filter(r=>this.filters.every(([k,v])=>r[k]===v));
  if(this.operation==='insert'){
   if(rows.some(r=>r.id===this.row.id))return {data:null,error:{code:'23505'}};
   const row={...this.row,version:1,created_by:'me',updated_by:'me',deleted_at:null};rows.push(row);matches=[row];
  }
  if(this.operation==='update'){for(const row of matches)Object.assign(row,this.row,{version:row.version+1,updated_by:'me'});}
  matches=matches.slice(this.a,this.b+1).map(r=>({...r}));return {data:this.one ? matches[0]||null : matches,error:null};
 }).then(resolve,reject);}
}
const store=new Store({from:t=>new Query(t)});
async function asyncTest(name,fn){await fn();passed++;console.log('PASS',name);}
(async()=>{
 await asyncTest('households require own membership',async()=>{const homes=await store.households('me');assert.equal(homes.length,1);assert.equal(homes[0].id,'h');});
 await asyncTest('CRUD metadata left to DB; optimistic lock is atomic',async()=>{
  const a=await store.create('event-1',C.payload(form,'h'));assert.equal(a.version,1);
  const first={...a}, second={...a};
  const updated=await store.update(first,{title:'相手の変更'});assert.equal(updated.version,2);
  await assert.rejects(store.update(second,{title:'古い変更'}),e=>e instanceof Conflict&&e.latest.title==='相手の変更');
  assert.equal(db.events[0].title,'相手の変更');
  const deleted=await store.update(updated,{deleted_at:'2026-10-21T00:00:00Z'});assert.equal(deleted.version,3);
  const restored=await store.update(deleted,{deleted_at:null});assert.equal(restored.version,4);assert.equal(restored.deleted_at,null);
  for(const q of queries.filter(q=>q.operation==='update'))assert(q.filters.some(([k])=>k==='household_id')&&q.filters.some(([k])=>k==='version')&&q.filters.some(([k])=>k==='id'));
  assert(!queries.some(q=>q.operation==='delete'));
 });
 await asyncTest('stale delete/restore cannot overwrite later updates',async()=>{
  const current=await store.get('h','event-1');await store.update(current,{title:'さらに更新'});
  await assert.rejects(store.update(current,{deleted_at:'now'}),e=>e instanceof Conflict);
  await assert.rejects(store.update(current,{deleted_at:null}),e=>e instanceof Conflict);
 });
 await asyncTest('new event retry uses stable id and reports duplicate',async()=>{await assert.rejects(store.create('event-1',C.payload(form,'h')),e=>e instanceof Conflict&&e.latest.id==='event-1');assert.equal(db.events.length,1);});
 await asyncTest('wrong household returns no data or write',async()=>{assert.equal(await store.get('other','event-1'),null);await assert.rejects(store.update({...db.events[0],household_id:'other'},{title:'wrong'}),e=>e instanceof Conflict&&e.latest===null);});
 await asyncTest('pagination fetches beyond API page size',async()=>{
  for(let i=0;i<1205;i++)db.events.push({id:`extra-${i}`,household_id:'h'});
  const rows=await store.pages('events','id',[['household_id','h']]);assert.equal(rows.length,1206);
 });
 await asyncTest('API failures do not look like successful empty loads',async()=>{injectedError={code:'42501'};await assert.rejects(store.snapshot('h'),e=>e.code==='42501');});
 await asyncTest('category create only sends verified columns',async()=>{await store.category('h','通院','#345678');const q=queries.find(q=>q.table==='categories'&&q.operation==='insert');assert.equal(q.row.type,'event');assert.equal(Object.keys(q.row).sort().join(','),'color,household_id,name,type');});
 console.log(`\n${passed} checks passed. Mock-based: real RLS/Realtime not validated.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
