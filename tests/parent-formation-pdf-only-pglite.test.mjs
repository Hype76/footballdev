import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('Parent RPCs hide raw formations and retain explicitly shared PDFs', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;
      create table parent_player_links(id uuid, auth_user_id uuid, player_id uuid, club_id uuid, team_id uuid, status text);
      create table players(id uuid, club_id uuid, team_id uuid, status text, archived_at timestamptz);
      create table resource_library_links(id uuid, club_id uuid, team_id uuid, resource_id uuid, linked_id uuid, linked_type text, parent_visible boolean, removed_at timestamptz, share_description text, assigned_at timestamptz);
      create table resource_library_items(id uuid, club_id uuid, team_id uuid, title text, category text, mime_type text, archived_at timestamptz);
      create table resource_library_external_links(resource_id uuid, club_id uuid, team_id uuid);
      create table formation_board_publications(resource_id uuid);
      insert into parent_player_links values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','active');
      insert into players values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','active',null);
      insert into resource_library_items values
        ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','PDF','general','application/pdf',null),
        ('00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','Board','general','application/vnd.footballplayer.formation-board+json',null),
        ('00000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','Published','general','text/plain',null);
      insert into formation_board_publications values('00000000-0000-4000-8000-000000000008');
      insert into resource_library_links select id,club_id,team_id,id,'00000000-0000-4000-8000-000000000003','player',true,null,'',now() from resource_library_items;
    `)
    await db.exec(await readFile(new URL('../supabase/migrations/20261112170522_parent_formation_pdf_only.sql', import.meta.url), 'utf8'))
    const id = '00000000-0000-4000-8000-000000000002'
    const matchPlans = await db.query('select * from public.get_parent_portal_match_formation_plans($1)', [id])
    assert.deepEqual(matchPlans.rows, [])
    assert.ok(matchPlans.fields.some(field => field.name === 'shirt_kit'))
    const resources = await db.query('select title from public.get_parent_portal_player_resources($1)', [id])
    assert.deepEqual(resources.rows.map(row => row.title), ['PDF'])
  } finally { await db.close() }
})
