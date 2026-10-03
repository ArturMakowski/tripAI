-- T5b proactive scan + notifications (mirrors backend/src/tripai/notify/models.py).
-- Applied by the president (Supabase MCP) after merge; do not apply from feature branches.
-- user_id is not a FK to profiles: a user can set prefs / subscribe before finishing the interview.
-- DBOS keeps its own workflow state in the `dbos` schema (created by DBOS.launch, not exposed via PostgREST).

create table if not exists notification_prefs (
  user_id       text primary key,
  push_opt_in   boolean not null default false,       -- explicit opt-in, set only by a user tap
  max_per_week  int not null default 3 check (max_per_week between 0 and 50),
  muted_cities  text[] not null default '{}',          -- city names or IATA codes
  snooze_until  timestamptz,
  updated_at    timestamptz not null default now()
);

create table if not exists push_subscriptions (
  user_id     text not null,
  endpoint    text not null,                           -- browser push service URL
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, endpoint)
);

create table if not exists scan_runs (
  id           text primary key,
  user_id      text not null,
  mode         text not null,                          -- dbos | sync
  trigger      text not null default 'manual',         -- manual | scheduled (only manual = activity)
  workflow_id  text,                                   -- DBOS workflow id (dbos.workflow_status)
  top_id       text,                                   -- #1 recommendation id this run
  inputs_hash  text,
  payload      jsonb not null,                         -- ScanRun incl. every rule decision
  started_at   timestamptz not null,
  finished_at  timestamptz,
  error        text
);
create index if not exists scan_runs_user_idx on scan_runs(user_id, finished_at desc);
create index if not exists scan_runs_active_idx on scan_runs(trigger, started_at desc);

create table if not exists notifications (
  id                 text primary key,
  user_id            text not null,
  kind               text not null check (kind in ('new_top', 'price_drop', 'long_weekend')),
  title              text not null,
  body               text not null,
  recommendation_id  text not null,
  inputs_hash        text not null,                   -- reproduces the ranking behind the numbers
  dedupe_key         text not null,
  scan_run_id        text,                            -- scan_runs.id (no FK: the run row is written last)
  payload            jsonb not null,                  -- Notification: why, evidence, score, fit, card
  created_at         timestamptz not null default now(),
  read_at            timestamptz,
  pushed_at          timestamptz,
  unique (user_id, dedupe_key)
);
create index if not exists notifications_user_idx on notifications(user_id, created_at desc);

-- Watched picks for the price-drop rule; baseline = the last real price we showed the user.
create table if not exists saved_picks (
  user_id              text not null,
  recommendation_id    text not null,
  city                 text not null,
  iata                 text not null,
  start                date not null,
  "end"                date not null,
  baseline_pln         numeric not null,
  baseline_source      text not null,
  baseline_fetched_at  timestamptz not null,
  saved_at             timestamptz not null default now(),
  primary key (user_id, recommendation_id)
);

-- Server-side access only (SUPABASE_SECRET_KEY bypasses RLS). RLS on, NO anon/authenticated
-- policies: push endpoints and keys are never readable with the public key.
alter table notification_prefs enable row level security;
alter table push_subscriptions enable row level security;
alter table scan_runs          enable row level security;
alter table notifications      enable row level security;
alter table saved_picks        enable row level security;
