alter table public.training_availability_request_players
add column if not exists email_queue_id uuid
references public.scheduled_email_queue(id)
on delete set null;

alter table public.training_availability_request_players
add column if not exists delivery_attempt integer not null default 0;

alter table public.training_availability_request_players
add column if not exists invitation_type text not null default 'training_rsvp';

alter table public.training_availability_request_players
add column if not exists response_deadline_at timestamptz;

alter table public.training_availability_request_players
drop constraint if exists training_availability_request_players_delivery_attempt_check;

alter table public.training_availability_request_players
add constraint training_availability_request_players_delivery_attempt_check
check (delivery_attempt >= 0);

create unique index if not exists training_availability_request_players_email_queue_key
on public.training_availability_request_players(email_queue_id)
where email_queue_id is not null;

create index if not exists training_availability_request_players_delivery_state_idx
on public.training_availability_request_players(status, email_queue_id, response_deadline_at);

comment on column public.training_availability_request_players.email_queue_id is
'The current one-minute scheduled email queue job for this Training RSVP recipient.';

comment on column public.training_availability_request_players.delivery_attempt is
'Monotonic delivery generation. Initial send, resend and retry each use a distinct queue id.';

comment on column public.training_availability_request_players.invitation_type is
'Stable invitation identity used with event occurrence, player and recipient for queue idempotency.';

comment on column public.training_availability_request_players.response_deadline_at is
'The current response deadline. Training RSVP responses close when the occurrence starts.';
