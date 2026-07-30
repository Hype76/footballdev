create unique index if not exists training_availability_request_players_upsert_key
on public.training_availability_request_players(request_id, player_id, recipient_email);

comment on index public.training_availability_request_players_upsert_key is
  'Supports the direct training invitation upsert while the case-insensitive recipient key remains authoritative.';
