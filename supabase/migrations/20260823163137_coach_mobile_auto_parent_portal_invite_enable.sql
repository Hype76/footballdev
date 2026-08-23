begin;

alter table public.players
enable trigger zz_players_enqueue_coach_mobile_parent_portal_invites;

comment on function app_private.enqueue_coach_mobile_parent_portal_invites() is
  'Creates one Parent Portal invitation and retryable email job for each valid parent contact when Coach mobile creates an eligible Squad Player.';

commit;
