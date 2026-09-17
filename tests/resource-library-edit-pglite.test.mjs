import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const club = '20000000-0000-4000-8000-000000000001'
const team = '30000000-0000-4000-8000-000000000001'
const actor = '10000000-0000-4000-8000-000000000001'
const fileId = '50000000-0000-4000-8000-000000000001'
const linkId = '50000000-0000-4000-8000-000000000002'
const original = '2026-09-17T10:00:00Z'

test('Resource edits are atomic, scoped, stale-safe and preserve assignments under authenticated RLS', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
      create function public.current_user_can_manage_resource_library(c uuid, t uuid) returns boolean language sql as $$
        select auth.uid() is not null and current_setting('test.manager',true) = 'yes' and c = '${club}' and t = '${team}' $$;
      create function public.current_user_can_view_resource_library(c uuid, t uuid) returns boolean language sql as $$
        select auth.uid() is not null and c = '${club}' and t = '${team}' $$;
      create table clubs(id uuid primary key); create table teams(id uuid primary key); create table users(id uuid primary key);
      insert into clubs values ('${club}'); insert into teams values ('${team}'); insert into users values ('${actor}');
    `)
    const base = await readFile(new URL('../supabase/migrations/20260702073335_resource_library_v1.sql', import.meta.url), 'utf8')
    await db.exec(base.slice(base.indexOf('create table if not exists public.resource_library_items'), base.indexOf('create index if not exists resource_library_items_club_updated_idx')))
    const external = await readFile(new URL('../supabase/migrations/20260708081841_resource_library_squad_sharing_description.sql', import.meta.url), 'utf8')
    await db.exec(external.slice(external.indexOf('create table if not exists public.resource_library_external_links'), external.indexOf('create or replace function public.create_external_resource_library_item')))
    await db.exec(`
      alter table resource_library_items enable row level security;
      grant usage on schema auth to authenticated;
      grant select, update on resource_library_items to authenticated;
      create policy external_read on resource_library_external_links for select to authenticated using (current_user_can_view_resource_library(club_id,team_id));
      create table formation_board_publications(resource_id uuid);
      grant select on formation_board_publications to authenticated;
      create table resource_library_links(id int, resource_id uuid, parent_visible boolean, linked_type text, linked_id text);
      insert into resource_library_links values (1,'${fileId}',true,'player','player-1'), (2,'${linkId}',false,'team','${team}');
      insert into resource_library_items(id,club_id,team_id,title,storage_path,original_filename,mime_type,file_size_bytes,uploaded_by_profile_id,updated_at)
      values ('${fileId}','${club}','${team}','Original file','${club}/${team}/${fileId}/old.pdf','old.pdf','application/pdf',32,'${actor}','${original}'),
        ('${linkId}','${club}','${team}','Original link','${club}/${team}/external-links/${linkId}','https://example.test/old','text/plain',1,'${actor}','${original}');
      insert into resource_library_external_links(resource_id,club_id,team_id,external_url) values ('${linkId}','${club}','${team}','https://example.test/old');
    `)
    await db.exec(base.slice(base.indexOf('create policy resource_library_items_select_staff'), base.indexOf('drop policy if exists resource_library_links_select_staff')))
    await db.exec(await readFile(new URL('../supabase/migrations/20260917141756_resource_library_edit.sql', import.meta.url), 'utf8'))
    const before = (await db.query('select * from resource_library_links order by id')).rows
    await db.exec(`set role authenticated; select set_config('test.actor','${actor}',false); select set_config('test.manager','yes',false);`)
    const edit = (id, stamp, title, url = null, replacement = null, teamId = team) => db.query(
      'select * from public.update_resource_library_item($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id,club,teamId,stamp,title,'Updated description','training',url,replacement],
    )
    const savedFile = (await edit(fileId,original,'Renamed file')).rows[0]
    assert.equal(savedFile.id,fileId)
    assert.equal(savedFile.original_filename,'old.pdf')
    assert.equal(savedFile.category,'training')
    await assert.rejects(edit(fileId,original,'Stale edit'), /has changed/)
    const savedLink = (await edit(linkId,original,'Renamed link','https://example.test/new')).rows[0]
    assert.equal(savedLink.original_filename,'https://example.test/new')
    await assert.rejects(edit(linkId,savedLink.updated_at,'','https://example.test/rollback'), /title_check/)
    assert.equal((await db.query('select external_url from resource_library_external_links where resource_id=$1',[linkId])).rows[0].external_url,'https://example.test/new')
    await assert.rejects(edit(linkId,savedLink.updated_at,'Unsafe','javascript:alert(1)'), /valid http/)
    await assert.rejects(edit(fileId,savedFile.updated_at,'Other resource file',null,{storage_path:`${club}/${team}/${linkId}/new.pdf`}), /belong to this resource/)
    const replacement = {storage_path:`${club}/${team}/${fileId}/new.pdf`,original_filename:'new.pdf',mime_type:'application/pdf',file_size_bytes:64}
    const replaced = (await edit(fileId,savedFile.updated_at,'Replaced file',null,replacement)).rows[0]
    assert.equal(replaced.storage_path,replacement.storage_path)
    await assert.rejects(edit(fileId,replaced.updated_at,'Wrong team',null,null,'30000000-0000-4000-8000-000000000002'), /manager access/)
    await db.exec("select set_config('test.manager','no',false)")
    await assert.rejects(edit(fileId,replaced.updated_at,'Viewer edit'), /manager access/)
    await db.exec("select set_config('test.manager','yes',false); select set_config('test.actor','',false)")
    await assert.rejects(edit(fileId,replaced.updated_at,'Signed out'), /manager access/)
    await db.exec(`reset role; insert into formation_board_publications values ('${fileId}'); set role authenticated; select set_config('test.actor','${actor}',false)`)
    await assert.rejects(edit(fileId,replaced.updated_at,'Formation overwrite'), /Formation Boards/)
    await db.exec('reset role')
    assert.deepEqual((await db.query('select * from resource_library_links order by id')).rows,before)
    const boundary = (await db.query(`select p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') as anon from pg_proc p where p.proname='update_resource_library_item'`)).rows[0]
    assert.deepEqual(boundary,{prosecdef:false,anon:false})
  } finally { await db.close() }
})
