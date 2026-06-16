alter table public.place_classifications
  add column if not exists tags_review_status text default 'unreviewed',
  add column if not exists tags_reviewed_at timestamptz,
  add column if not exists tags_review_note text;

create index if not exists idx_classifications_tags_review_status
on public.place_classifications(main_category, tags_review_status);
