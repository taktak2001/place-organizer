alter table public.places
  add column if not exists is_archived boolean default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text;

create index if not exists idx_places_archive on public.places(is_archived, archive_reason);
create index if not exists idx_places_business_status on public.places(business_status);
