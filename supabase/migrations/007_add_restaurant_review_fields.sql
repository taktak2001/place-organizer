alter table public.place_classifications
  add column if not exists restaurant_review_status text default 'unreviewed',
  add column if not exists restaurant_review_reason text,
  add column if not exists restaurant_quality_flags text[] default '{}',
  add column if not exists restaurant_notes text,
  add column if not exists restaurant_reviewed_at timestamptz,
  add column if not exists restaurant_reviewed_by text;

create index if not exists idx_classifications_restaurant_review_status
on public.place_classifications(main_category, restaurant_review_status);

create index if not exists idx_classifications_restaurant_quality_flags
on public.place_classifications using gin(restaurant_quality_flags);
