alter table public.form_fields
  add column if not exists include_in_progress_chart boolean not null default false;

update public.form_fields
set include_in_progress_chart = true
where coalesce(is_default, false) = true
  and type in ('score_1_5', 'score_1_10')
  and lower(label) in (
    'technical',
    'tactical',
    'physical',
    'mentality',
    'coachability'
  );

update public.form_fields
set include_in_progress_chart = false
where type not in ('score_1_5', 'score_1_10');

create or replace function public.seed_default_form_fields()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_club_id uuid := public.current_user_club_id();
begin
  if target_club_id is null then
    return;
  end if;

  insert into public.form_fields (
    club_id,
    label,
    type,
    options,
    required,
    order_index,
    is_default,
    is_enabled,
    include_in_progress_chart
  )
  select
    target_club_id,
    default_fields.label,
    default_fields.type,
    default_fields.options,
    default_fields.required,
    default_fields.order_index,
    true,
    true,
    default_fields.include_in_progress_chart
  from (
    values
      ('Technical', 'score_1_5', '[]'::jsonb, true, 1, true),
      ('Tactical', 'score_1_5', '[]'::jsonb, true, 2, true),
      ('Physical', 'score_1_5', '[]'::jsonb, true, 3, true),
      ('Mentality', 'score_1_5', '[]'::jsonb, true, 4, true),
      ('Coachability', 'score_1_5', '[]'::jsonb, true, 5, true),
      ('Strengths', 'textarea', '[]'::jsonb, false, 6, false),
      ('Improvements', 'textarea', '[]'::jsonb, false, 7, false),
      ('Overall Comments', 'textarea', '[]'::jsonb, true, 8, false)
  ) as default_fields(label, type, options, required, order_index, include_in_progress_chart)
  where not exists (
    select 1
    from public.form_fields existing_fields
    where existing_fields.club_id = target_club_id
      and lower(existing_fields.label) = lower(default_fields.label)
  );
end;
$$;

grant execute on function public.seed_default_form_fields() to authenticated;
