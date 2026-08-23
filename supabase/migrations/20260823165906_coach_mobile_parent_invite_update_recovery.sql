begin;

create or replace function app_private.normalize_player_parent_invite_emails()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_headers jsonb := '{}'::jsonb;
  client_info text := '';
  candidate_contacts jsonb := '[]'::jsonb;
  normalized_contacts jsonb := '[]'::jsonb;
  parent_contact jsonb;
  raw_email text := '';
  normalized_email text := '';
  contact_key text := '';
  contact_name text := '';
  contact_type text := '';
  seen_contact_keys text[] := array[]::text[];
  merge_existing_mobile_contacts boolean := false;
begin
  begin
    request_headers := coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), ''),
      '{}'
    )::jsonb;
  exception when others then
    request_headers := '{}'::jsonb;
  end;

  client_info := lower(pg_catalog.btrim(coalesce(request_headers ->> 'x-client-info', '')));
  merge_existing_mobile_contacts :=
    tg_op = 'UPDATE'
    and client_info like 'supabase-js-react-native/%'
    and auth.uid() is not null
    and lower(pg_catalog.btrim(coalesce(new.contact_type, 'parent'))) in ('parent', 'both');

  raw_email := coalesce(new.parent_email, '');
  normalized_email := app_private.normalize_parent_invite_email(raw_email);

  if raw_email <> normalized_email
    and normalized_email ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$' then
    new.parent_email := normalized_email;
  end if;

  if pg_catalog.jsonb_typeof(coalesce(new.parent_contacts, '[]'::jsonb)) = 'array' then
    candidate_contacts := coalesce(new.parent_contacts, '[]'::jsonb);
  end if;

  if merge_existing_mobile_contacts
    and pg_catalog.jsonb_typeof(coalesce(old.parent_contacts, '[]'::jsonb)) = 'array' then
    candidate_contacts := candidate_contacts || coalesce(old.parent_contacts, '[]'::jsonb);
  end if;

  for parent_contact in
    select contact.value
    from pg_catalog.jsonb_array_elements(candidate_contacts) contact(value)
  loop
    if pg_catalog.jsonb_typeof(parent_contact) <> 'object' then
      continue;
    end if;

    raw_email := coalesce(parent_contact ->> 'email', parent_contact ->> 'parentEmail', '');
    normalized_email := app_private.normalize_parent_invite_email(raw_email);
    contact_name := pg_catalog.btrim(coalesce(parent_contact ->> 'name', parent_contact ->> 'parentName', ''));
    contact_type := lower(pg_catalog.btrim(coalesce(parent_contact ->> 'type', parent_contact ->> 'contactType', 'parent')));

    if normalized_email ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$' then
      if parent_contact ? 'email' then
        parent_contact := pg_catalog.jsonb_set(
          parent_contact,
          '{email}',
          pg_catalog.to_jsonb(normalized_email),
          false
        );
      end if;

      if parent_contact ? 'parentEmail' then
        parent_contact := pg_catalog.jsonb_set(
          parent_contact,
          '{parentEmail}',
          pg_catalog.to_jsonb(normalized_email),
          false
        );
      end if;

      contact_key := concat('email:', normalized_email);
    elsif pg_catalog.btrim(raw_email) <> '' then
      contact_key := concat('invalid-email:', lower(pg_catalog.btrim(raw_email)));
    elsif contact_name <> '' then
      contact_key := concat('name:', lower(contact_name), ':', contact_type);
    else
      continue;
    end if;

    if contact_key = any(seen_contact_keys) then
      continue;
    end if;

    seen_contact_keys := pg_catalog.array_append(seen_contact_keys, contact_key);
    normalized_contacts := normalized_contacts || pg_catalog.jsonb_build_array(parent_contact);
  end loop;

  new.parent_contacts := normalized_contacts;

  if (
      coalesce(new.parent_email, '') !~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
    ) and pg_catalog.jsonb_array_length(normalized_contacts) > 0 then
    select
      nullif(contact.value ->> 'email', ''),
      nullif(pg_catalog.btrim(coalesce(contact.value ->> 'name', contact.value ->> 'parentName', '')), '')
    into new.parent_email, new.parent_name
    from pg_catalog.jsonb_array_elements(normalized_contacts) contact(value)
    where coalesce(contact.value ->> 'email', contact.value ->> 'parentEmail', '')
      ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
    limit 1;
  end if;

  return new;
end;
$$;

alter function app_private.normalize_player_parent_invite_emails() owner to postgres;
revoke all on function app_private.normalize_player_parent_invite_emails()
from public, anon, authenticated;

drop trigger if exists zz_players_enqueue_coach_mobile_parent_portal_invites
on public.players;

create trigger zz_players_enqueue_coach_mobile_parent_portal_invites
after insert or update of parent_email, parent_contacts, section, status, contact_type
on public.players
for each row execute function app_private.enqueue_coach_mobile_parent_portal_invites();

comment on function app_private.normalize_player_parent_invite_emails() is
  'Canonicalizes Parent contact emails and, for Coach mobile edits, appends a newly entered Parent contact without overwriting existing contacts.';

comment on function app_private.enqueue_coach_mobile_parent_portal_invites() is
  'Creates retryable Parent Portal invitations after eligible Coach mobile Player creation or after a mobile contact correction, while preserving recipient and queue idempotency.';

commit;
