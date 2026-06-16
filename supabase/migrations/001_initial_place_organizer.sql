create extension if not exists pgcrypto;

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  normalized_key text unique,
  google_place_id text unique,
  name text not null,
  address text,
  latitude double precision,
  longitude double precision,
  google_maps_url text,
  website_url text,
  phone_number text,
  rating numeric,
  user_ratings_total integer,
  price_level integer,
  business_status text,
  primary_type text,
  types text[],
  photo_references text[],
  regular_opening_hours jsonb,
  current_opening_hours jsonb,
  raw_google jsonb,
  raw_import jsonb,
  enrichment_status text default 'pending_enrichment',
  last_enriched_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.place_classifications (
  id uuid primary key default gen_random_uuid(),
  place_id uuid references public.places(id) on delete cascade,
  main_category text,
  sub_category text,
  scene_tags text[],
  country text,
  prefecture text,
  city text,
  ward text,
  area_label text,
  nearest_station text,
  travel_region text,
  priority text,
  visited_status text default 'want',
  confidence numeric,
  reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(place_id)
);

create table if not exists public.source_links (
  id uuid primary key default gen_random_uuid(),
  place_id uuid references public.places(id) on delete cascade,
  source_type text not null,
  source_file text,
  source_url text,
  source_list_name text,
  memo text,
  active boolean default true,
  imported_at timestamptz default now(),
  unique(place_id, source_type, source_list_name)
);

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_type text,
  filename text,
  file_hash text unique,
  status text,
  total_count integer default 0,
  parsed_count integer default 0,
  inserted_count integer default 0,
  updated_count integer default 0,
  duplicate_count integer default 0,
  error_count integer default 0,
  logs jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.google_takeout_snapshots (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references public.import_batches(id) on delete cascade,
  filename text,
  file_hash text unique,
  imported_at timestamptz default now(),
  total_count integer default 0,
  raw_manifest jsonb
);

create table if not exists public.google_takeout_snapshot_items (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid references public.google_takeout_snapshots(id) on delete cascade,
  source_list_name text,
  source_file text,
  normalized_key text,
  name text,
  address text,
  google_maps_url text,
  latitude double precision,
  longitude double precision,
  raw jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_places_name on public.places using gin (to_tsvector('simple', name));
create index if not exists idx_places_normalized_key on public.places(normalized_key);
create index if not exists idx_source_links_place_id on public.source_links(place_id);
create index if not exists idx_source_links_list on public.source_links(source_list_name);
create index if not exists idx_classifications_main_category on public.place_classifications(main_category);
create index if not exists idx_classifications_area on public.place_classifications(area_label, travel_region);
create index if not exists idx_snapshot_items_snapshot on public.google_takeout_snapshot_items(snapshot_id);
create index if not exists idx_snapshot_items_key on public.google_takeout_snapshot_items(normalized_key);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_places_updated_at on public.places;
create trigger set_places_updated_at
before update on public.places
for each row execute function public.set_updated_at();

drop trigger if exists set_place_classifications_updated_at on public.place_classifications;
create trigger set_place_classifications_updated_at
before update on public.place_classifications
for each row execute function public.set_updated_at();

drop trigger if exists set_import_batches_updated_at on public.import_batches;
create trigger set_import_batches_updated_at
before update on public.import_batches
for each row execute function public.set_updated_at();

alter table public.places enable row level security;
alter table public.place_classifications enable row level security;
alter table public.source_links enable row level security;
alter table public.import_batches enable row level security;
alter table public.google_takeout_snapshots enable row level security;
alter table public.google_takeout_snapshot_items enable row level security;

create policy "Read places with anon key" on public.places for select using (true);
create policy "Read classifications with anon key" on public.place_classifications for select using (true);
create policy "Read source links with anon key" on public.source_links for select using (true);
create policy "Read import batches with anon key" on public.import_batches for select using (true);
