alter table public.parent_player_links
add column if not exists invite_sent_at timestamptz;

delete from public.parent_player_links
where link_type = 'parent'
  and status = 'pending'
  and accepted_at is null
  and auth_user_id is null;
