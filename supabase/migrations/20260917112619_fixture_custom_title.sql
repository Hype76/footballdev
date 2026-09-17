-- Optional custom title. Empty titles retain the automatic club/opponent display.
alter table public.match_days add column if not exists title text not null default '';
comment on column public.match_days.title is 'Optional staff-edited fixture title; blank uses club and opponent names.';
