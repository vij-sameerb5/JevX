-- JevX dataset: what the AI found, and what actually happened to it.
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Security model
--   * jevx clients use the ANON key. With the policies below, anon can only INSERT.
--     It cannot read, update or delete anything, so a leaked anon key can't read the dataset.
--   * You read the data in the dashboard (Table Editor / SQL Editor) or with the service_role
--     key, which bypasses RLS. Never put the service_role key in .env for jevx.
--   * No code, paths, file names, function names or repo names are stored. Repos are random ids.

create extension if not exists pgcrypto;

-- ─── one row per finding the AI assessed ───
create table if not exists public.jevx_findings (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  run_id           text not null check (char_length(run_id) <= 64),
  repo_id          uuid not null,
  jevx_version     text check (char_length(jevx_version) <= 20),
  prompt_version   text check (char_length(prompt_version) <= 20),
  provider         text check (provider in ('xai', 'openrouter', 'mcp')),
  model            text check (char_length(model) <= 80),
  origin           text check (origin in ('ai', 'static')),
  file_ext         text check (char_length(file_ext) <= 8),
  path_kind        text check (path_kind in ('api', 'lib', 'server', 'component', 'page', 'other')),
  is_opportunity   boolean not null,
  primitive        text check (primitive in ('noul', 'choice', 'score', 'none')),
  decision         text check (char_length(decision) <= 200),
  outcome_count    int check (outcome_count between 0 and 50),
  features         jsonb not null default '{}'::jsonb check (pg_column_size(features) <= 2000),
  ai_score         real check (ai_score between 0 and 1),
  pattern_score    real check (pattern_score between 0 and 1),
  typesafe_score   real check (typesafe_score between 0 and 1),
  average          real check (average between 0 and 1),
  verdict          text check (verdict in ('STRONG_FIT', 'POSSIBLE_FIT', 'WEAK_FIT', 'REVIEW_DISAGREE', 'NOT_OPPORTUNITY')),
  status           text check (status in ('strong', 'possible', 'review', 'weak', 'not_opportunity', 'edit_failed', 'failed')),
  result           text check (result in ('changed', 'reverted', 'skipped', 'preview', 'left')),
  result_reason    text check (char_length(result_reason) <= 120),
  checks_before_ok boolean,
  checks_after_ok  boolean
);

create index if not exists jevx_findings_run_idx  on public.jevx_findings (run_id);
create index if not exists jevx_findings_repo_idx on public.jevx_findings (repo_id);
create index if not exists jevx_findings_time_idx on public.jevx_findings (created_at desc);

-- ─── later events for a run (e.g. `jevx undo`) ───
create table if not exists public.jevx_outcomes (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_id     text not null check (char_length(run_id) <= 64),
  repo_id    uuid not null,
  outcome    text not null check (outcome in ('undone', 'kept'))
);

create index if not exists jevx_outcomes_run_idx on public.jevx_outcomes (run_id);

-- ─── insert-only for jevx clients ───
alter table public.jevx_findings enable row level security;
alter table public.jevx_outcomes enable row level security;

revoke all on public.jevx_findings from anon, authenticated;
revoke all on public.jevx_outcomes from anon, authenticated;
grant insert on public.jevx_findings to anon;
grant insert on public.jevx_outcomes to anon;

drop policy if exists "jevx clients insert findings" on public.jevx_findings;
create policy "jevx clients insert findings" on public.jevx_findings
  for insert to anon with check (true);

drop policy if exists "jevx clients insert outcomes" on public.jevx_outcomes;
create policy "jevx clients insert outcomes" on public.jevx_outcomes
  for insert to anon with check (true);

-- ─── the training view: one row per finding, labelled ───
-- label = what we learn from:
--   good      changed, tests passed, not undone
--   bad       reverted by tests, or the user ran `jevx undo`
--   rejected  the AI or the scorecard said no
--   unknown   preview / left / not verified
create or replace view public.jevx_training as
select
  f.*,
  (u.run_id is not null) as undone,
  case
    when f.result = 'changed' and u.run_id is null and coalesce(f.checks_after_ok, false) then 'good'
    when f.result = 'reverted' or (f.result = 'changed' and u.run_id is not null) then 'bad'
    when not f.is_opportunity or f.verdict in ('WEAK_FIT', 'NOT_OPPORTUNITY') then 'rejected'
    else 'unknown'
  end as label
from public.jevx_findings f
left join (select distinct run_id from public.jevx_outcomes where outcome = 'undone') u using (run_id);

-- the view is for you (dashboard / service_role) only
revoke all on public.jevx_training from anon, authenticated;
alter view public.jevx_training set (security_invoker = true);

-- Quick checks after running:
--   select count(*) from jevx_findings;
--   select label, count(*) from jevx_training group by 1;
--   select primitive, path_kind, avg(ai_score), count(*) from jevx_findings where is_opportunity group by 1, 2 order by 4 desc;
