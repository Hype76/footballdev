-- Promotion is a transition into the active Squad, not a permanent player status.
-- Keep the promotion audit timestamps while repairing only current Squad players.

update public.players
set
  status = 'active',
  updated_at = timezone('utc'::text, now())
where section = 'Squad'
  and status = 'promoted'
  and archived_at is null;
