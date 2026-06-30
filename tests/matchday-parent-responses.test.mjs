import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260630121322_matchday_parent_response_roles.sql', import.meta.url)
const repairMigrationUrl = new URL('../supabase/migrations/20260630125915_repair_matchday_parent_response_rpc.sql', import.meta.url)
const sharedModelMigrationUrl = new URL('../supabase/migrations/20260630153247_matchday_availability_shared_model.sql', import.meta.url)
const sendFunctionUrl = new URL('../netlify/functions/send-match-day-availability-requests.js', import.meta.url)
const confirmFunctionUrl = new URL('../netlify/functions/match-day-availability-confirm.js', import.meta.url)
const domainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)
const staffPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)

test('migration adds parent availability volunteer response storage', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /add column if not exists parent_link_id uuid references public\.parent_player_links/i)
  assert.match(migration, /add column if not exists volunteer_scorer_response text not null default 'no_response'/i)
  assert.match(migration, /add column if not exists volunteer_linesman_response text not null default 'no_response'/i)
  assert.match(migration, /add column if not exists volunteer_referee_response text not null default 'no_response'/i)
  assert.match(migration, /add column if not exists volunteer_responded_at timestamptz/i)
  assert.match(migration, /check \(volunteer_scorer_response in \('no_response', 'yes', 'no'\)\)/i)
})

test('migration keeps token response writes behind security definer RPCs', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create or replace function public\.get_match_day_availability_response\(token_hash_value text\)[\s\S]*security definer[\s\S]*set search_path = public/i)
  assert.match(migration, /create or replace function public\.submit_match_day_availability_response\([\s\S]*volunteer_scorer_response_value text default null[\s\S]*volunteer_linesman_response_value text default null[\s\S]*volunteer_referee_response_value text default null/i)
  assert.match(migration, /normalized_token_hash !~ '\^\[a-f0-9\]\{64\}\$'/i)
  assert.match(migration, /normalized_status not in \('available', 'unavailable', 'maybe'\)/i)
  assert.match(migration, /grant execute on function public\.submit_match_day_availability_response\(text, text, text, text, text\) to anon;/i)
  assert.match(migration, /grant execute on function public\.submit_match_day_availability_response\(text, text, text, text, text\) to authenticated;/i)
})

test('repair migration qualifies match day parent response RPC columns', async () => {
  const migration = await readFile(repairMigrationUrl, 'utf8')

  assert.match(migration, /create or replace function public\.submit_match_day_availability_response\([\s\S]*volunteer_referee_response_value text default null/i)
  assert.match(migration, /returns table \([\s\S]*volunteer_responded_at timestamptz[\s\S]*\)/i)
  assert.match(migration, /language plpgsql[\s\S]*security definer[\s\S]*set search_path = public/i)
  assert.match(migration, /update public\.match_day_availability_requests as availability[\s\S]*else availability\.volunteer_responded_at/i)
  assert.match(migration, /where availability\.id = request_row\.id/i)
  assert.match(migration, /from public\.parent_player_links as parent_link[\s\S]*where parent_link\.id = updated_row\.parent_link_id/i)
  assert.match(migration, /update public\.match_day_scorer_interest as scorer_interest[\s\S]*where scorer_interest\.match_day_id = match_row\.id/i)
  assert.match(migration, /grant execute on function public\.submit_match_day_availability_response\(text, text, text, text, text\) to anon;/i)
  assert.match(migration, /grant execute on function public\.submit_match_day_availability_response\(text, text, text, text, text\) to authenticated;/i)
  assert.doesNotMatch(migration, /drop function/i)
  assert.doesNotMatch(migration, /cascade/i)
  assert.doesNotMatch(migration, /else volunteer_responded_at/i)
})

test('migration links scorer yes replies into existing scorer selection without replacing selected parents', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /insert into public\.match_day_scorer_interest/i)
  assert.match(migration, /on conflict \(match_day_id, parent_link_id\)[\s\S]*where public\.match_day_scorer_interest\.status <> 'selected'/i)
  assert.match(migration, /next_scorer_response = 'no'[\s\S]*set status = 'declined'/i)
})

test('migration expands parent portal matchday RPC response state safely', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /drop function if exists public\.get_parent_portal_match_days\(uuid\);/i)
  assert.match(migration, /availability_status text[\s\S]*volunteer_scorer_response text[\s\S]*volunteer_linesman_response text[\s\S]*volunteer_referee_response text/i)
  assert.match(migration, /left join lateral \([\s\S]*from public\.match_day_availability_requests request[\s\S]*request\.parent_link_id = link\.id/i)
  assert.match(migration, /revoke execute on function public\.get_parent_portal_match_days\(uuid\) from anon;/i)
  assert.doesNotMatch(migration, /grant execute on function public\.get_parent_portal_match_days\(uuid\) to anon;/i)
})

test('shared availability migration adds current player availability and history without dropping RPCs', async () => {
  const migration = await readFile(sharedModelMigrationUrl, 'utf8')

  assert.match(migration, /create table if not exists public\.match_day_player_availability/i)
  assert.match(migration, /create table if not exists public\.match_day_player_availability_history/i)
  assert.match(migration, /create table if not exists public\.match_day_role_assignments/i)
  assert.match(migration, /create unique index if not exists match_day_player_availability_match_player_key[\s\S]*match_day_id, player_id/i)
  assert.match(migration, /constraint match_day_role_assignments_role_check check \(role in \('scorer', 'linesman', 'referee'\)\)/i)
  assert.match(migration, /order by request\.match_day_id,[\s\S]*request\.player_id,[\s\S]*request\.responded_at desc nulls last/i)
  assert.doesNotMatch(migration, /drop function/i)
})

