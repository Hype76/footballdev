import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20260802214626_team_removal_event_scope_26c.sql', import.meta.url), 'utf8')

const IDS = {
  club: '10000000-0000-4000-8000-000000000001',
  otherClub: '10000000-0000-4000-8000-000000000002',
  team: '20000000-0000-4000-8000-000000000001',
  otherTeam: '20000000-0000-4000-8000-000000000002',
  foreignTeam: '20000000-0000-4000-8000-000000000003',
  admin: '30000000-0000-4000-8000-000000000001',
  manager: '30000000-0000-4000-8000-000000000002',
  coach: '30000000-0000-4000-8000-000000000003',
  parent: '30000000-0000-4000-8000-000000000004',
  outsider: '30000000-0000-4000-8000-000000000005',
  player: '40000000-0000-4000-8000-000000000001',
  otherPlayer: '40000000-0000-4000-8000-000000000002',
  standalone: '50000000-0000-4000-8000-000000000001',
  recurring: '50000000-0000-4000-8000-000000000002',
  otherEvent: '50000000-0000-4000-8000-000000000003',
  pastEvent: '50000000-0000-4000-8000-000000000004',
  match: '60000000-0000-4000-8000-000000000001',
  completedMatch: '60000000-0000-4000-8000-000000000002',
  matchRequest: '70000000-0000-4000-8000-000000000001',
  trainingRequest: '70000000-0000-4000-8000-000000000002',
  recipient: '80000000-0000-4000-8000-000000000001',
  parentLink: '80000000-0000-4000-8000-000000000002',
  queueMatch: '90000000-0000-4000-8000-000000000001',
  queueTraining: '90000000-0000-4000-8000-000000000002',
}

