-- T13 "My trips": persisted approvals, the latest price check per watched pick, user target prices.
-- Mirrors tripai.notify.models.PlannedTrip / SavedPick. Applied by the president (Supabase MCP)
-- after merge; do not apply from feature branches.

-- Approvals from the confirm page (nothing is booked). user_id is the server-issued session id:
-- a session can approve before its profile row is written, so the FK from 0001 goes (as in 0003/0005).
alter table trips drop constraint if exists trips_user_id_fkey;
alter table trips
  add column if not exists city         text,
  add column if not exists country      text not null default '',
  add column if not exists iata         text,
  add column if not exists start        date,
  add column if not exists "end"        date,
  add column if not exists total_pln    numeric,            -- per person all-in when approved
  add column if not exists price_status text not null default 'exact'
    check (price_status in ('exact', 'partial', 'estimate')),
  add column if not exists travelers    int not null default 1,
  add column if not exists approved_at  timestamptz;
create unique index if not exists trips_user_rec_uidx on trips(user_id, recommendation_id);

-- Watched picks: original price, the user's target, and the scan's latest check.
alter table saved_picks
  add column if not exists saved_pln          numeric,      -- null (older rows) = baseline_pln
  add column if not exists saved_price_status text not null default 'exact',
  add column if not exists travelers          int not null default 1,
  add column if not exists target_pln         numeric check (target_pln is null or target_pln > 0),
  add column if not exists last_pln           numeric,      -- null = not checked / no price now
  add column if not exists last_price_status  text,
  add column if not exists last_checked_at    timestamptz;

-- New notification kind: the user's target price was reached (exact-date prices only).
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('new_top', 'price_drop', 'long_weekend', 'target_price'));

-- Party money model (docs/BUDGET.md, #38/#40): keep the lines, not just the per-person total, so
-- "My trips" renders flights x n + the stay exactly like the card, receipt and confirm.
alter table trips
  add column if not exists flight_pln numeric,              -- per traveller
  add column if not exists hotel_pln  numeric;              -- the whole stay, all rooms
alter table saved_picks
  add column if not exists saved_flight_pln numeric,
  add column if not exists saved_hotel_pln  numeric,
  add column if not exists last_flight_pln  numeric,
  add column if not exists last_hotel_pln   numeric,
  add column if not exists last_travelers   int;

-- Server-side access only (SUPABASE_SECRET_KEY bypasses RLS). RLS stays on, NO anon/authenticated policies.
alter table trips       enable row level security;
alter table saved_picks enable row level security;
