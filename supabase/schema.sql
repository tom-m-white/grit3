create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[A-Za-z0-9_]{3,32}$'),
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create table if not exists public.benchmark_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  total_elapsed_ms integer,
  current_question_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.benchmark_question_records (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.benchmark_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  weight integer not null default 1 check (weight between 1 and 5),
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'correct', 'wrong')),
  final_correct boolean,
  first_submission_correct boolean,
  submission_count integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  elapsed_ms integer,
  draft_outputs jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, question_id)
);

create table if not exists public.human_submissions (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.benchmark_question_records(id) on delete cascade,
  run_id uuid not null references public.benchmark_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  submission_index integer not null,
  submitted_at timestamptz not null default now(),
  question_elapsed_ms integer not null,
  time_since_previous_submission_ms integer not null,
  outputs jsonb not null,
  correct boolean not null,
  unique (record_id, submission_index)
);

create table if not exists public.created_questions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  task jsonb not null,
  review_status text not null default 'draft' check (review_status in ('draft', 'submitted', 'needs_changes', 'verified', 'rejected')),
  reviewer_notes text not null default '',
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewer_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.search_public_profiles(query_text text)
returns table (
  username text,
  role text,
  completed_run_count integer,
  best_correct_weight integer,
  best_total_weight integer,
  latest_correct_weight integer,
  latest_total_weight integer,
  created_draft_count integer,
  created_submitted_count integer,
  created_needs_changes_count integer,
  created_verified_count integer,
  created_rejected_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select trim(coalesce(query_text, '')) as value
  ),
  matches as (
    select p.id, p.username, p.role
    from public.profiles p, normalized n
    where char_length(n.value) >= 2
      and p.username ilike ('%' || n.value || '%')
    order by
      case
        when lower(p.username) = lower(n.value) then 0
        when p.username ilike (n.value || '%') then 1
        else 2
      end,
      p.username
    limit 8
  ),
  completed_scores as (
    select
      br.user_id,
      br.id,
      br.completed_at,
      coalesce(sum(case when bqr.final_correct is true then bqr.weight else 0 end), 0)::integer as correct_weight,
      coalesce(sum(bqr.weight), 0)::integer as total_weight
    from public.benchmark_runs br
    join public.benchmark_question_records bqr on bqr.run_id = br.id
    where br.status = 'completed'
      and br.user_id in (select id from matches)
    group by br.user_id, br.id, br.completed_at
  ),
  run_counts as (
    select user_id, count(*)::integer as completed_run_count
    from completed_scores
    group by user_id
  ),
  best_scores as (
    select distinct on (user_id)
      user_id,
      correct_weight as best_correct_weight,
      total_weight as best_total_weight
    from completed_scores
    order by
      user_id,
      case when total_weight > 0 then correct_weight::numeric / total_weight else 0 end desc,
      completed_at desc nulls last
  ),
  latest_scores as (
    select distinct on (user_id)
      user_id,
      correct_weight as latest_correct_weight,
      total_weight as latest_total_weight
    from completed_scores
    order by user_id, completed_at desc nulls last
  ),
  created_counts as (
    select
      owner_id,
      count(*) filter (where review_status = 'draft')::integer as created_draft_count,
      count(*) filter (where review_status = 'submitted')::integer as created_submitted_count,
      count(*) filter (where review_status = 'needs_changes')::integer as created_needs_changes_count,
      count(*) filter (where review_status = 'verified')::integer as created_verified_count,
      count(*) filter (where review_status = 'rejected')::integer as created_rejected_count
    from public.created_questions
    where owner_id in (select id from matches)
    group by owner_id
  )
  select
    m.username,
    m.role,
    coalesce(rc.completed_run_count, 0)::integer,
    coalesce(bs.best_correct_weight, 0)::integer,
    coalesce(bs.best_total_weight, 0)::integer,
    coalesce(ls.latest_correct_weight, 0)::integer,
    coalesce(ls.latest_total_weight, 0)::integer,
    coalesce(cc.created_draft_count, 0)::integer,
    coalesce(cc.created_submitted_count, 0)::integer,
    coalesce(cc.created_needs_changes_count, 0)::integer,
    coalesce(cc.created_verified_count, 0)::integer,
    coalesce(cc.created_rejected_count, 0)::integer
  from matches m
  left join run_counts rc on rc.user_id = m.id
  left join best_scores bs on bs.user_id = m.id
  left join latest_scores ls on ls.user_id = m.id
  left join created_counts cc on cc.owner_id = m.id;
$$;

