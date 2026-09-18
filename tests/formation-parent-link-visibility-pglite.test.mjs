import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('shared formations follow owned Parent links without requiring a staff role', async () => {
  const db = new PGlite()
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table users(id uuid, status text);
      create table players(id uuid, club_id uuid, status text);
      create table parent_player_links(id uuid, auth_user_id uuid, player_id uuid, club_id uuid, team_id uuid, status text);
      create table formation_board_versions(id uuid, game_format text, formation_preset_key text, pitch_orientation text, placements jsonb, bench jsonb);
      create table formation_board_match_publications(id uuid, match_day_id uuid, board_id uuid, board_version_id uuid, club_id uuid, team_id uuid, publication_number integer, board_title_snapshot text, published_at timestamptz, withdrawn_at timestamptz);
      create table visible_matches(id uuid);
      create function current_user_has_active_authority() returns boolean language sql stable as $$ select exists(select 1 from public.users where id=auth.uid() and status='active') $$;
      create function get_parent_portal_match_days(uuid) returns table(id uuid) language sql stable as $$ select id from public.visible_matches $$;
      insert into players values('${id(3)}','${id(4)}','active');
      insert into parent_player_links values('${id(2)}','${id(1)}','${id(3)}','${id(4)}','${id(5)}','active');
      insert into visible_matches values('${id(6)}');
      insert into formation_board_versions values('${id(7)}','11v11','11v11-4-4-2','portrait','[]','[]');
      insert into formation_board_match_publications values('${id(8)}','${id(6)}','${id(9)}','${id(7)}','${id(4)}','${id(5)}',1,'Starting lineup',now(),null);
    `)
    const authority = await readFile(new URL('../supabase/migrations/20260727044834_restore_parent_link_authority.sql', import.meta.url), 'utf8')
    const start = authority.indexOf('create or replace function public.current_user_can_access_parent_link(')
    const end = authority.indexOf('create or replace function public.current_user_can_access_parent_club(', start)
    await db.exec(authority.slice(start, end))
    await db.exec(await readFile(new URL('../supabase/migrations/20260918155018_formation_parent_link_visibility.sql', import.meta.url), 'utf8'))
    const plans = async (actor = id(1)) => {
      await db.exec('reset role')
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor])
      await db.exec('set role authenticated')
      const result = await db.query('select * from public.get_parent_portal_match_formation_plans($1)', [id(2)])
      await db.exec('reset role')
      return result.rows
    }
    assert.equal((await plans()).length, 1, 'Parent-only account sees the shared lineup')
    assert.equal((await plans(id(10))).length, 0, 'Another account cannot borrow the link')
    await db.exec(`insert into users values('${id(1)}','active')`)
    assert.equal((await plans()).length, 1, 'Staff account with its own Parent link also sees it')
    await db.exec("update users set status='inactive'")
    assert.equal((await plans()).length, 0, 'Inactive staff profile stays denied')
    await db.exec("delete from users; update parent_player_links set status='revoked'")
    assert.equal((await plans()).length, 0, 'Revoked Parent link stays denied')
    await db.exec("update parent_player_links set status='active'; update players set status='archived'")
    assert.equal((await plans()).length, 0, 'Archived player stays denied')
    await db.exec(`update players set status='active'; update formation_board_match_publications set team_id='${id(11)}'`)
    assert.equal((await plans()).length, 0, 'Other team stays denied')
    await db.exec(`update formation_board_match_publications set team_id='${id(5)}'; delete from visible_matches`)
    assert.equal((await plans()).length, 0, 'Hidden match stays denied')
    await db.exec(`insert into visible_matches values('${id(6)}'); insert into formation_board_match_publications select '${id(12)}',match_day_id,board_id,board_version_id,club_id,team_id,2,board_title_snapshot,now(),now() from formation_board_match_publications`)
    assert.equal((await plans()).length, 0, 'Withdrawal never resurfaces an older publication')
    await db.exec('set role anon')
    await assert.rejects(db.query('select * from public.get_parent_portal_match_formation_plans($1)', [id(2)]), /permission denied/)
  } finally { await db.close() }
})
