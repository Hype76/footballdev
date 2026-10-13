-- Parent portal accounts need no staff profile. Explicit inactive profiles still block delivery.
-- Match existing communication semantics: legacy defaults are not guardian opt-outs.
-- Preserve finalized-recipient authority, account checks, channels and private execution.
create or replace function app_private.coach_assessment_parent_is_current(actor_value uuid,evaluation_value uuid,link_value uuid)
returns boolean language sql security definer set search_path = '' as $$
  select exists (
    select 1 from public.evaluations e
    join public.development_parent_reports r on r.evaluation_id=e.id and r.club_id=e.club_id and r.finalized_by=actor_value
    join public.clubs c on c.id=e.club_id and coalesce(c.status,'active')='active' and c.archived_at is null
    join public.teams t on t.id=e.team_id and t.club_id=c.id and coalesce(t.status,'active')='active' and t.archived_at is null
    join public.players p on p.id=e.player_id and p.club_id=e.club_id and p.team_id=e.team_id and coalesce(p.status,'active')='active'
    join auth.users actor on actor.id=actor_value and actor.email_confirmed_at is not null
      and (actor.banned_until is null or actor.banned_until<=now())
    join public.parent_player_links l on l.id=link_value and l.player_id=p.id and l.club_id=c.id
      and (l.team_id is null or l.team_id=t.id) and l.link_type='parent' and l.status='active'
      and (l.guardian_id is null or coalesce(l.receives_communications,true))
    join auth.users recipient on recipient.id=l.auth_user_id and recipient.email_confirmed_at is not null
      and (recipient.banned_until is null or recipient.banned_until<=now())
      and recipient.deleted_at is null
      and not exists(select 1 from public.users parent_profile where parent_profile.id=recipient.id
        and coalesce(parent_profile.status,'active')<>'active')
    left join public.parent_communication_preferences preference on preference.auth_user_id=recipient.id
    where e.id=evaluation_value and e.status='Submitted' and e.coach_id=actor_value
      and app_private.actor_can_manage_team_resource(actor_value,e.club_id,e.team_id,20)
      and public.is_club_plan_access_active(e.club_id) and public.can_use_plan_feature(e.club_id,'assessments')
      and coalesce(preference.communication_channel,'both') in ('app','both')
      and r.report_snapshot->>'evaluationId'=e.id::text and r.report_snapshot->'club'->>'id'=e.club_id::text
      and r.report_snapshot->'team'->>'id'=e.team_id::text and r.report_snapshot->'player'->>'id'=e.player_id::text
      and r.report_snapshot->'author'->>'id'=actor_value::text
      and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(r.report_snapshot->'recipients')='array'
        then r.report_snapshot->'recipients' else '[]'::jsonb end) item where item->>'linkId'=l.id::text)
  );
$$;
alter function app_private.coach_assessment_parent_is_current(uuid,uuid,uuid) owner to postgres;
revoke all on function app_private.coach_assessment_parent_is_current(uuid,uuid,uuid) from public,anon,authenticated,service_role;
