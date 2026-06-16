alter table public.place_classifications
  add column if not exists manual_override boolean default false,
  add column if not exists classification_source text default 'rule',
  add column if not exists ai_raw jsonb,
  add column if not exists ai_model text,
  add column if not exists ai_classified_at timestamptz;

create index if not exists idx_classifications_manual_override on public.place_classifications(manual_override);
create index if not exists idx_classifications_source on public.place_classifications(classification_source);
