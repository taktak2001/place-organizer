alter table places
  add column if not exists normalized_place_id text,
  add column if not exists place_id_confidence text,
  add column if not exists place_id_normalized_at timestamptz,
  add column if not exists place_id_review_reason text,
  add column if not exists place_id_candidate jsonb;

create index if not exists places_place_id_confidence_idx
  on places(place_id_confidence);
