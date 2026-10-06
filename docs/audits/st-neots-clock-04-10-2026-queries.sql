-- Read-only evidence. No mutation or actor impersonation.
select m.id,c.name as club,m.opponent,m.kickoff_time,m.status,m.home_score,m.away_score,
       m.timer_status,m.timer_started_at,m.timer_paused_at,m.timer_elapsed_seconds,
       m.match_duration_minutes,m.match_clock_mode,m.concluded_at
from public.match_days m
join public.clubs c on c.id=m.club_id join public.teams t on t.id=m.team_id
where m.match_date='2026-10-04'
  and (c.name ilike '%neot%' or t.name ilike '%neot%' or m.opponent ilike '%neot%');

select id,kind,payload->>'action' as timer_action,payload->>'minute' as recorded_minute,
       captured_at,created_at,extract(epoch from(created_at-captured_at)) as sync_delay_seconds,event_id
from private.parent_scorer_match_day_commands
where match_day_id='652b9a48-773a-4dcd-ae0e-bc46fb2b70b3' order by captured_at,created_at;

select id,metadata->>'action' as timer_action,previous_value,new_value,created_at
from public.match_day_event_log
where match_day_id='652b9a48-773a-4dcd-ae0e-bc46fb2b70b3'
  and metadata->>'source'='match_day_timer_rpc' order by created_at;

select id,event_type,minute,stoppage_minute,match_phase,event_sequence,home_score,away_score,
       event_status,created_at,request_id,corrected_at,correction_metadata
from public.match_day_events
where match_day_id='652b9a48-773a-4dcd-ae0e-bc46fb2b70b3' order by created_at,event_sequence;
