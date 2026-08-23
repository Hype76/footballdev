begin;

create or replace function app_private.normalize_parent_invite_email(raw_email text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(coalesce(raw_email, '')),
      '[[:space:]]+',
      '',
      'g'
    )
  );
$$;

alter function app_private.normalize_parent_invite_email(text) owner to postgres;
revoke all on function app_private.normalize_parent_invite_email(text)
from public, anon, authenticated;

create or replace function app_private.normalize_player_parent_invite_emails()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_contact jsonb;
  normalized_contacts jsonb := '[]'::jsonb;
  raw_email text := '';
  normalized_email text := '';
begin
  raw_email := coalesce(new.parent_email, '');
  normalized_email := app_private.normalize_parent_invite_email(raw_email);

  if raw_email <> normalized_email
    and normalized_email ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$' then
    new.parent_email := normalized_email;
  end if;

  if pg_catalog.jsonb_typeof(coalesce(new.parent_contacts, '[]'::jsonb)) = 'array' then
    for parent_contact in
      select contact.value
      from pg_catalog.jsonb_array_elements(new.parent_contacts) contact(value)
    loop
      if pg_catalog.jsonb_typeof(parent_contact) = 'object' and parent_contact ? 'email' then
        raw_email := coalesce(parent_contact ->> 'email', '');
        normalized_email := app_private.normalize_parent_invite_email(raw_email);

        if raw_email <> normalized_email
          and normalized_email ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$' then
          parent_contact := pg_catalog.jsonb_set(
            parent_contact,
            '{email}',
            pg_catalog.to_jsonb(normalized_email),
            false
          );
        end if;
      end if;

      if pg_catalog.jsonb_typeof(parent_contact) = 'object' and parent_contact ? 'parentEmail' then
        raw_email := coalesce(parent_contact ->> 'parentEmail', '');
        normalized_email := app_private.normalize_parent_invite_email(raw_email);

        if raw_email <> normalized_email
          and normalized_email ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$' then
          parent_contact := pg_catalog.jsonb_set(
            parent_contact,
            '{parentEmail}',
            pg_catalog.to_jsonb(normalized_email),
            false
          );
        end if;
      end if;

      normalized_contacts := normalized_contacts || pg_catalog.jsonb_build_array(parent_contact);
    end loop;

    new.parent_contacts := normalized_contacts;
  end if;

  return new;
end;
$$;

alter function app_private.normalize_player_parent_invite_emails() owner to postgres;
revoke all on function app_private.normalize_player_parent_invite_emails()
from public, anon, authenticated;

drop trigger if exists zy_players_normalize_parent_invite_emails
on public.players;

create trigger zy_players_normalize_parent_invite_emails
before insert or update of parent_email, parent_contacts on public.players
for each row execute function app_private.normalize_player_parent_invite_emails();

comment on function app_private.normalize_player_parent_invite_emails() is
  'Canonicalizes valid Parent contact email addresses when whitespace or letter casing would otherwise suppress Coach mobile automatic Parent Portal invites.';

commit;
