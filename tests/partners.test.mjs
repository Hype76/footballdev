import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { findPartnerSpace, partnerRect, safePartnerUrl, validatePartnerLayout, visiblePartnerItems, csvCell } from '../src/lib/partners.js'
import { isPublicPartnerAddress } from '../netlify/functions/lib/_partner-image.js'

const id=(n)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const item={ id:id(100),x:0,y:0,w:2,h:2,title:'FP TEST partner',alt:'Partner image description',imageUrl:'https://example.com/partner.png',url:'https://example.com/tours',hidden:false,sponsored:true,startsAt:'',endsAt:'' }
test('grid selection, packing, collisions, scheduling and safe links',()=>{
  assert.deepEqual(partnerRect([1,10]),{x:1,y:0,w:2,h:3})
  assert.deepEqual(findPartnerSpace([item]),{x:2,y:0,w:2,h:2})
  assert.throws(()=>validatePartnerLayout({items:[item,{...item,id:id(101)}]}),/overlap/)
  assert.throws(()=>validatePartnerLayout({items:[{...item,w:5}]}),/inside/)
  assert.throws(()=>validatePartnerLayout({items:[{...item,alt:''}]}),/description/)
  assert.equal(visiblePartnerItems([{...item,endsAt:'2020-01-01'}, {...item,hidden:true}]).length,0)
  for(const url of ['javascript:alert(1)','http://example.com','https://localhost/a','https://127.0.0.1','https://user:pass@example.com']) assert.equal(safePartnerUrl(url),'')
  for(const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.0.1','169.254.169.254','100.64.0.1','::1'])assert.equal(isPublicPartnerAddress(address),false)
  assert.equal(isPublicPartnerAddress('93.184.216.34'),true)
  assert.equal(csvCell('=HYPERLINK("bad")'),'"\'=HYPERLINK(""bad"")"')
})

test('partner database authority, publishing, consent, analytics and retention',async(t)=>{
  const db=new PGlite()
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema app_private;create schema storage;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table public.clubs(id uuid primary key,name text);
  create table public.users(id uuid primary key,name text,email text,role text,role_rank int,status text,club_id uuid);
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  insert into public.users values('${id(1)}','Admin','admin@example.com','super_admin',100,'active',null),('${id(2)}','Parent','parent@example.com','parent_portal',0,'active',null),('${id(3)}','Coach','coach@example.com','coach',20,'active',null),('${id(4)}','Suspended','s@example.com','super_admin',100,'suspended',null),('${id(5)}','FP TEST account','fptest@example.com','parent_portal',0,'active',null);
  grant usage on schema public,auth to anon,authenticated,service_role;`)
  await db.exec(await readFile(new URL('../supabase/migrations/20260915055401_partner_layouts_analytics.sql',import.meta.url),'utf8'))
  await db.query('insert into partner_assets(url) values($1)',[item.imageUrl])
  async function as(n,role='authenticated') {await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);await db.exec(`set role ${role}`)}
  async function admin(action='load',payload={},app='parent'){return (await db.query('select partner_admin($1,$2,$3) as result',[app,action,JSON.stringify(payload)])).rows[0].result}
  async function feed(app='parent'){return(await db.query('select partner_feed($1) as result',[app])).rows[0].result}
  async function event(kind='click',eventId=id(200),app='parent'){return(await db.query('select partner_interaction($1,$2,$3,$4,$5) as result',[app,item.id,kind,'ios',eventId])).rows[0].result}
  await t.test('anonymous and non-admin cannot access management or raw tables',async()=>{await as(null,'anon');await assert.rejects(()=>admin(),/permission denied/);await as(2);await assert.rejects(()=>admin(),/Platform admin/);for(const table of ['partner_layouts','partner_events','partner_preferences','partner_reports','partner_assets'])await assert.rejects(()=>db.query(`select * from ${table}`),/permission denied/);await assert.rejects(()=>feed('coach'),/audience/);await as(4);await assert.rejects(()=>admin(),/denied/)})
  await t.test('drafts are private, publication atomic and stale revision rejected',async()=>{await as(1);let r=await admin('save',{revision:0,layout:{items:[item]}});assert.equal(r.revision,1);await as(2);assert.equal((await feed()).items.length,0);await as(1);await assert.rejects(()=>admin('publish',{revision:0,layout:{items:[item]}}),/changed/);r=await admin('publish',{revision:1,layout:{items:[item]}});assert.equal(r.published.items.length,1);assert.equal((await feed('coach')).items.length,0)})
  await t.test('unregistered images, unsafe links and overlapping cells rejected',async()=>{await as(1);for(const items of [[{...item,imageUrl:'https://evil.example/image.png'}],[{...item,url:'javascript:alert(1)'}],[item,{...item,id:id(101)}]])await assert.rejects(()=>admin('save',{revision:2,layout:{items}}))})
  await t.test('unlinked clicks have no account identity and retries are deduplicated',async()=>{await as(2);assert.equal((await feed()).linkedAnalytics,null);assert.equal(await event(),true);await event();await as(1);const stats=(await db.query("select partner_stats('parent',now()-interval '1 day',now()+interval '1 hour',true) as r")).rows[0].r;assert.equal(stats.summary.clicks,1);assert.equal(stats.summary.accounts,0);assert.equal(stats.activity.length,0)})
  await t.test('consent links only the actor; withdrawal removes existing account links',async()=>{await as(2);await db.query("select partner_preference('parent',true)");await event('click',id(201));await as(1);let stats=(await db.query("select partner_stats('parent',now()-interval '1 day',now()+interval '1 hour',true) as r")).rows[0].r;assert.equal(stats.summary.accounts,1);assert.equal(stats.activity[0].account_id,id(2));await as(2);await db.query("select partner_preference('parent',false)");await as(1);stats=(await db.query("select partner_stats('parent',now()-interval '1 day',now()+interval '1 hour',true) as r")).rows[0].r;assert.equal(stats.summary.clicks,2);assert.equal(stats.summary.accounts,0)})
  await t.test('admin and FP TEST clicks excluded; user cannot forge cross-app events',async()=>{await as(1);assert.equal(await event('click',id(202)),false);await as(5);assert.equal(await event('click',id(203)),false);await as(2);await assert.rejects(()=>event('click',id(204),'coach'),/audience/)})
  await t.test('reporting is available and admin can resolve reports',async()=>{await as(2);await db.query("select partner_interaction('parent',$1,'report','ios',$2,'Incorrect offer')",[item.id,id(300)]);await assert.rejects(()=>db.query('select * from partner_reports'),/permission denied/);await as(1);assert.equal((await admin()).reports.length,1);assert.equal((await admin('resolve',{reportId:id(300)})).reports.length,0)})
  await t.test('hide is immediate and restore creates a draft without changing live layout',async()=>{await as(1);const r=await admin('hide',{revision:2,itemId:item.id});assert.equal((await feed()).items.length,0);await admin('restore',{revision:r.revision,versionId:r.versions[0].id});assert.equal((await feed()).items.length,0);assert.equal((await admin()).draft.items[0].hidden,false)})
  await t.test('future and expired offers never reach consumers',async()=>{await as(1);let r=await admin();await admin('publish',{revision:r.revision,layout:{items:[{...item,startsAt:'2099-01-01T00:00:00Z'}]}});assert.equal((await feed()).items.length,0);assert.equal(await event('click',id(400)),false)})
  await t.test('retention is service-only and deletes expired events',async()=>{await as(1);await assert.rejects(()=>db.query('select cleanup_partner_data()'),/permission denied/);await db.exec('reset role');await db.exec("update partner_events set created_at=now()-interval '91 days'");await as(null,'service_role');await db.query('select cleanup_partner_data()');assert.equal((await db.query('select count(*)::int as n from partner_events')).rows[0].n,0)})
  await db.close()
})
