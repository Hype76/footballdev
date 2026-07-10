create or replace function public.confirm_match_day_availability(
  token_hash_value text,
  status_value text
)
returns table (
  request_id uuid,
  player_name text,
  response_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.match_day_availability_requests%rowtype;
  normalized_status text := trim(coalesce(status_value, ''));
begin
  if normalized_status not in ('available', 'unavailable', 'maybe') then
    raise exception 'Choose a valid availability response.';
  end if;

  select *
  into request_row
  from public.match_day_availability_requests
  where token_hash = token_hash_value
  limit 1;

  if request_row.id is null then
    return;
  end if;

  if request_row.expires_at < timezone('utc', now()) then
    update public.match_day_availability_requests
    set status = 'expired',
        updated_at = timezone('utc', now())
    where id = request_row.id;

    return query
    select request_row.id, request_row.player_name, 'expired'::text;
    return;
  end if;

  update public.match_day_availability_requests
  set status = normalized_status,
      responded_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = request_row.id
  returning id, public.match_day_availability_requests.player_name, public.match_day_availability_requests.status
  into request_id, player_name, response_status;

  return next;
end;
$$;

revoke all on function public.confirm_match_day_availability(text, text) from public;
grant execute on function public.confirm_match_day_availability(text, text) to anon;
grant execute on function public.confirm_match_day_availability(text, text) to authenticated;
