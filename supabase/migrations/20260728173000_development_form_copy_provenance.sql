alter table public.feedback_forms
  add column if not exists source_template_key text,
  add column if not exists source_template_version integer;

update public.feedback_forms
set source_template_key = starter_template_key,
    source_template_version = starter_template_version
where starter_template_key is not null
  and source_template_key is null;

alter table public.feedback_forms
  drop constraint if exists feedback_forms_source_template_pair_check,
  add constraint feedback_forms_source_template_pair_check
  check (
    (source_template_key is null and source_template_version is null)
    or (
      char_length(trim(source_template_key)) > 0
      and source_template_version > 0
    )
  );

create index if not exists feedback_forms_source_template_provenance_idx
on public.feedback_forms (club_id, team_id, source_template_key, source_template_version)
where source_template_key is not null;

create or replace function app_private.validate_feedback_form_copy_provenance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.duplicated_from_id is not null
    and not exists (
      select 1
      from public.feedback_forms source
      where source.id = new.duplicated_from_id
        and source.club_id = new.club_id
        and source.team_id = new.team_id
    )
  then
    raise exception 'Feedback form copy source is outside the authorised team scope.'
      using errcode = '42501';
  end if;

  if new.source_template_key is not null
    and not exists (
      select 1
      from public.feedback_form_starter_templates source
      where source.template_key = new.source_template_key
        and source.version = new.source_template_version
    )
  then
    raise exception 'Feedback form platform source key and version are invalid.'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_feedback_form_copy_provenance
on public.feedback_forms;

create trigger validate_feedback_form_copy_provenance
before insert or update of club_id, team_id, duplicated_from_id, source_template_key, source_template_version
on public.feedback_forms
for each row
execute function app_private.validate_feedback_form_copy_provenance();

comment on column public.feedback_forms.source_template_key is
  'Immutable platform template source key retained when a team duplicates or customises a starter.';

comment on column public.feedback_forms.source_template_version is
  'Immutable platform template source version retained when a team duplicates or customises a starter.';

comment on function app_private.validate_feedback_form_copy_provenance() is
  'Rejects cross-team form-copy references and invalid platform template provenance.';
