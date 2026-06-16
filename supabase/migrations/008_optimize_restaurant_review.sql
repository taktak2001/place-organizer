alter table public.place_classifications
add column if not exists restaurant_price_band text;

create index if not exists idx_classifications_main_category_review_status
on public.place_classifications(main_category, restaurant_review_status);

create index if not exists idx_places_is_archived
on public.places(is_archived);
