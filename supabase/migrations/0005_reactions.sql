-- T6 swipe on offers: one reaction per (user, recommendation) (mirrors tripai.scoring.reactions.ReactionRecord).
-- Applied by the president (Supabase MCP) after merge; do not apply from feature branches.
-- user_id is the server-issued session id (tripai.api.session), not a FK: reactions can come before a saved profile.

create table if not exists reactions (
  user_id            text not null,
  recommendation_id  text not null,                   -- "<IATA>-<yyyymmdd>-<yyyymmdd>" (city + dates)
  reaction           text not null check (reaction in ('like', 'dislike', 'love')),
  city               text not null,
  iata               text not null,
  start              date not null,
  "end"              date not null,
  personalized       boolean not null default true,   -- false: recorded only, profile untouched
  diff               jsonb not null default '[]',     -- what the swipe changed and why (same shape as feedback.diff)
  payload            jsonb not null,                  -- full ReactionRecord incl. the undo snapshot
  created_at         timestamptz not null default now(),
  primary key (user_id, recommendation_id)
);
create index if not exists reactions_hidden_idx on reactions(user_id) where reaction = 'dislike';

-- Server-side access only (SUPABASE_SECRET_KEY bypasses RLS). RLS on, NO anon/authenticated policies.
alter table reactions enable row level security;