async function setActor(db, actorId) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [actorId])
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params)
  return Object.values(result.rows[0])[0]
}

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create role service_role;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create table public.clubs (id uuid primary key);
    create table public.teams (id uuid primary key, club_id uuid not null, name text not null);
    create table public.users (id uuid primary key, club_id uuid, email text, name text, display_name text, role text, role_rank integer, status text);
    create table public.team_staff (team_id uuid, user_id uuid);
    create table public.players (
      id uuid primary key, club_id uuid not null, player_name text not null, section text default 'Squad', team text default '',
      parent_name text, parent_email text, notes text, created_at timestamptz default now(), updated_at timestamptz default now(),
      status text default 'active', promoted_at timestamptz, promoted_by uuid, positions text[] default '{}', parent_contacts jsonb default '[]',
      created_by uuid, created_by_name text, created_by_email text, updated_by uuid, updated_by_name text, updated_by_email text,
      archived_reason text, archived_at timestamptz, archived_by uuid, archived_previous_status text, contact_type text default 'parent',
      archived_delete_at timestamptz, team_id uuid, shirt_number text, transfer_reference text, first_name text, last_name text,
      preferred_name text, date_of_birth date, gender text
    );
    create table public.parent_player_links (id uuid primary key, club_id uuid, team_id uuid, player_id uuid, auth_user_id uuid, email text, status text);
    create table public.adult_player_account_links (id uuid primary key default gen_random_uuid(), club_id uuid, team_id uuid, player_id uuid, user_id uuid, status text, revoked_at timestamptz);
    create table public.calendar_events (id uuid primary key, club_id uuid, team_id uuid, title text, event_type text, starts_at timestamptz, ends_at timestamptz, recurrence_frequency text, recurrence_until date, cancelled_at timestamptz);
    create table public.match_days (id uuid primary key, club_id uuid, team_id uuid, opponent text, match_date date, kickoff_time time, kickoff_time_tbc boolean, status text, deleted_at timestamptz);
    create table public.calendar_event_invites (id uuid primary key default gen_random_uuid(), club_id uuid, team_id uuid, calendar_event_id uuid, match_day_id uuid, player_id uuid, invite_status text, notify_requested boolean, cancelled_at timestamptz, updated_at timestamptz);
    create table public.match_day_player_squad_decisions (id uuid primary key default gen_random_uuid(), match_day_id uuid, club_id uuid, team_id uuid, player_id uuid, status text);
    create table public.match_day_availability_requests (
      id uuid primary key, match_day_id uuid, club_id uuid, team_id uuid, player_id uuid, parent_link_id uuid,
      recipient_email text, recipient_type text, token_hash text, token_revoked_at timestamptz, token_revoked_reason text,
      status text default 'queued', expires_at timestamptz default '2099-12-31', token_revoked_by uuid, token_revoked_source text, updated_at timestamptz
    );
    create type public.email_delivery_state_v1 as enum ('scheduled','queued','processing','provider_accepted','delivered','deferred','bounced','complained','failed','retrying','cancelled','suppressed');
    create table public.scheduled_email_queue (id uuid primary key, club_id uuid, team_id uuid, delivery_state public.email_delivery_state_v1, provider_message_id text, provider_accepted_at timestamptz, payload jsonb);
    create table public.training_availability_requests (id uuid primary key, calendar_event_id uuid, club_id uuid, team_id uuid, occurrence_date date, occurrence_starts_at timestamptz, status text);
    create table public.training_availability_request_players (
      id uuid primary key, request_id uuid, calendar_event_id uuid, club_id uuid, team_id uuid, player_id uuid,
      parent_link_id uuid, recipient_email text, recipient_type text, token_hash text, token_revoked_at timestamptz,
      response_deadline_at timestamptz, status text, email_queue_id uuid
    );
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), club_id uuid, actor_id uuid, action text, entity_type text, entity_id uuid, outcome text, metadata jsonb);
    create table public.event_removal_calls (source_type text, event_id uuid, player_id uuid, scope text, occurrence_date date);

    create function public.current_user_club_id() returns uuid language sql stable as $$ select club_id from public.users where id = auth.uid() $$;
    create function public.current_user_role_rank() returns integer language sql stable as $$ select role_rank from public.users where id = auth.uid() $$;
    create function public.current_user_role() returns text language sql stable as $$ select role from public.users where id = auth.uid() $$;
    create function public.is_calendar_event_player_excluded_internal(uuid, uuid, date) returns boolean language sql stable as $$ select false $$;
    create function public.remove_player_from_event(source_type_value text, event_id_value uuid, player_id_value uuid, occurrence_date_value date default null, scope_value text default 'event', request_token_value uuid default null, confirm_in_progress_value boolean default false)
    returns jsonb language plpgsql security definer set search_path = '' as $$
    declare affected integer := 1; suppressed integer := 0; revoked integer := 0;
    begin
      insert into public.event_removal_calls values (source_type_value, event_id_value, player_id_value, scope_value, occurrence_date_value);
      update public.calendar_event_invites set invite_status = case when scope_value = 'event' then 'cancelled' else invite_status end, cancelled_at = case when scope_value = 'event' then now() else cancelled_at end
      where player_id = player_id_value and ((source_type_value = 'calendar' and calendar_event_id = event_id_value) or (source_type_value = 'match-day' and match_day_id = event_id_value));
      get diagnostics suppressed = row_count;
      if source_type_value = 'match-day' then
        update public.match_day_availability_requests set token_revoked_at = now() where match_day_id = event_id_value and player_id = player_id_value and token_revoked_at is null;
      else
        update public.training_availability_request_players recipient set token_revoked_at = now()
        from public.training_availability_requests request
        where request.id = recipient.request_id and request.calendar_event_id = event_id_value and recipient.player_id = player_id_value and recipient.token_revoked_at is null;
      end if;
      get diagnostics revoked = row_count;
      return jsonb_build_object('affectedOccurrenceCount', affected, 'suppressedInvitationCount', suppressed, 'revokedTokenCount', revoked);
    end $$;
  `)

  await db.exec(migration)

  await db.query(`insert into public.clubs values ($1), ($2)`, [IDS.club, IDS.otherClub])
  await db.query(`insert into public.teams values ($1,$4,'FP TEST Team'),($2,$4,'FP TEST Other Team'),($3,$5,'Foreign Team')`, [IDS.team, IDS.otherTeam, IDS.foreignTeam, IDS.club, IDS.otherClub])
  for (const id of [IDS.admin, IDS.manager, IDS.coach, IDS.parent, IDS.outsider]) await db.query(`insert into auth.users values ($1)`, [id])
  await db.query(`
    insert into public.users values
      ($1,$6,'admin@example.test','Admin','Admin','admin',80,'active'),
      ($2,$6,'manager@example.test','Manager','Manager','manager',50,'active'),
      ($3,$6,'coach@example.test','Coach','Coach','coach',30,'active'),
      ($4,$6,'parent@example.test','Parent','Parent','parent_portal',0,'active'),
      ($5,$6,'outsider@example.test','Outsider','Outsider','manager',50,'active')
  `, [IDS.admin, IDS.manager, IDS.coach, IDS.parent, IDS.outsider, IDS.club])
  await db.query(`insert into public.team_staff values ($1,$2),($3,$4)`, [IDS.team, IDS.manager, IDS.otherTeam, IDS.outsider])
  await db.query(`insert into public.players (id,club_id,player_name,team,team_id,status,parent_email,parent_contacts) values ($1,$3,'FP TEST Player','FP TEST Team',$4,'active','parent@example.test','[]'),($2,$3,'Other Player','FP TEST Other Team',$5,'active','other@example.test','[]')`, [IDS.player, IDS.otherPlayer, IDS.club, IDS.team, IDS.otherTeam])
  await db.query(`insert into public.player_team_memberships (club_id,team_id,player_id,status) values ($1,$2,$3,'active')`, [IDS.club, IDS.otherTeam, IDS.player])
  await db.query(`insert into public.parent_player_links values ($1,$2,$3,$4,$5,'parent@example.test','active')`, [IDS.parentLink, IDS.club, IDS.team, IDS.player, IDS.parent])
  await db.query(`
    insert into public.calendar_events values
      ($1,$5,$6,'Future training','training','2099-01-10T10:00:00Z','2099-01-10T11:00:00Z','none',null,null),
      ($2,$5,$6,'Recurring training','training','2099-01-11T10:00:00Z','2099-01-11T11:00:00Z','weekly','2099-01-25',null),
      ($3,$5,$7,'Other Team event','training','2099-01-12T10:00:00Z','2099-01-12T11:00:00Z','none',null,null),
      ($4,$5,$6,'Past training','training','2020-01-10T10:00:00Z','2020-01-10T11:00:00Z','none',null,null)
  `, [IDS.standalone, IDS.recurring, IDS.otherEvent, IDS.pastEvent, IDS.club, IDS.team, IDS.otherTeam])
  await db.query(`insert into public.calendar_event_invites (club_id,team_id,calendar_event_id,player_id,invite_status,notify_requested) values ($1,$2,$3,$4,'pending',true),($1,$2,$5,$4,'pending',true),($1,$6,$7,$4,'pending',true),($1,$2,$8,$4,'accepted',false)`, [IDS.club, IDS.team, IDS.standalone, IDS.player, IDS.recurring, IDS.otherTeam, IDS.otherEvent, IDS.pastEvent])
  await db.query(`insert into public.match_days values ($1,$3,$4,'Future FC','2099-01-15','15:00',false,'scheduled',null),($2,$3,$4,'Completed FC','2020-01-15','15:00',false,'full_time',null)`, [IDS.match, IDS.completedMatch, IDS.club, IDS.team])
  await db.query(`insert into public.match_day_player_squad_decisions (match_day_id,club_id,team_id,player_id,status) values ($1,$2,$3,$4,'selected'),($5,$2,$3,$4,'selected')`, [IDS.match, IDS.club, IDS.team, IDS.player, IDS.completedMatch])
  await db.query(`insert into public.match_day_availability_requests (id,match_day_id,club_id,team_id,player_id,recipient_email,recipient_type,token_hash,status) values ($1,$2,$3,$4,$5,'parent@example.test','parent',repeat('a',64),'queued')`, [IDS.matchRequest, IDS.match, IDS.club, IDS.team, IDS.player])
  await db.query(`insert into public.training_availability_requests values ($1,$2,$3,$4,'2099-01-10','2099-01-10T10:00:00Z','queued')`, [IDS.trainingRequest, IDS.standalone, IDS.club, IDS.team])
  await db.query(`insert into public.training_availability_request_players (id,request_id,calendar_event_id,club_id,team_id,player_id,parent_link_id,recipient_email,recipient_type,token_hash,status,email_queue_id) values ($1,$2,$3,$4,$5,$6,$7,'parent@example.test','parent',repeat('b',64),'queued',$8)`, [IDS.recipient, IDS.trainingRequest, IDS.standalone, IDS.club, IDS.team, IDS.player, IDS.parentLink, IDS.queueTraining])
  await db.query(`insert into public.scheduled_email_queue values ($1,$3,$4,'queued',null,null,jsonb_build_object('matchDayAvailability',jsonb_build_object('requestId',$5::text))),($2,$3,$4,'queued',null,null,'{}')`, [IDS.queueMatch, IDS.queueTraining, IDS.club, IDS.team, IDS.matchRequest])
  return db
}

test('Team-only removal ends selected membership and preserves configured events, links, history, and the Player', async () => {
  const db = await createDatabase()
  await setActor(db, IDS.manager)

  const preview = await scalar(db, `select public.preview_player_team_removal($1,$2,'team_only')`, [IDS.player, IDS.team])
  assert.equal(preview.teamMembershipAffected, 1)
  assert.equal(preview.upcomingStandaloneEventsAffected, 0)
  assert.equal(preview.recurringOccurrencesAffected, 0)
  assert.equal(preview.futureConfiguredEventCount, 5)

  const token = 'a1000000-0000-4000-8000-000000000001'
  const result = await scalar(db, `select public.remove_player_from_team($1,$2,'team_only',$3)`, [IDS.player, IDS.team, token])
  assert.equal(result.status, 'completed')
  assert.equal(result.communicationSent, false)
  assert.equal(await scalar(db, `select count(*) from public.players where id=$1`, [IDS.player]), 1)
  assert.equal(await scalar(db, `select count(*) from public.player_team_memberships where player_id=$1 and team_id=$2 and status='inactive'`, [IDS.player, IDS.team]), 1)
  assert.equal(await scalar(db, `select count(*) from public.player_team_memberships where player_id=$1 and team_id=$2 and status='active'`, [IDS.player, IDS.otherTeam]), 1)
  assert.equal(await scalar(db, `select team_id from public.players where id=$1`, [IDS.player]), IDS.otherTeam)
  assert.equal(await scalar(db, `select count(*) from public.calendar_event_invites where player_id=$1 and invite_status <> 'cancelled'`, [IDS.player]), 4)
  assert.equal(await scalar(db, `select count(*) from public.match_day_availability_requests where player_id=$1 and token_revoked_at is not null`, [IDS.player]), 0)
  assert.equal(await scalar(db, `select count(*) from public.training_availability_request_players where player_id=$1 and token_revoked_at is not null`, [IDS.player]), 0)
  assert.equal(await scalar(db, `select count(*) from public.parent_player_links where id=$1 and status='active'`, [IDS.parentLink]), 1)
  assert.equal(await scalar(db, `select count(*) from public.event_removal_calls`), 0)

  const eventRemoval = await scalar(db, `select public.remove_player_from_event('calendar',$1,$2,null,'event',$3,false)`, [IDS.standalone, IDS.player, 'a1000000-0000-4000-8000-000000000002'])
  assert.equal(eventRemoval.affectedOccurrenceCount, 1)
  assert.equal(await scalar(db, `select team_id from public.players where id=$1`, [IDS.player]), IDS.otherTeam)
  assert.equal(await scalar(db, `select count(*) from public.event_removal_calls where event_id=$1`, [IDS.standalone]), 1)

  const duplicate = await scalar(db, `select public.remove_player_from_team($1,$2,'team_only',$3)`, [IDS.player, IDS.team, token])
  assert.equal(duplicate.duplicate, true)
  assert.equal(await scalar(db, `select count(*) from public.player_team_removal_commands`), 1)
  assert.equal(await scalar(db, `select count(*) from public.audit_logs where action='player_removed_from_team'`), 1)
})

test('Team and future-events removal cleans only selected-Team future participation', async () => {
  const db = await createDatabase()
  await setActor(db, IDS.manager)
  const result = await scalar(db, `select public.remove_player_from_team($1,$2,'team_and_future_events',$3)`, [IDS.player, IDS.team, 'a2000000-0000-4000-8000-000000000001'])

  assert.equal(result.status, 'completed')
  assert.equal(result.affectedOccurrenceCount, 3)
  assert.equal(result.communicationSent, false)
  assert.equal(await scalar(db, `select count(*) from public.event_removal_calls where event_id in ($1,$2,$3)`, [IDS.standalone, IDS.recurring, IDS.match]), 3)
  assert.equal(await scalar(db, `select count(*) from public.event_removal_calls where event_id in ($1,$2,$3)`, [IDS.otherEvent, IDS.pastEvent, IDS.completedMatch]), 0)
  assert.equal(await scalar(db, `select count(*) from public.match_day_availability_requests where id=$1 and token_revoked_at is not null`, [IDS.matchRequest]), 1)
  assert.equal(await scalar(db, `select count(*) from public.training_availability_request_players where id=$1 and token_revoked_at is not null`, [IDS.recipient]), 1)
  assert.equal(await scalar(db, `select count(*) from public.calendar_event_invites where calendar_event_id=$1 and invite_status <> 'cancelled'`, [IDS.otherEvent]), 1)
  assert.equal(await scalar(db, `select count(*) from public.calendar_event_invites where calendar_event_id=$1 and invite_status <> 'cancelled'`, [IDS.pastEvent]), 1)
  assert.equal(await scalar(db, `select count(*) from public.parent_player_links where id=$1 and status='active'`, [IDS.parentLink]), 1)
  assert.equal(await scalar(db, `select count(*) from public.players where id=$1`, [IDS.player]), 1)
})

test('Coach, Parent, cross-Team, and cross-club attempts fail closed', async () => {
  const db = await createDatabase()
  for (const actorId of [IDS.coach, IDS.parent]) {
    await setActor(db, actorId)
    await assert.rejects(() => db.query(`select public.preview_player_team_removal($1,$2,'team_only')`, [IDS.player, IDS.team]), /Team Admin or Manager access is required/)
  }

  await setActor(db, IDS.outsider)
  await assert.rejects(() => db.query(`select public.preview_player_team_removal($1,$2,'team_only')`, [IDS.player, IDS.team]), /permission/)
  await setActor(db, IDS.admin)
  await assert.rejects(() => db.query(`select public.preview_player_team_removal($1,$2,'team_only')`, [IDS.player, IDS.foreignTeam]), /active club/)
  assert.equal(await scalar(db, `select count(*) from public.player_team_removal_commands`), 0)
})