test('shared availability RPC preserves existing submit signature and adds a v2 read model', async () => {
  const migration = await readFile(sharedModelMigrationUrl, 'utf8')

  assert.match(migration, /create or replace function public\.get_match_day_availability_response_v2\(token_hash_value text\)/i)
  assert.match(migration, /current_availability_status text[\s\S]*current_availability_selected_by_name text[\s\S]*current_availability_selected_by_email text/i)
  assert.match(migration, /create or replace function public\.submit_match_day_availability_response\([\s\S]*status_value text[\s\S]*volunteer_referee_response_value text default null/i)
  assert.match(migration, /returns table \([\s\S]*request_id uuid[\s\S]*volunteer_responded_at timestamptz[\s\S]*\)/i)
  assert.match(migration, /should_update_availability := normalized_status in \('available', 'unavailable', 'maybe'\)/i)
  assert.match(migration, /insert into public\.scheduled_email_queue[\s\S]*previous_current\.selected_by_email/i)
  assert.match(migration, /insert into public\.match_day_player_availability_history/i)
  assert.match(migration, /coalesce\(current_availability\.status, availability\.status\) as availability_status/i)
  assert.match(migration, /grant execute on function public\.get_match_day_availability_response_v2\(text\) to anon;/i)
  const parentPortalSignature = migration.slice(
    migration.indexOf('create or replace function public.get_parent_portal_match_days'),
    migration.indexOf('language sql', migration.indexOf('create or replace function public.get_parent_portal_match_days')),
  )
  assert.doesNotMatch(parentPortalSignature, /availability_selected_by_name text/i)
})

test('send function creates one response form link and stores parent link context', async () => {
  const source = await readFile(sendFunctionUrl, 'utf8')

  assert.match(source, /\.from\('parent_player_links'\)[\s\S]*\.eq\('status', 'active'\)/)
  assert.match(source, /parent_link_id: parentLink\?\.id \|\| null/)
  assert.match(source, /volunteer_scorer_response: 'no_response'/)
  assert.match(source, /Open response form/)
  assert.match(source, /match-day-availability-confirm\?token=\$\{token\}/)
  assert.doesNotMatch(source, /status=available/)
})

test('confirmation function renders a form and submits availability plus role replies', async () => {
  const source = await readFile(confirmFunctionUrl, 'utf8')

  assert.match(source, /supabase\.rpc\('get_match_day_availability_response_v2'/)
  assert.match(source, /supabase\.rpc\('submit_match_day_availability_response'/)
  assert.match(source, /Keep \$\{statusLabel\(currentStatus\)\}/)
  assert.match(source, /status_value: VALID_STATUSES\.has\(status\) \? status : null/)
  assert.match(source, /roleFieldset\('volunteerScorerResponse', 'scorer'/)
  assert.match(source, /roleFieldset\('volunteerLinesmanResponse', 'linesman'/)
  assert.match(source, /roleFieldset\('volunteerRefereeResponse', 'referee'/)
  assert.match(source, /legacyStatus/)
  assert.match(source, /Fixture response/)
})

test('domain normalizer exposes staff and parent response fields', async () => {
  const source = await readFile(domainUrl, 'utf8')

  assert.match(source, /function normalizeAvailabilityRequest/)
  assert.match(source, /function normalizePlayerAvailability/)
  assert.match(source, /function normalizeAvailabilityHistory/)
  assert.match(source, /function normalizeRoleAssignment/)
  assert.match(source, /match_day_player_availability \(\*\)/)
  assert.match(source, /match_day_player_availability_history \(\*\)/)
  assert.match(source, /match_day_role_assignments \(\*, parent_player_links:parent_link_id \(email, auth_user_id, players:player_id \(player_name\)\)\)/)
  assert.match(source, /match_day_availability_requests \(\*, players:player_id \(player_name\), parent_player_links:parent_link_id \(email, auth_user_id, players:player_id \(player_name\)\)\)/)
  assert.match(source, /availabilityStatus: normalizeText\(row\.availability_status/)
  assert.match(source, /volunteerScorerResponse: normalizeVolunteerResponse/)
  assert.match(source, /roleAssignments,/)
  assert.match(source, /playerAvailability,/)
  assert.match(source, /availabilityHistory,/)
  assert.match(source, /availabilityRequests,/)
  assert.match(source, /export async function selectMatchDayVolunteer/)
})

test('staff and parent pages surface availability and volunteer responses', async () => {
  const staffSource = await readFile(staffPageUrl, 'utf8')
  const parentSource = await readFile(parentPortalPageUrl, 'utf8')

  assert.match(staffSource, /Player availability/)
  assert.match(staffSource, /Volunteer responses by role/)
  assert.match(staffSource, /getCurrentAvailabilityRows/)
  assert.match(staffSource, /getAvailabilityHistoryForPlayer/)
  assert.match(staffSource, /getSelectedRoleAssignment/)
  assert.match(staffSource, /onVolunteerSelection\(match, row, role\.key, !isSelected\)/)
  assert.match(parentSource, /Your fixture response/)
  assert.match(parentSource, /Use the response email link to update availability and requested role replies\./)
})
