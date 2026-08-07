-- Small key/value timestamps for sync bookkeeping that isn't per-(account,date),
-- e.g. when the last full ad-name sweep ran. See lib/insights-store.ts.
create table if not exists sync_meta (
  key        text primary key,
  updated_at timestamptz not null default now()
);
