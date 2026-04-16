insert into public.users (id, email, name, role, club_id, created_at)
select
  au.id,
  coalesce(au.email, ''),
  nullif(trim(coalesce(au.raw_user_meta_data ->> 'name', '')), ''),
  case
    when lower(coalesce(au.email, '')) = lower('hype76@btopenworld.com') then 'super_admin'
    else 'coach'
  end,
  null,
  coalesce(au.created_at, timezone('utc', now()))
from auth.users au
left join public.users pu
  on pu.id = au.id
where pu.id is null;

update public.users
set email = coalesce(nullif(email, ''), lower('hype76@btopenworld.com'))
where id = '4be137e3-6f8e-4dea-8874-654afdf435dd'
  and (email is null or email = '');
