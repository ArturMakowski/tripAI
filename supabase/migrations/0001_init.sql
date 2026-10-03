-- TripAI core schema (mirrors backend/src/tripai/models.py + tripai.api.state.Store).
-- Apply: supabase db push  (or paste into the Supabase SQL editor).

create table if not exists profiles (
  user_id     text primary key,
  profile     jsonb not null,               -- TasteProfile
  weights     jsonb not null default '{"price":0.4,"weather":0.2,"crowds":0.15,"taste":0.25}',
  updated_at  timestamptz not null default now()
);

create table if not exists recommendations (
  id            text not null,               -- "{IATA}-{yyyymmdd}-{yyyymmdd}"
  user_id       text not null references profiles(user_id) on delete cascade,
  inputs_hash   text not null,               -- sha256 of canonical scoring inputs
  rank          int  not null,
  payload       jsonb not null,              -- RankedRecommendation
  created_at    timestamptz not null default now(),
  primary key (user_id, inputs_hash, id)
);
create index if not exists recommendations_id_idx on recommendations(id);

create table if not exists trips (
  id                 uuid primary key default gen_random_uuid(),
  user_id            text not null references profiles(user_id) on delete cascade,
  recommendation_id  text not null,
  status             text not null default 'planned',  -- planned | booked | done | cancelled
  created_at         timestamptz not null default now()
);

create table if not exists feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null references profiles(user_id) on delete cascade,
  trip_id     text not null,
  answers     jsonb not null,
  diff        jsonb not null,                -- list[Change] returned by POST /feedback
  created_at  timestamptz not null default now()
);

-- Connector response cache (T2): every fact keeps its source + fetched_at.
create table if not exists api_cache (
  source      text not null,                 -- "serpapi:google_flights", "open-meteo", ...
  key         text not null,                 -- canonical request key
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  primary key (source, key)
);