create or replace function public.get_public_profile(username_text text)
returns table (
  username text,
  role text,
  completed_run_count integer,
  best_correct_weight integer,
  best_total_weight integer,
  latest_correct_weight integer,
  latest_total_weight integer,
  created_draft_count integer,
  created_submitted_count integer,
  created_needs_changes_count integer,
  created_verified_count integer,
  created_rejected_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select p.id, p.username, p.role
    from public.profiles p
    where lower(p.username) = lower(trim(coalesce(username_text, '')))
    order by p.username
    limit 1
  ),
  completed_scores as (
    select
      br.user_id,
      br.id,
      br.completed_at,
      coalesce(sum(case when bqr.final_correct is true then bqr.weight else 0 end), 0)::integer as correct_weight,
      coalesce(sum(bqr.weight), 0)::integer as total_weight
    from public.benchmark_runs br
    join public.benchmark_question_records bqr on bqr.run_id = br.id
    where br.status = 'completed'
      and br.user_id in (select id from target)
    group by br.user_id, br.id, br.completed_at
  ),
  run_counts as (
    select user_id, count(*)::integer as completed_run_count
    from completed_scores
    group by user_id
  ),
  best_scores as (
    select distinct on (user_id)
      user_id,
      correct_weight as best_correct_weight,
      total_weight as best_total_weight
    from completed_scores
    order by
      user_id,
      case when total_weight > 0 then correct_weight::numeric / total_weight else 0 end desc,
      completed_at desc nulls last
  ),
  latest_scores as (
    select distinct on (user_id)
      user_id,
      correct_weight as latest_correct_weight,
      total_weight as latest_total_weight
    from completed_scores
    order by user_id, completed_at desc nulls last
  ),
  created_counts as (
    select
      owner_id,
      count(*) filter (where review_status = 'draft')::integer as created_draft_count,
      count(*) filter (where review_status = 'submitted')::integer as created_submitted_count,
      count(*) filter (where review_status = 'needs_changes')::integer as created_needs_changes_count,
      count(*) filter (where review_status = 'verified')::integer as created_verified_count,
      count(*) filter (where review_status = 'rejected')::integer as created_rejected_count
    from public.created_questions
    where owner_id in (select id from target)
    group by owner_id
  )
  select
    t.username,
    t.role,
    coalesce(rc.completed_run_count, 0)::integer,
    coalesce(bs.best_correct_weight, 0)::integer,
    coalesce(bs.best_total_weight, 0)::integer,
    coalesce(ls.latest_correct_weight, 0)::integer,
    coalesce(ls.latest_total_weight, 0)::integer,
    coalesce(cc.created_draft_count, 0)::integer,
    coalesce(cc.created_submitted_count, 0)::integer,
    coalesce(cc.created_needs_changes_count, 0)::integer,
    coalesce(cc.created_verified_count, 0)::integer,
    coalesce(cc.created_rejected_count, 0)::integer
  from target t
  left join run_counts rc on rc.user_id = t.id
  left join best_scores bs on bs.user_id = t.id
  left join latest_scores ls on ls.user_id = t.id
  left join created_counts cc on cc.owner_id = t.id;
$$;

revoke all on function public.search_public_profiles(text) from public, anon;
revoke all on function public.get_public_profile(text) from public, anon;
grant execute on function public.search_public_profiles(text) to authenticated;
grant execute on function public.get_public_profile(text) to authenticated;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists benchmark_runs_set_updated_at on public.benchmark_runs;
create trigger benchmark_runs_set_updated_at
before update on public.benchmark_runs
for each row execute function public.set_updated_at();

drop trigger if exists benchmark_question_records_set_updated_at on public.benchmark_question_records;
create trigger benchmark_question_records_set_updated_at
before update on public.benchmark_question_records
for each row execute function public.set_updated_at();

drop trigger if exists created_questions_set_updated_at on public.created_questions;
create trigger created_questions_set_updated_at
before update on public.created_questions
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.benchmark_runs enable row level security;
alter table public.benchmark_question_records enable row level security;
alter table public.human_submissions enable row level security;
alter table public.created_questions enable row level security;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles for select
using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
with check (id = auth.uid() and role = 'user');

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
on public.profiles for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "benchmark_runs_owner_all" on public.benchmark_runs;
create policy "benchmark_runs_owner_all"
on public.benchmark_runs for all
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "benchmark_question_records_owner_all" on public.benchmark_question_records;
create policy "benchmark_question_records_owner_all"
on public.benchmark_question_records for all
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "human_submissions_owner_all" on public.human_submissions;
create policy "human_submissions_owner_all"
on public.human_submissions for all
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "created_questions_owner_or_admin_select" on public.created_questions;
create policy "created_questions_owner_or_admin_select"
on public.created_questions for select
using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "created_questions_owner_insert" on public.created_questions;
create policy "created_questions_owner_insert"
on public.created_questions for insert
with check (owner_id = auth.uid());

drop policy if exists "created_questions_owner_update_drafts" on public.created_questions;
create policy "created_questions_owner_update_drafts"
on public.created_questions for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid() and review_status in ('draft', 'submitted'));

drop policy if exists "created_questions_admin_update" on public.created_questions;
create policy "created_questions_admin_update"
on public.created_questions for update
using (public.is_admin())
with check (public.is_admin());

create index if not exists benchmark_runs_user_status_idx on public.benchmark_runs(user_id, status, started_at desc);
create index if not exists benchmark_records_run_idx on public.benchmark_question_records(run_id, question_id);
create index if not exists human_submissions_run_idx on public.human_submissions(run_id, submitted_at);
create index if not exists created_questions_owner_idx on public.created_questions(owner_id, updated_at desc);
create index if not exists created_questions_review_idx on public.created_questions(review_status, updated_at desc);
