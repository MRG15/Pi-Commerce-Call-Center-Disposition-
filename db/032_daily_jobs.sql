-- Once-a-day jobs (e.g. the 8:30 AM onboarding backlog rebalance): one row per job and IST date,
-- claimed before the job runs so it never runs twice in a day. Additive only.
CREATE TABLE IF NOT EXISTS daily_jobs(
  job TEXT NOT NULL,
  run_date DATE NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result JSONB,
  PRIMARY KEY(job,run_date)
);
