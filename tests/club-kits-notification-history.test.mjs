import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { buildCoachAvailabilityHistoryPayload, buildCoachAvailabilityResponsePayload } from '../netlify/functions/lib/_coach-availability-push.js'
import { kitLabel, normalizeClubKit, readClubKits } from '../src/lib/club-kits.js'

test('kit choices and image precedence retain the saved icon colour', async () => {
  assert.equal(kitLabel('tbc'), 'Kit to be confirmed')
  assert.equal(kitLabel('away'), 'Away kit')
  assert.deepEqual(normalizeClubKit({ colour:'#123456',image_path:'club/home/file.png' }), { colour:'#123456',imagePath:'club/home/file.png' })
  assert.equal(normalizeClubKit({colour:'bad'}).colour, '#1d4ed8')
  assert.deepEqual(await readClubKits(null,''), {})
})
test('signed-in history retains player and response while minimal push reveals neither', () => {
  for(const [status,label] of [['available','Attending'],['unavailable','Not attending'],['maybe','Maybe']]) {
    const options={playerName:'FP TEST Player',contextLabel:'Training 10:09:2026',status,targetId:'event',teamId:'team',detailLevel:'minimal'}
    const push=buildCoachAvailabilityResponsePayload(options), history=buildCoachAvailabilityHistoryPayload(options)
    assert.equal(history.title, 'FP TEST Player · '+label)
    assert.equal(history.body, options.contextLabel)
    assert.equal(history.data.targetId,'event')
    assert.equal(history.data.responseStatus,status)
    assert.ok(!JSON.stringify(push).includes('FP TEST Player'))
  }
})
test('actual kit table and storage policies enforce club-admin writes and scoped reads', async () => {
  const db=new PGlite()
  try {
    await db.exec(`create role authenticated; create role anon; create role service_role bypassrls;
      create schema storage; grant usage on schema storage to authenticated;
      create table public.clubs(id uuid primary key); alter table public.clubs enable row level security;
      create policy scoped_club on public.clubs for select to authenticated using(id::text=current_setting('app.club'));
      grant select on public.clubs to authenticated;
      create function public.current_user_role() returns text language sql as $$select current_setting('app.role')$$;
      create function public.current_user_club_id() returns uuid language sql as $$select current_setting('app.club')::uuid$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id int generated always as identity,bucket_id text,name text); alter table storage.objects enable row level security;
      grant all on storage.objects to authenticated; grant usage on all sequences in schema storage to authenticated;
      create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
      insert into public.clubs values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');`)
    await db.exec(await readFile(new URL('../supabase/migrations/20260910103719_club_kit_artwork.sql',import.meta.url),'utf8'))
    const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002'
    await db.exec(`set role authenticated; set app.club='${a}'; set app.role='admin'; insert into public.club_kits(club_id,kit_type) values('${a}','home'); insert into storage.objects(bucket_id,name) values('club-kits','${a}/home/test.png');`)
    await assert.rejects(db.exec(`insert into public.club_kits(club_id,kit_type) values('${b}','home')`),/row-level security/)
    await assert.rejects(db.exec(`insert into storage.objects(bucket_id,name) values('club-kits','${b}/home/test.png')`),/row-level security/)
    await assert.rejects(db.exec(`update public.club_kits set club_id='${b}'`),/row-level security/)
    await assert.rejects(db.exec(`update public.club_kits set image_path='${b}/home/test.png'`),/check constraint/)
    for(const role of ['coach','manager','parent_portal','team_admin']) {
      await db.exec(`set app.role='${role}'`)
      assert.equal((await db.query('select * from public.club_kits')).rows.length,1)
      await assert.rejects(db.exec(`insert into public.club_kits(club_id,kit_type) values('${a}','away')`),/row-level security/)
      await assert.rejects(db.exec(`insert into storage.objects(bucket_id,name) values('club-kits','${a}/home/forbidden.png')`),/row-level security/)
      assert.equal((await db.query(`update public.club_kits set colour='#ffffff' returning *`)).rows.length,0)
      assert.equal((await db.query('delete from public.club_kits returning *')).rows.length,0)
    }
    await db.exec(`set app.club='${b}'; set app.role='admin'`)
    assert.equal((await db.query('select * from public.club_kits')).rows.length,0)
    await db.exec('reset role; set role anon')
    await assert.rejects(db.query('select * from public.club_kits'),/permission denied/)
  } finally { await db.close() }
})

test('directions offer Waze using the same encoded venue and retain platform choices', async () => {
  const {getDirectionsLocation,getVenueDirectionsOptions}=await import('../src/lib/venue-directions.js')
  const venue='Back Ln, Cambourne CB23 6FY & Pavilion'
  const options=getVenueDirectionsOptions(venue,{apple:false})
  assert.deepEqual(options.map(item=>item.label),['Google Maps','Waze'])
  for(const option of options)assert.equal(getDirectionsLocation(option.url),venue)
  assert.equal(new URL(options[1].url).searchParams.get('navigate'),'yes')
  assert.equal(getVenueDirectionsOptions(venue).length,3)
  assert.deepEqual(getVenueDirectionsOptions('  '),[])
  assert.equal(getDirectionsLocation('https://untrusted.example/?q=wrong'),'')
})
