-- Resource Library records do not currently have an expires_at column.
-- Read a future optional expiry through JSON without changing current non-expiring
-- resource semantics, target authority, positive projections, pagination or ACLs.

create or replace function public.get_own_coach_offline_resource(club_value uuid,team_value uuid,resource_key text,cursor_value text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare authority jsonb; query_text text; result jsonb; cursor_json jsonb; after_key text:=''; expected_revision text;
begin
  authority:=app_private.coach_offline_read_context(auth.uid(),club_value,team_value);
  if authority is null then raise exception 'coach_offline_context_denied' using errcode='42501'; end if;
  if cursor_value is not null then
    begin cursor_json:=cursor_value::jsonb;
    exception when others then raise exception 'coach_offline_cursor_invalid' using errcode='22023'; end;
    if cursor_json->>'actor' is distinct from auth.uid()::text or cursor_json->>'club' is distinct from club_value::text
      or cursor_json->>'team' is distinct from team_value::text or cursor_json->>'resource' is distinct from resource_key
      or cursor_json->>'revision' is null or cursor_json->>'after' is null then
      raise exception 'coach_offline_cursor_invalid' using errcode='22023'; end if;
    after_key:=cursor_json->>'after'; expected_revision:=cursor_json->>'revision';
  end if;
  case resource_key
    when 'players' then query_text:=$query$select 'players'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,team_id,player_name,first_name,last_name,preferred_name,shirt_number,positions,section,status,team,contact_type,date_of_birth,parent_contacts,parent_email,parent_name,created_at,updated_at,archived_at',',')) || case when public.can_use_plan_feature($2,'playerNotes') then jsonb_build_object('notes',to_jsonb(t)->'notes') else '{}'::jsonb end || jsonb_build_object('team_id',$3) as data
    from public.players t where t.club_id=$2 and coalesce(t.status,'active')<>'archived' and public.can_use_plan_feature($2,'players') and exists(select 1 from public.player_team_memberships p where p.player_id=t.id and p.club_id=$2 and p.team_id=$3 and p.status='active') and (lower(coalesce(t.section,''))<>'trial' or public.can_use_plan_feature($2,'trialPlayers'))
union all
select 'playerTypes'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,name,can_training,can_friendly,can_cup,can_league,chat_group,is_default,created_at,updated_at',',')) as data
    from public.club_player_types t where t.club_id=$2
union all
select 'parentLinks'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,team_id,player_id,auth_user_id,email,name,parent_name,link_type,status,invite_sent_at,expires_at,created_at,accepted_at,updated_at',',')) as data
    from public.parent_player_links t where t.club_id=$2 and exists(select 1 from public.players p join public.player_team_memberships pm on pm.player_id=p.id and pm.club_id=p.club_id
  where p.id=t.player_id and p.club_id=$2 and pm.team_id=$3 and pm.status='active' and coalesce(p.status,'active')<>'archived'
    and (lower(coalesce(p.section,''))<>'trial' or public.can_use_plan_feature($2,'trialPlayers'))) and public.can_use_plan_feature($2,'parentPortal')$query$;
    when 'development' then query_text:=$query$select 'evaluations'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,team_id,player_id,player_name,coach_id,date,session,session_id,team,status,average_score,scores,form_responses,feedback_form_id,feedback_form_name,feedback_form_snapshot,comments,overall_comments,notes,parent_shared,created_at,updated_at,created_by_name,coach_name,coach',',')) as data
    from public.evaluations t where t.club_id=$2 and t.team_id=$3 and public.can_use_plan_feature($2,'assessments')
union all
select 'drafts'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,team_id,player_id,created_by_user_id,report_type,status,draft_data,client_save_version,last_saved_at,created_at,updated_at',',')) as data
    from public.evaluation_drafts t where t.club_id=$2 and t.team_id=$3 and t.created_by_user_id=$1 and t.status in ('draft','submitted','discarded')
union all
select 'forms'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,team_id,name,description,fields,created_by,access_scope,age_group,status,version,template_key,starter_template_key,starter_template_version,archived_at,created_at,updated_at',',')) as data
    from public.feedback_forms t where t.club_id=$2 and t.team_id=$3 and t.archived_at is null and public.can_use_plan_feature($2,'customDevelopmentFields') and (t.access_scope='team' or t.created_by=$1)
union all
select 'fields'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,team_id,label,type,options,required,is_enabled,order_index,is_default,created_at,updated_at',',')) as data
    from public.form_fields t where t.club_id=$2 and (t.team_id=$3 or t.team_id is null) and t.is_enabled and public.can_use_plan_feature($2,'customDevelopmentFields')
union all
select 'starterTemplates'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,template_key,version,name,description,age_min,age_max,age_band,fields,is_current',',')) as data
    from public.feedback_form_starter_templates t where t.is_current
union all
select 'starterPreferences'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,team_id,template_key,hidden',',')) as data
    from public.feedback_form_starter_preferences t where t.club_id=$2 and t.team_id=$3$query$;
    when 'sessions' then query_text:=$query$select 'sessions'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,team_id,team,title,opponent,session_type,session_date,start_time,end_time,arrival_time,location,notes,status,created_by,created_by_name,completed_at,completed_by,completed_by_name,created_at,updated_at',',')) as data
    from public.assessment_sessions t where t.club_id=$2 and t.team_id=$3 and public.can_use_plan_feature($2,'assessments') and (t.created_by=$1 or $4>=50 or exists(select 1 from public.team_staff a where a.user_id=$1 and a.team_id=t.team_id))
union all
select 'sessionPlayers'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,session_id,player_id,player_name,section,team,notes,created_at,updated_at',',')) as data
    from public.assessment_session_players t where exists(select 1 from public.assessment_sessions s where s.id=t.session_id and s.club_id=$2 and s.team_id=$3
  and (s.created_by=$1 or $4>=50 or exists(select 1 from public.team_staff a where a.user_id=$1 and a.team_id=s.team_id))) and public.can_use_plan_feature($2,'assessments')$query$;
    when 'calendar' then query_text:=$query$select 'calendarEvents'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,team_id,event_type,title,description,starts_at,ends_at,location,notes,notes_pinned,parent_visible,cancelled_at,cancellation_reason,parent_audience,recurrence_frequency,recurrence_until,deleted_occurrence_dates,created_at,updated_at',',')) as data
    from public.calendar_events t where t.club_id=$2 and (t.team_id=$3 or t.team_id is null) and public.can_use_plan_feature($2,'teamCalendar')
  and public.can_use_plan_feature($2,case when t.team_id is null then 'clubWideEvents' when t.event_type='training' then 'trainingEvents' when t.event_type='match' then 'fixtures' else 'generalEvents' end)
  and (coalesce(t.recurrence_frequency,'none')='none' or public.can_use_plan_feature($2,'recurringEvents'))
union all
select 'locations'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,name,address,postcode,latitude,longitude,archived_at,created_at,updated_at',',')) as data
    from public.match_locations t where t.club_id=$2 and t.archived_at is null$query$;
    when 'matches' then query_text:=$query$select 'matches'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,title,club_id,team_id,notification_team_name,opponent,fixture_type,pitch_type,carpool_enabled,match_conclusion_rule,current_match_phase,extra_time_half_minutes,extra_time_period_count,match_date,kickoff_time,kickoff_time_tbc,arrival_time,home_away,shirt_choice,match_clock_mode,match_duration_minutes,venue_name,venue_address,notes,request_scorer,request_linesman,request_referee,parent_visible,parent_audience,status,cancellation_reason,home_score,away_score,normal_time_home_score,normal_time_away_score,extra_time_home_score,extra_time_away_score,home_shootout_score,away_shootout_score,shootout_winner,phase_started_at,timer_started_at,timer_paused_at,timer_elapsed_seconds,timer_status,full_time_resume_status,concluded_at,concluded_by,previous_hidden_at,created_at,updated_at',',')) as data
    from public.match_days t where t.club_id=$2 and (t.team_id=$3 or t.team_id is null) and t.deleted_at is null and public.can_use_plan_feature($2,'fixtures')
union all
select 'events'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,match_day_id,event_type,team_side,minute,stoppage_minute,scorer_player_id,assist_player_id,participant_identity_version,scorer_name,scorer_shirt_number,assist_name,assist_shirt_number,player_name,player_shirt_number,player_on_name,player_on_shirt_number,home_score,away_score,notes,is_penalty_goal,is_own_goal,event_status,correction_reason,correction_metadata,voided_at,created_by_name,created_at,event_team_id,event_team_name,match_phase,phase_order,event_sequence',',')) as data
    from public.match_day_events t where exists(select 1 from public.match_days m where m.id=t.match_day_id and m.club_id=$2
  and (m.team_id=$3 or m.team_id is null) and m.deleted_at is null) and public.can_use_plan_feature($2,'matchDay')
union all
select 'shootoutKicks'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,match_day_id,team_side,outcome,kick_number,player_name,notes,event_status,void_reason,home_shootout_score,away_shootout_score,created_by_name,created_at',',')) as data
    from public.match_day_shootout_kicks t where exists(select 1 from public.match_days m where m.id=t.match_day_id and m.club_id=$2
  and (m.team_id=$3 or m.team_id is null) and m.deleted_at is null) and public.can_use_plan_feature($2,'matchDay')
union all
select 'availability'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,match_day_id,club_id,team_id,player_id,status,selected_at,updated_at',',')) as data
    from public.match_day_player_availability t where exists(select 1 from public.match_days m where m.id=t.match_day_id and m.club_id=$2
  and (m.team_id=$3 or m.team_id is null) and m.deleted_at is null) and public.can_use_plan_feature($2,'fixtures')
union all
select 'squadDecisions'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,match_day_id,club_id,team_id,player_id,status,decided_by_name,decided_at,updated_at,decision_revision,notified_at',',')) as data
    from public.match_day_player_squad_decisions t where exists(select 1 from public.match_days m where m.id=t.match_day_id and m.club_id=$2
  and (m.team_id=$3 or m.team_id is null) and m.deleted_at is null) and public.can_use_plan_feature($2,'fixtures')
union all
select 'matchRequests'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,match_day_id,club_id,team_id,player_id,parent_link_id,recipient_type,recipient_name,recipient_email,status,sent_at,responded_at,expires_at,token_revoked_at,token_revoked_reason,volunteer_scorer_response,volunteer_linesman_response,volunteer_referee_response,transport_needs_lift,transport_can_offer_lift,transport_seats_offered',',')) as data
    from public.match_day_availability_requests t where exists(select 1 from public.match_days m where m.id=t.match_day_id and m.club_id=$2
  and (m.team_id=$3 or m.team_id is null) and m.deleted_at is null) and public.can_use_plan_feature($2,'fixtures')
union all
select 'roleAssignments'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,match_day_id,role,parent_link_id,auth_user_id,parent_email,player_name,assigned_by_name,created_at',',')) as data
    from public.match_day_role_assignments t where exists(select 1 from public.match_days m where m.id=t.match_day_id and m.club_id=$2
  and (m.team_id=$3 or m.team_id is null) and m.deleted_at is null) and public.can_use_plan_feature($2,'matchDay')
union all
select 'scorerInterest'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,match_day_id,parent_link_id,auth_user_id,status,created_at,updated_at',',')) as data
    from public.match_day_scorer_interest t where exists(select 1 from public.match_days m where m.id=t.match_day_id and m.club_id=$2
  and (m.team_id=$3 or m.team_id is null) and m.deleted_at is null) and public.can_use_plan_feature($2,'matchDay')
union all
select 'scorerAssignments'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,match_day_id,parent_link_id,auth_user_id,status,created_at,updated_at',',')) as data
    from public.match_day_scorer_assignments t where exists(select 1 from public.match_days m where m.id=t.match_day_id and m.club_id=$2
  and (m.team_id=$3 or m.team_id is null) and m.deleted_at is null) and public.can_use_plan_feature($2,'matchDay')
union all
select 'finalReports'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,match_day_id,staff_notes,created_by_name,updated_by_name,created_at,updated_at',',')) as data
    from public.match_day_final_reports t where exists(select 1 from public.match_days m where m.id=t.match_day_id and m.club_id=$2
  and (m.team_id=$3 or m.team_id is null) and m.deleted_at is null and m.status='full_time') and public.can_use_plan_feature($2,'matchDay')
union all
select 'scoring'::text, t.player_id::text,to_jsonb(t) from app_private.coach_offline_season_stats($1,$2,$3) t
union all
select 'startingSquads'::text,coalesce(to_jsonb(t)->>'id',t.match_day_id::text),app_private.coach_offline_project(to_jsonb(t),array['id','match_day_id','club_id','team_id','player_ids'])
from public.match_day_starting_squads t where t.club_id=$2 and t.team_id=$3 and public.can_use_plan_feature($2,'matchDay')$query$;
    when 'resources' then query_text:=$query$select 'resources'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,team_id,title,description,category,resource_type,storage_bucket,storage_path,original_filename,mime_type,file_size_bytes,expires_at,archived_at,uploaded_by_name,created_at,updated_at',',')) as data
    from public.resource_library_items t where t.club_id=$2 and t.team_id=$3 and t.archived_at is null and ((to_jsonb(t)->>'expires_at') is null or (to_jsonb(t)->>'expires_at')::timestamptz>now()) and public.can_use_plan_feature($2,'resourceLibrary')
union all
select 'resourceLinks'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,resource_id,club_id,team_id,linked_type,linked_id,parent_visible,share_description,calendar_occurrence_date,assigned_at,removed_at',',')) as data
    from public.resource_library_links t where exists(select 1 from public.resource_library_items r where r.id=t.resource_id and r.club_id=$2
  and r.team_id=$3 and r.archived_at is null and ((to_jsonb(r)->>'expires_at') is null or (to_jsonb(r)->>'expires_at')::timestamptz>now())) and t.removed_at is null and public.can_use_plan_feature($2,'resourceLibrary')
union all
select 'resourceExternalLinks'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,resource_id,club_id,team_id,external_url',',')) as data
    from public.resource_library_external_links t where exists(select 1 from public.resource_library_items r where r.id=t.resource_id and r.club_id=$2
  and r.team_id=$3 and r.archived_at is null and ((to_jsonb(r)->>'expires_at') is null or (to_jsonb(r)->>'expires_at')::timestamptz>now())) and public.can_use_plan_feature($2,'resourceLibrary')$query$;
    when 'chat' then query_text:=$query$select 'staffRooms'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,team_id,player_id,type,title,created_at,updated_at,last_message_at',',')) as data
    from public.staff_chat_conversations t where app_private.coach_offline_staff_room($1,$2,$3,t.id)
union all
select 'staffMembers'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,conversation_id,user_id,archived_at,last_read_at',',')) as data
    from public.staff_chat_members t where app_private.coach_offline_staff_room($1,$2,$3,t.conversation_id)
union all
select 'staffMessages'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,conversation_id,sender_id,sender_name,sender_role,deleted_at,created_at,updated_at',','))
      || jsonb_build_object('body',case when t.deleted_at is null then t.body else '' end) as data
    from public.staff_chat_messages t where app_private.coach_offline_staff_room($1,$2,$3,t.conversation_id)
union all
select 'parentRooms'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,team_id,player_id,match_day_id,room_type,title,status,created_at,updated_at',',')) as data
    from public.parent_chat_rooms t where t.club_id=$2 and t.team_id=$3 and t.status in ('active','closed') and public.can_use_plan_feature($2,'parentChat') and exists(select 1 from public.team_staff a where a.user_id=$1 and a.team_id=$3)
union all
select 'parentMessages'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,room_id,club_id,sender_id,sender_kind,sender_name,sender_role,deleted_at,created_at,updated_at',','))
      || jsonb_build_object('body',case when t.deleted_at is null then t.body else '' end) as data
    from public.parent_chat_messages t where exists(select 1 from public.parent_chat_rooms r where r.id=t.room_id and r.club_id=$2 and r.team_id=$3
  and r.status in ('active','closed') and exists(select 1 from public.team_staff a where a.user_id=$1 and a.team_id=$3)) and public.can_use_plan_feature($2,'parentChat')
union all
select 'parentMembers'::text,t.id::text,app_private.coach_offline_project(to_jsonb(t),array['id','room_id','auth_user_id','active','last_read_at'])
from public.parent_chat_memberships t where t.auth_user_id=$1 and exists(select 1 from public.parent_chat_rooms r
  where r.id=t.room_id and r.club_id=$2 and r.team_id=$3 and r.status in ('active','closed')
    and exists(select 1 from public.team_staff a where a.user_id=$1 and a.team_id=$3)) and public.can_use_plan_feature($2,'parentChat')$query$;
    when 'messages' then query_text:=$query$select 'messages'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,player_id,user_id,channel,action,subject,body,status,recipient_name,created_at,read_at,archived_at',',')) || jsonb_build_object('metadata',app_private.coach_offline_project(coalesce(to_jsonb(t)->'metadata','{}'::jsonb),array['subject','body','status','recipientName'])) as data
    from public.communication_logs t where t.club_id=$2 and exists(select 1 from public.players p join public.player_team_memberships pm on pm.player_id=p.id and pm.club_id=p.club_id
  where p.id=t.player_id and p.club_id=$2 and pm.team_id=$3 and pm.status='active' and coalesce(p.status,'active')<>'archived'
    and (lower(coalesce(p.section,''))<>'trial' or public.can_use_plan_feature($2,'trialPlayers'))) and (t.user_id=$1 or $4>=50)$query$;
    when 'polls' then query_text:=$query$select 'polls'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,team_id,title,description,audience,poll_type,options,status,closes_at,allow_multiple,max_choices,allow_own_child_votes,allow_vote_changes,hide_votes,allow_comments,created_by,created_at,updated_at',',')) as data
    from public.polls t where t.club_id=$2 and (t.team_id=$3 or (t.team_id is null and $5='admin')) and public.can_use_plan_feature($2,'teamPolls')
union all
select 'votes'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,poll_id,club_id,team_id,auth_user_id,option_id,voter_name,voter_email,comment,created_at,updated_at',','))
      - case when exists(select 1 from public.polls p where p.id=t.poll_id and p.hide_votes) then array['voter_name','voter_email'] else array[]::text[] end
      - case when t.auth_user_id is distinct from $1 and exists(select 1 from public.polls p where p.id=t.poll_id and p.hide_votes) then array['auth_user_id'] else array[]::text[] end as data
    from public.poll_votes t where t.club_id=$2 and (t.team_id=$3 or (t.team_id is null and $5='admin')) and public.can_use_plan_feature($2,'teamPolls')
      and exists(select 1 from public.polls p where p.id=t.poll_id and p.club_id=$2 and (p.team_id=$3 or (p.team_id is null and $5='admin')))$query$;
    when 'invites' then query_text:=$query$select 'calendarInvites'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,team_id,calendar_event_id,player_id,recipient_type,invite_status,response_status,responded_at,adult_response_status,adult_responded_at,adult_response_user_id,cancelled_at,created_at,updated_at',',')) as data
    from public.calendar_event_invites t where t.club_id=$2 and t.team_id=$3 and public.can_use_plan_feature($2,'teamCalendar')
union all
select 'trainingRequests'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,team_id,calendar_event_id,occurrence_date,occurrence_starts_at,occurrence_ends_at,status,response_deadline_at,created_at,updated_at',',')) as data
    from public.training_availability_requests t where t.club_id=$2 and t.team_id=$3 and public.can_use_plan_feature($2,'trainingEvents')
union all
select 'trainingPlayers'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,request_id,club_id,team_id,calendar_event_id,player_id,player_name,parent_link_id,recipient_type,recipient_email,status,email_sent_at,last_error,response_deadline_at,token_revoked_at,token_revoked_reason,created_at,updated_at',','))
      || jsonb_build_object('scheduled_email_queue',(select app_private.coach_offline_project(to_jsonb(q),array['delivery_state','provider_accepted_at','provider_delivered_at','status']) from public.scheduled_email_queue q where q.id=t.email_queue_id)) as data
    from public.training_availability_request_players t where t.club_id=$2 and t.team_id=$3 and public.can_use_plan_feature($2,'trainingEvents')
union all
select 'trainingResponses'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,request_id,request_player_id,club_id,team_id,calendar_event_id,player_id,status,note,responded_at,responded_by_name,response_source',',')) as data
    from public.training_availability_responses t where t.club_id=$2 and t.team_id=$3 and public.can_use_plan_feature($2,'trainingEvents')
union all
select 'coachAttendance'::text as kind, coalesce(to_jsonb(t)->>'id',md5(to_jsonb(t)::text)) as id,
    app_private.coach_offline_project(to_jsonb(t),string_to_array('id,request_id,club_id,team_id,calendar_event_id,occurrence_date,occurrence_starts_at,coach_user_id,coach_name,status,responded_at,notification_status,notification_sent_at,notification_error',',')) as data
    from public.training_coach_attendance t where t.club_id=$2 and t.team_id=$3 and t.is_visible and public.can_use_plan_feature($2,'trainingEvents')$query$;
    when 'formations' then query_text:=$query$select 'formations'::text as kind,t.id::text as id,
  jsonb_build_object('board',app_private.coach_offline_project(to_jsonb(t),string_to_array('id,club_id,team_id,title,description,game_format,formation_preset_key,preset_registry_version,linked_match_day_id,visibility_state,current_version_id,current_version_number,current_publication_id,created_by_profile_id,archived_at,deleted_at,created_at,updated_at',',')),
    'currentVersion',app_private.coach_offline_project((app_private.formation_board_payload(t.id))->'currentVersion',string_to_array('id,board_id,version_number,game_format,formation_preset_key,preset_registry_version,pitch_orientation,placements,bench,custom_slots,notes,shirt_kit,version_reason,created_at,created_by_name,created_by_profile_id',','))) as data
  from public.formation_boards t where t.club_id=$2 and t.team_id=$3 and t.deleted_at is null and t.archived_at is null and app_private.formation_board_can_view($1,t.id)
union all
select 'formationPresets'::text,t.registry_version::text||':'||t.preset_key,
  app_private.coach_offline_project(to_jsonb(t),array['registry_version','preset_key','display_name','game_format','player_count','slots','sort_order'])
from public.formation_board_presets t where t.registry_version=1 and t.readiness_state='ready'
union all
select 'formationPublications'::text,t.id::text,
  app_private.coach_offline_project(to_jsonb(t),array['id','board_id','board_version_id','club_id','team_id','match_day_id','publication_number','board_title_snapshot','published_by_profile_id','published_by_name','published_at','withdrawn_at'])
  || app_private.coach_offline_project(to_jsonb(v),array['game_format','formation_preset_key','pitch_orientation','shirt_kit','placements','bench'])
from public.formation_board_match_publications t join public.formation_board_versions v on v.id=t.board_version_id
where t.club_id=$2 and t.team_id=$3 and app_private.formation_board_can_view($1,t.board_id)$query$;
    when 'notifications' then query_text:=$query$select 'notificationSources'::text as kind,'derived'::text as id,jsonb_build_object('source','device_and_attention','serverInbox',false) as data$query$;
    else raise exception 'coach_offline_resource_unknown' using errcode='22023';
  end case;
  execute 'with source as materialized ('||query_text||'), rows as materialized (
    select kind||'':''||id as row_key,kind,id,data from source), metadata as (
    select count(*) as total,md5(coalesce(string_agg(row_key||data::text,''|'' order by row_key),'''')) as revision from rows),
    page as (select * from rows where row_key>$6 order by row_key limit 200)
    select jsonb_build_object(''items'',coalesce((select jsonb_agg(jsonb_build_object(''kind'',kind,''id'',id,''data'',data) order by row_key) from page),''[]''::jsonb),
      ''totalCount'',metadata.total,''revision'',metadata.revision,''lastKey'',(select max(row_key) from page),
      ''complete'',not exists(select 1 from rows where row_key>coalesce((select max(row_key) from page),$6))) from metadata'
    into result using auth.uid(),club_value,team_value,(authority->>'roleRank')::integer,authority->>'role',after_key;
  if expected_revision is not null and expected_revision is distinct from result->>'revision' then
    raise exception 'coach_offline_snapshot_changed' using errcode='40001'; end if;
  return result - 'lastKey' || jsonb_build_object('schemaVersion',1,'userId',auth.uid(),'clubId',club_value,'teamId',team_value,
    'resourceKey',resource_key,'context',authority,'observedAt',now(),
    'nextCursor',case when (result->>'complete')::boolean then null else jsonb_build_object('actor',auth.uid(),'club',club_value,'team',team_value,
      'resource',resource_key,'revision',result->>'revision','after',result->>'lastKey')::text end);
end;
$$;
revoke all on function public.get_own_coach_offline_resource(uuid,uuid,text,text) from public,anon,service_role;
grant execute on function public.get_own_coach_offline_resource(uuid,uuid,text,text) to authenticated;

create or replace function public.get_coach_offline_file_source(actor_value uuid,club_value uuid,team_value uuid,resource_value uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.role() is distinct from 'service_role'
    or app_private.coach_offline_read_context(actor_value,club_value,team_value) is null
    or not public.can_use_plan_feature(club_value,'resourceLibrary') then
    raise exception 'coach_offline_file_denied' using errcode='42501'; end if;
  select app_private.coach_offline_project(to_jsonb(r),array['id','club_id','team_id','resource_type','storage_bucket','storage_path','mime_type','file_size_bytes','updated_at','expires_at'])
  into result from public.resource_library_items r
  where r.id=resource_value and r.club_id=club_value and r.team_id=team_value
    and r.archived_at is null and ((to_jsonb(r)->>'expires_at') is null or (to_jsonb(r)->>'expires_at')::timestamptz>now())
    and r.storage_bucket='resource-library' and r.storage_path like club_value::text||'/'||team_value::text||'/%'
    and coalesce(to_jsonb(r)->>'resource_type','file')<>'external_link'
    and not exists(select 1 from public.resource_library_external_links e where e.resource_id=r.id);
  if result is null then raise exception 'coach_offline_file_denied' using errcode='42501'; end if;
  return result;
end;
$$;
revoke all on function public.get_coach_offline_file_source(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_coach_offline_file_source(uuid,uuid,uuid,uuid) to service_role;
