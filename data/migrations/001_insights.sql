-- Persistent incremental cache for Meta Ads daily insights.
-- See lib/insights-store.ts for how these tables are used.

-- Immutable once a day is "final" (see SETTLING_WINDOW_DAYS in lib/insights-store.ts).
-- No ad_name, no branch/program — those are derived at read time from ad_name_cache
-- so that renaming an ad retroactively reclassifies all of its historical spend.
create table if not exists ad_daily_metrics (
  account_id   text not null,
  ad_id        text not null,
  date         date not null,
  campaign_id  text,
  ad_set_id    text,
  spend        double precision not null default 0,
  impressions  integer not null default 0,
  clicks       integer not null default 0,
  reach        integer not null default 0,
  inbox        integer not null default 0,
  leads        integer not null default 0,
  fetched_at   timestamptz not null default now(),
  primary key (account_id, ad_id, date)
);

create index if not exists ad_daily_metrics_date_idx on ad_daily_metrics (date);

-- Marks which (account, date) pairs have been fully synced from Meta, so we can
-- tell "no ads spent money that day" apart from "never fetched".
create table if not exists ad_sync_progress (
  account_id text not null,
  date       date not null,
  synced_at  timestamptz not null default now(),
  primary key (account_id, date)
);

-- Always-current ad name/campaign/adset, refreshed cheaply and often (10 min TTL).
-- Joined against ad_daily_metrics at read time so a rename today reclassifies
-- every historical row for that ad_id on the very next request.
create table if not exists ad_name_cache (
  ad_id       text primary key,
  account_id  text not null,
  ad_name     text not null,
  campaign_id text,
  ad_set_id   text,
  updated_at  timestamptz not null default now()
);
