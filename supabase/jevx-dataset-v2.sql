-- JevX dataset v2: WHERE and WHY Jev fits, as generic patterns (no code, no names).
-- Run once in Supabase → SQL Editor → New query → paste → Run, AFTER jevx-dataset.sql. Safe to re-run.

alter table public.jevx_findings add column if not exists pattern_label   text;
alter table public.jevx_findings add column if not exists input_kind      text;
alter table public.jevx_findings add column if not exists rule_kind       text;
alter table public.jevx_findings add column if not exists rule_shape      text;
alter table public.jevx_findings add column if not exists why_generic     text;
alter table public.jevx_findings add column if not exists failure_example text;
alter table public.jevx_findings add column if not exists min_fit         real;

alter table public.jevx_findings drop constraint if exists jevx_findings_pattern_label_chk;
alter table public.jevx_findings add  constraint jevx_findings_pattern_label_chk
  check (pattern_label is null or (char_length(pattern_label) <= 60 and pattern_label ~ '^[a-z0-9-]+$'));
alter table public.jevx_findings drop constraint if exists jevx_findings_input_kind_chk;
alter table public.jevx_findings add  constraint jevx_findings_input_kind_chk
  check (input_kind is null or input_kind in ('user_text', 'error_message', 'ai_output', 'external_api_results', 'free_text_name', 'structured_app_data', 'other'));
alter table public.jevx_findings drop constraint if exists jevx_findings_rule_kind_chk;
alter table public.jevx_findings add  constraint jevx_findings_rule_kind_chk
  check (rule_kind is null or rule_kind in ('regex', 'keyword_list', 'includes_or_startswith', 'lookup_with_default', 'sort_or_slice', 'threshold', 'if_else_chain', 'switch', 'other'));
alter table public.jevx_findings drop constraint if exists jevx_findings_texts_chk;
alter table public.jevx_findings add  constraint jevx_findings_texts_chk
  check (coalesce(char_length(rule_shape), 0) <= 200 and coalesce(char_length(why_generic), 0) <= 200 and coalesce(char_length(failure_example), 0) <= 200);
alter table public.jevx_findings drop constraint if exists jevx_findings_min_fit_chk;
alter table public.jevx_findings add  constraint jevx_findings_min_fit_chk
  check (min_fit is null or min_fit between 0.5 and 1);

create index if not exists jevx_findings_pattern_idx on public.jevx_findings (pattern_label);

-- ─── training view (now with the pattern columns) ───
drop view if exists public.jevx_patterns;
drop view if exists public.jevx_training;

create view public.jevx_training as
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

-- ─── the patterns JevX learns from: one row per kind of code ───
create view public.jevx_patterns as
select
  pattern_label,
  input_kind,
  rule_kind,
  primitive,
  count(*)                                   as findings,
  count(*) filter (where label = 'good')     as good,
  count(*) filter (where label = 'bad')      as bad,
  count(*) filter (where label = 'rejected') as rejected,
  count(*) filter (where is_opportunity)     as called_opportunity,
  round(avg(ai_score)::numeric, 3)           as avg_ai,
  round(avg(typesafe_score)::numeric, 3)     as avg_typesafe,
  round(avg(pattern_score)::numeric, 3)      as avg_patterns,
  round(avg(average)::numeric, 3)            as avg_fit,
  mode() within group (order by rule_shape)  as typical_shape,
  mode() within group (order by why_generic) as typical_why,
  count(distinct repo_id)                    as repos,
  max(created_at)                            as last_seen
from public.jevx_training
where pattern_label is not null
group by pattern_label, input_kind, rule_kind, primitive;

revoke all on public.jevx_training from anon, authenticated;
revoke all on public.jevx_patterns from anon, authenticated;
alter view public.jevx_training set (security_invoker = true);
alter view public.jevx_patterns set (security_invoker = true);

-- Check:
--   select pattern_label, input_kind, rule_kind, findings, good, bad, typical_why from jevx_patterns order by findings desc;
