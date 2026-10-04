-- T24 "manage my trips" (docs/USER_TESTING.md round 4): delete with undo, edit dates/party, booked.
-- Mirrors tripai.notify.models.PlannedTrip / SavedPick. Applied by the president (Supabase MCP)
-- after merge; do not apply from feature branches. Until it is applied the backend writes the 0006
-- columns only and keeps these in memory (tripai.notify.store: layered writes + merge on read).

alter table trips
  add column if not exists booked_at   timestamptz,          -- status 'booked': past list, not watched
  add column if not exists deleted_at  timestamptz,          -- soft delete; POST /trips/{id}/restore undoes it
  add column if not exists pending     boolean not null default false,  -- dates/party edited, refresh pending
  add column if not exists fit_label   text,                 -- AI fit verdict re-checked after an edit
  add column if not exists fit_summary text;

alter table saved_picks
  add column if not exists deleted_at  timestamptz,          -- the scan skips it; frees the watch slot
  add column if not exists pending     boolean not null default false,
  add column if not exists fit_label   text,
  add column if not exists fit_summary text;

-- trips.status already exists (0001: planned | booked | done | cancelled); make it explicit.
alter table trips drop constraint if exists trips_status_check;
alter table trips add constraint trips_status_check
  check (status in ('planned', 'booked', 'done', 'cancelled'));

-- Server-side access only (SUPABASE_SECRET_KEY bypasses RLS). RLS stays on, NO anon/authenticated policies.
alter table trips       enable row level security;
alter table saved_picks enable row level security;
