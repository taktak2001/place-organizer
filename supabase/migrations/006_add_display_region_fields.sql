alter table public.place_classifications
add column if not exists region_group text,
add column if not exists region_filter_label text,
add column if not exists region_sort_order integer;

create index if not exists idx_classifications_display_region
on public.place_classifications(region_group, region_filter_label, region_sort_order);
