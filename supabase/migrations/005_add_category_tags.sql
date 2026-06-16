alter table public.place_classifications
add column if not exists category_tags text[] default '{}';
