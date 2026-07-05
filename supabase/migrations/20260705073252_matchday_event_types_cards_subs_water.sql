alter table public.match_day_events
  drop constraint if exists match_day_events_type_check;

alter table public.match_day_events
  add constraint match_day_events_type_check check (
    event_type in (
      'goal',
      'score_correction',
      'status_change',
      'note',
      'yellow_card',
      'red_card',
      'substitution',
      'water_break'
    )
  );

alter table public.match_day_event_log
  drop constraint if exists match_day_event_log_event_type_check;

alter table public.match_day_event_log
  add constraint match_day_event_log_event_type_check check (
    event_type in (
      'match_day_created',
      'match_day_updated',
      'player_selected',
      'player_deselected',
      'player_availability_changed',
      'match_role_assigned',
      'match_role_removed',
      'scorer_updated',
      'linesman_updated',
      'invite_prepared',
      'invite_queued',
      'note_updated',
      'yellow_card',
      'red_card',
      'substitution',
      'water_break'
    )
  );
