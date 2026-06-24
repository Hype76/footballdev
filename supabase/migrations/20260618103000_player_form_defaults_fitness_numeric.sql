-- PLAYER-FORM-DEFAULTS-01
-- Updates default form field definitions only. Historical evaluation responses are not rewritten.

update public.form_fields
set
  type = 'number',
  options = '[]'::jsonb,
  include_in_progress_chart = false
where coalesce(is_default, false) = true
  and lower(label) in ('2k run', '5k run', '10k run', 'bleep test');

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
  clubs.id,
  default_fields.label,
  default_fields.type,
  default_fields.options,
  default_fields.required,
  default_fields.order_index,
  true,
  default_fields.is_enabled,
  default_fields.include_in_progress_chart
from public.clubs
cross join (
  values
    ('2k run', 'number', '[]'::jsonb, false, 9, false, false),
    ('5k run', 'number', '[]'::jsonb, false, 10, false, false),
    ('10k run', 'number', '[]'::jsonb, false, 11, false, false),
    ('Bleep Test', 'number', '[]'::jsonb, false, 12, false, false)
) as default_fields(label, type, options, required, order_index, is_enabled, include_in_progress_chart)
where not exists (
  select 1
  from public.form_fields existing_fields
  where existing_fields.club_id = clubs.id
    and coalesce(existing_fields.is_default, false) = true
    and lower(existing_fields.label) = lower(default_fields.label)
);

drop policy if exists form_fields_update_scoped on public.form_fields;
create policy form_fields_update_scoped
on public.form_fields
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() <> 'admin'
    and public.current_user_role() <> 'parent_portal'
    and public.current_user_role_rank() >= 20
    and form_fields.club_id = public.current_user_club_id()
    and public.can_use_plan_feature(form_fields.club_id, 'custom_form_fields')
    and (
      (
        coalesce(form_fields.is_default, false) = true
        and form_fields.team_id is null
      )
      or (
        coalesce(form_fields.is_default, false) = false
        and (
          form_fields.team_id is null
          or exists (
            select 1
            from public.team_staff ts
            where ts.team_id = form_fields.team_id
              and ts.user_id = auth.uid()
          )
        )
      )
    )
  )
)
with check (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() <> 'admin'
    and public.current_user_role() <> 'parent_portal'
    and public.current_user_role_rank() >= 20
    and form_fields.club_id = public.current_user_club_id()
    and public.can_use_plan_feature(form_fields.club_id, 'custom_form_fields')
    and (
      (
        coalesce(form_fields.is_default, false) = true
        and form_fields.team_id is null
      )
      or (
        coalesce(form_fields.is_default, false) = false
        and form_fields.team_id is not null
        and exists (
          select 1
          from public.team_staff ts
          where ts.team_id = form_fields.team_id
            and ts.user_id = auth.uid()
        )
      )
    )
  )
);

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
    default_fields.is_enabled,
    default_fields.include_in_progress_chart
  from (
    values
      ('Technical', 'score_1_10', '[1,2,3,4,5,6,7,8,9,10]'::jsonb, true, 1, true, true),
      ('Tactical', 'score_1_10', '[1,2,3,4,5,6,7,8,9,10]'::jsonb, true, 2, true, true),
      ('Physical', 'score_1_10', '[1,2,3,4,5,6,7,8,9,10]'::jsonb, true, 3, true, true),
      ('Mentality', 'score_1_10', '[1,2,3,4,5,6,7,8,9,10]'::jsonb, true, 4, true, true),
      ('Coachability', 'score_1_10', '[1,2,3,4,5,6,7,8,9,10]'::jsonb, true, 5, true, true),
      ('Strengths', 'textarea', '[]'::jsonb, false, 6, true, false),
      ('Improvements', 'textarea', '[]'::jsonb, false, 7, true, false),
      ('Overall Comments', 'textarea', '[]'::jsonb, true, 8, true, false),
      ('2k run', 'number', '[]'::jsonb, false, 9, false, false),
      ('5k run', 'number', '[]'::jsonb, false, 10, false, false),
      ('10k run', 'number', '[]'::jsonb, false, 11, false, false),
      ('Bleep Test', 'number', '[]'::jsonb, false, 12, false, false)
  ) as default_fields(label, type, options, required, order_index, is_enabled, include_in_progress_chart)
  where not exists (
    select 1
    from public.form_fields existing_fields
    where existing_fields.club_id = target_club_id
      and coalesce(existing_fields.is_default, false) = true
      and lower(existing_fields.label) = lower(default_fields.label)
  );
end;
$$;

grant execute on function public.seed_default_form_fields() to authenticated;
