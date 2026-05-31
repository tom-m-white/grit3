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
