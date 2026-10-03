-- Backend language (pl | en): notification titles/bodies are written at scan time in the
-- user's language, saved by POST /scan/run and PUT /notifications/prefs.
-- Apply BEFORE deploying the backend that writes `lang` (otherwise prefs upserts are rejected).
alter table notification_prefs
  add column if not exists lang text not null default 'en' check (lang in ('en', 'pl'));
