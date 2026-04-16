alter table public.clubs
  add column if not exists logo_url text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text;
