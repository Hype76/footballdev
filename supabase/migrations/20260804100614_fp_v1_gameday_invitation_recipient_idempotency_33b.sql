-- FP-V1-GAMEDAY-SQUAD-DECISIONS-RESEND-33B

drop index if exists public.scheduled_email_queue_single_player_invitation_action_key;

create unique index scheduled_email_queue_single_player_invitation_action_key
on public.scheduled_email_queue (
  (payload #>> '{eventPlayerInvitationAction,idempotencyKey}'),
  (lower(btrim(to_email)))
)
where nullif(payload #>> '{eventPlayerInvitationAction,idempotencyKey}', '') is not null
  and nullif(btrim(to_email), '') is not null;

comment on index public.scheduled_email_queue_single_player_invitation_action_key is
  'Allows one queued invitation per explicit action and eligible recipient while blocking duplicate queue work for the same recipient.';
