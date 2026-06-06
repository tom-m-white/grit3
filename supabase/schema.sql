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
  weight numeric(3,1) not null default 1 check (weight between 0.5 and 5.5 and weight * 2 = floor(weight * 2)),
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

alter table public.benchmark_question_records
  drop constraint if exists benchmark_question_records_weight_check;

alter table public.benchmark_question_records
  alter column weight type numeric(3,1) using weight::numeric,
  alter column weight set default 1;

alter table public.benchmark_question_records
  add constraint benchmark_question_records_weight_check
  check (weight between 0.5 and 5.5 and weight * 2 = floor(weight * 2));

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

drop function if exists public.search_public_profiles(text);
drop function if exists public.get_public_profile(text);

create or replace function public.search_public_profiles(query_text text)
returns table (
  username text,
  role text,
  completed_run_count integer,
  best_correct_weight numeric,
  best_total_weight numeric,
  latest_correct_weight numeric,
  latest_total_weight numeric,
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
      coalesce(sum(case when bqr.final_correct is true then bqr.weight else 0 end), 0)::numeric as correct_weight,
      coalesce(sum(bqr.weight), 0)::numeric as total_weight
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
    coalesce(bs.best_correct_weight, 0)::numeric,
    coalesce(bs.best_total_weight, 0)::numeric,
    coalesce(ls.latest_correct_weight, 0)::numeric,
    coalesce(ls.latest_total_weight, 0)::numeric,
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
  best_correct_weight numeric,
  best_total_weight numeric,
  latest_correct_weight numeric,
  latest_total_weight numeric,
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
      coalesce(sum(case when bqr.final_correct is true then bqr.weight else 0 end), 0)::numeric as correct_weight,
      coalesce(sum(bqr.weight), 0)::numeric as total_weight
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
    coalesce(bs.best_correct_weight, 0)::numeric,
    coalesce(bs.best_total_weight, 0)::numeric,
    coalesce(ls.latest_correct_weight, 0)::numeric,
    coalesce(ls.latest_total_weight, 0)::numeric,
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

revoke all on function public.search_public_profiles(text) from public;
revoke all on function public.get_public_profile(text) from public;
-- These summary RPCs back public profile lookup and must work before login.
grant usage on schema public to anon, authenticated;
grant usage on schema public to public;
grant execute on function public.search_public_profiles(text) to anon, authenticated;
grant execute on function public.get_public_profile(text) to anon, authenticated;
grant execute on function public.search_public_profiles(text) to public;
grant execute on function public.get_public_profile(text) to public;

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

drop policy if exists "created_questions_owner_delete" on public.created_questions;
create policy "created_questions_owner_delete"
on public.created_questions for delete
using (owner_id = auth.uid());

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

create table if not exists public.duel_challenges (
  id uuid primary key default gen_random_uuid(),
  challenger_id uuid not null references auth.users(id) on delete cascade,
  challenged_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'active', 'completed', 'declined', 'cancelled')),
  attempt_mode text not null default 'one' check (attempt_mode in ('one', 'unlimited')),
  started_at timestamptz,
  completed_at timestamptz,
  winner_id uuid references auth.users(id) on delete set null,
  win_reason text check (win_reason in ('correct', 'opponent_wrong', 'forfeit', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (challenger_id <> challenged_id)
);

create table if not exists public.duel_tasks (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.duel_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  task jsonb not null,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (challenge_id, user_id)
);

create table if not exists public.duel_player_states (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.duel_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'solving', 'won', 'lost')),
  draft_outputs jsonb,
  submission_count integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  elapsed_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (challenge_id, user_id)
);

create table if not exists public.duel_submissions (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.duel_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  submission_index integer not null,
  submitted_at timestamptz not null default now(),
  elapsed_ms integer not null,
  outputs jsonb not null,
  correct boolean not null,
  unique (challenge_id, user_id, submission_index)
);

drop trigger if exists duel_challenges_set_updated_at on public.duel_challenges;
create trigger duel_challenges_set_updated_at
before update on public.duel_challenges
for each row execute function public.set_updated_at();

drop trigger if exists duel_tasks_set_updated_at on public.duel_tasks;
create trigger duel_tasks_set_updated_at
before update on public.duel_tasks
for each row execute function public.set_updated_at();

drop trigger if exists duel_player_states_set_updated_at on public.duel_player_states;
create trigger duel_player_states_set_updated_at
before update on public.duel_player_states
for each row execute function public.set_updated_at();

alter table public.duel_challenges enable row level security;
alter table public.duel_tasks enable row level security;
alter table public.duel_player_states enable row level security;
alter table public.duel_submissions enable row level security;

drop policy if exists "duel_challenges_participant_select" on public.duel_challenges;
create policy "duel_challenges_participant_select"
on public.duel_challenges for select
using (challenger_id = auth.uid() or challenged_id = auth.uid() or public.is_admin());

drop policy if exists "duel_tasks_participant_select" on public.duel_tasks;
create policy "duel_tasks_participant_select"
on public.duel_tasks for select
using (
  exists (
    select 1
    from public.duel_challenges dc
    where dc.id = challenge_id
      and (dc.challenger_id = auth.uid() or dc.challenged_id = auth.uid() or public.is_admin())
  )
);

drop policy if exists "duel_player_states_participant_select" on public.duel_player_states;
create policy "duel_player_states_participant_select"
on public.duel_player_states for select
using (
  exists (
    select 1
    from public.duel_challenges dc
    where dc.id = challenge_id
      and (dc.challenger_id = auth.uid() or dc.challenged_id = auth.uid() or public.is_admin())
  )
);

drop policy if exists "duel_submissions_participant_select" on public.duel_submissions;
create policy "duel_submissions_participant_select"
on public.duel_submissions for select
using (
  exists (
    select 1
    from public.duel_challenges dc
    where dc.id = challenge_id
      and (dc.challenger_id = auth.uid() or dc.challenged_id = auth.uid() or public.is_admin())
  )
);

create unique index if not exists duel_challenges_open_pair_idx
on public.duel_challenges (
  least(challenger_id, challenged_id),
  greatest(challenger_id, challenged_id)
)
where status in ('pending', 'accepted', 'active');

create index if not exists duel_challenges_challenger_idx on public.duel_challenges(challenger_id, updated_at desc);
create index if not exists duel_challenges_challenged_idx on public.duel_challenges(challenged_id, updated_at desc);
create index if not exists duel_tasks_challenge_user_idx on public.duel_tasks(challenge_id, user_id);
create index if not exists duel_player_states_challenge_user_idx on public.duel_player_states(challenge_id, user_id);
create index if not exists duel_submissions_challenge_user_idx on public.duel_submissions(challenge_id, user_id, submitted_at);

create or replace function public.create_duel_challenge(challenged_username text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer_id uuid := auth.uid();
  target_id uuid;
  existing_id uuid;
  created_id uuid;
begin
  if viewer_id is null then
    raise exception 'Sign in to create a challenge.';
  end if;

  select p.id into target_id
  from public.profiles p
  where lower(p.username) = lower(trim(coalesce(challenged_username, '')))
  limit 1;

  if target_id is null then
    raise exception 'Profile not found.';
  end if;

  if target_id = viewer_id then
    raise exception 'You cannot challenge yourself.';
  end if;

  select dc.id into existing_id
  from public.duel_challenges dc
  where dc.status in ('pending', 'accepted', 'active')
    and (
      (dc.challenger_id = viewer_id and dc.challenged_id = target_id)
      or (dc.challenger_id = target_id and dc.challenged_id = viewer_id)
    )
  order by dc.updated_at desc
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.duel_challenges (challenger_id, challenged_id)
  values (viewer_id, target_id)
  returning id into created_id;

  return created_id;
end;
$$;

create or replace function public.list_duel_challenges()
returns table (
  id uuid,
  status text,
  attempt_mode text,
  challenger_id uuid,
  challenger_username text,
  challenged_id uuid,
  challenged_username text,
  opponent_id uuid,
  opponent_username text,
  role text,
  viewer_task_uploaded boolean,
  opponent_task_uploaded boolean,
  viewer_state_status text,
  opponent_state_status text,
  viewer_submission_count integer,
  opponent_submission_count integer,
  started_at timestamptz,
  completed_at timestamptz,
  winner_id uuid,
  winner_username text,
  win_reason text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with viewer as (
    select auth.uid() as id
  )
  select
    dc.id,
    dc.status,
    dc.attempt_mode,
    dc.challenger_id,
    challenger.username as challenger_username,
    dc.challenged_id,
    challenged.username as challenged_username,
    case when dc.challenger_id = viewer.id then dc.challenged_id else dc.challenger_id end as opponent_id,
    case when dc.challenger_id = viewer.id then challenged.username else challenger.username end as opponent_username,
    case when dc.challenger_id = viewer.id then 'challenger' else 'challenged' end as role,
    (viewer_task.id is not null) as viewer_task_uploaded,
    (opponent_task.id is not null) as opponent_task_uploaded,
    viewer_state.status as viewer_state_status,
    opponent_state.status as opponent_state_status,
    coalesce(viewer_state.submission_count, 0)::integer as viewer_submission_count,
    coalesce(opponent_state.submission_count, 0)::integer as opponent_submission_count,
    dc.started_at,
    dc.completed_at,
    dc.winner_id,
    winner.username as winner_username,
    dc.win_reason,
    dc.created_at,
    dc.updated_at
  from public.duel_challenges dc
  join viewer on viewer.id is not null
  join public.profiles challenger on challenger.id = dc.challenger_id
  join public.profiles challenged on challenged.id = dc.challenged_id
  left join public.profiles winner on winner.id = dc.winner_id
  left join public.duel_tasks viewer_task on viewer_task.challenge_id = dc.id and viewer_task.user_id = viewer.id
  left join public.duel_tasks opponent_task on opponent_task.challenge_id = dc.id
    and opponent_task.user_id = case when dc.challenger_id = viewer.id then dc.challenged_id else dc.challenger_id end
  left join public.duel_player_states viewer_state on viewer_state.challenge_id = dc.id and viewer_state.user_id = viewer.id
  left join public.duel_player_states opponent_state on opponent_state.challenge_id = dc.id
    and opponent_state.user_id = case when dc.challenger_id = viewer.id then dc.challenged_id else dc.challenger_id end
  where dc.challenger_id = viewer.id or dc.challenged_id = viewer.id
  order by
    case dc.status
      when 'active' then 0
      when 'accepted' then 1
      when 'pending' then 2
      else 3
    end,
    dc.updated_at desc
  limit 100;
$$;

create or replace function public.get_duel_challenge(challenge_uuid uuid)
returns table (
  id uuid,
  status text,
  attempt_mode text,
  challenger_id uuid,
  challenger_username text,
  challenged_id uuid,
  challenged_username text,
  opponent_id uuid,
  opponent_username text,
  role text,
  viewer_task_uploaded boolean,
  opponent_task_uploaded boolean,
  viewer_state_status text,
  opponent_state_status text,
  viewer_submission_count integer,
  opponent_submission_count integer,
  started_at timestamptz,
  completed_at timestamptz,
  winner_id uuid,
  winner_username text,
  win_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  opponent_task jsonb,
  viewer_draft_outputs jsonb,
  viewer_started_at timestamptz,
  viewer_completed_at timestamptz,
  viewer_elapsed_ms integer
)
language sql
stable
security definer
set search_path = public
as $$
  with viewer as (
    select auth.uid() as id
  )
  select
    dc.id,
    dc.status,
    dc.attempt_mode,
    dc.challenger_id,
    challenger.username as challenger_username,
    dc.challenged_id,
    challenged.username as challenged_username,
    case when dc.challenger_id = viewer.id then dc.challenged_id else dc.challenger_id end as opponent_id,
    case when dc.challenger_id = viewer.id then challenged.username else challenger.username end as opponent_username,
    case when dc.challenger_id = viewer.id then 'challenger' else 'challenged' end as role,
    (viewer_task.id is not null) as viewer_task_uploaded,
    (opponent_task.id is not null) as opponent_task_uploaded,
    viewer_state.status as viewer_state_status,
    opponent_state.status as opponent_state_status,
    coalesce(viewer_state.submission_count, 0)::integer as viewer_submission_count,
    coalesce(opponent_state.submission_count, 0)::integer as opponent_submission_count,
    dc.started_at,
    dc.completed_at,
    dc.winner_id,
    winner.username as winner_username,
    dc.win_reason,
    dc.created_at,
    dc.updated_at,
    case when dc.status in ('active', 'completed') then opponent_task.task else null end as opponent_task,
    viewer_state.draft_outputs as viewer_draft_outputs,
    viewer_state.started_at as viewer_started_at,
    viewer_state.completed_at as viewer_completed_at,
    viewer_state.elapsed_ms as viewer_elapsed_ms
  from public.duel_challenges dc
  join viewer on viewer.id is not null
  join public.profiles challenger on challenger.id = dc.challenger_id
  join public.profiles challenged on challenged.id = dc.challenged_id
  left join public.profiles winner on winner.id = dc.winner_id
  left join public.duel_tasks viewer_task on viewer_task.challenge_id = dc.id and viewer_task.user_id = viewer.id
  left join public.duel_tasks opponent_task on opponent_task.challenge_id = dc.id
    and opponent_task.user_id = case when dc.challenger_id = viewer.id then dc.challenged_id else dc.challenger_id end
  left join public.duel_player_states viewer_state on viewer_state.challenge_id = dc.id and viewer_state.user_id = viewer.id
  left join public.duel_player_states opponent_state on opponent_state.challenge_id = dc.id
    and opponent_state.user_id = case when dc.challenger_id = viewer.id then dc.challenged_id else dc.challenger_id end
  where dc.id = challenge_uuid
    and (dc.challenger_id = viewer.id or dc.challenged_id = viewer.id);
$$;

create or replace function public.respond_duel_challenge(challenge_uuid uuid, accepted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer_id uuid := auth.uid();
  target public.duel_challenges%rowtype;
begin
  if viewer_id is null then
    raise exception 'Sign in to respond to a challenge.';
  end if;

  select * into target
  from public.duel_challenges
  where id = challenge_uuid
  for update;

  if not found or target.challenged_id <> viewer_id then
    raise exception 'Challenge not found.';
  end if;

  if target.status <> 'pending' then
    return;
  end if;

  if accepted then
    update public.duel_challenges
    set status = 'accepted'
    where id = challenge_uuid;

    insert into public.duel_player_states (challenge_id, user_id, status)
    values
      (challenge_uuid, target.challenger_id, 'waiting'),
      (challenge_uuid, target.challenged_id, 'waiting')
    on conflict (challenge_id, user_id) do nothing;
  else
    update public.duel_challenges
    set status = 'declined',
        completed_at = now()
    where id = challenge_uuid;
  end if;
end;
$$;

create or replace function public.set_duel_attempt_mode(challenge_uuid uuid, next_attempt_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer_id uuid := auth.uid();
  target public.duel_challenges%rowtype;
begin
  if viewer_id is null then
    raise exception 'Sign in to update a challenge.';
  end if;

  if next_attempt_mode not in ('one', 'unlimited') then
    raise exception 'Invalid attempt mode.';
  end if;

  select * into target
  from public.duel_challenges
  where id = challenge_uuid
  for update;

  if not found or target.challenger_id <> viewer_id then
    raise exception 'Only the challenger can change attempts.';
  end if;

  if target.status not in ('pending', 'accepted') then
    return;
  end if;

  update public.duel_challenges
  set attempt_mode = next_attempt_mode
  where id = challenge_uuid;
end;
$$;

create or replace function public.upload_duel_task(challenge_uuid uuid, task_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer_id uuid := auth.uid();
  target public.duel_challenges%rowtype;
  task_count integer;
  started timestamptz;
begin
  if viewer_id is null then
    raise exception 'Sign in to upload a challenge task.';
  end if;

  select * into target
  from public.duel_challenges
  where id = challenge_uuid
  for update;

  if not found or (target.challenger_id <> viewer_id and target.challenged_id <> viewer_id) then
    raise exception 'Challenge not found.';
  end if;

  if target.status <> 'accepted' then
    raise exception 'Tasks can only be uploaded in the waiting room.';
  end if;

  insert into public.duel_tasks (challenge_id, user_id, task, uploaded_at)
  values (challenge_uuid, viewer_id, task_payload, now())
  on conflict (challenge_id, user_id) do update
    set task = excluded.task,
        uploaded_at = excluded.uploaded_at;

  insert into public.duel_player_states (challenge_id, user_id, status)
  values
    (challenge_uuid, target.challenger_id, 'waiting'),
    (challenge_uuid, target.challenged_id, 'waiting')
  on conflict (challenge_id, user_id) do nothing;

  select count(*)::integer into task_count
  from public.duel_tasks
  where challenge_id = challenge_uuid
    and user_id in (target.challenger_id, target.challenged_id);

  if task_count = 2 then
    started := now();
    update public.duel_challenges
    set status = 'active',
        started_at = coalesce(started_at, started)
    where id = challenge_uuid;

    update public.duel_player_states
    set status = 'solving',
        started_at = coalesce(started_at, started)
    where challenge_id = challenge_uuid;
  end if;
end;
$$;

create or replace function public.save_duel_draft(challenge_uuid uuid, draft_outputs jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer_id uuid := auth.uid();
begin
  if viewer_id is null then
    raise exception 'Sign in to save a challenge draft.';
  end if;

  update public.duel_player_states dps
  set draft_outputs = save_duel_draft.draft_outputs
  from public.duel_challenges dc
  where dps.challenge_id = dc.id
    and dc.id = challenge_uuid
    and dc.status = 'active'
    and dps.user_id = viewer_id
    and (dc.challenger_id = viewer_id or dc.challenged_id = viewer_id);
end;
$$;

create or replace function public.record_duel_submission(challenge_uuid uuid, submitted_outputs jsonb, correct boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer_id uuid := auth.uid();
  target public.duel_challenges%rowtype;
  viewer_state public.duel_player_states%rowtype;
  opponent_id uuid;
  next_submission_index integer;
  submitted timestamptz := now();
  elapsed integer;
  next_winner_id uuid;
  next_win_reason text;
begin
  if viewer_id is null then
    raise exception 'Sign in to submit a challenge answer.';
  end if;

  select * into target
  from public.duel_challenges
  where id = challenge_uuid
  for update;

  if not found or (target.challenger_id <> viewer_id and target.challenged_id <> viewer_id) then
    raise exception 'Challenge not found.';
  end if;

  if target.status = 'completed' then
    return;
  end if;

  if target.status <> 'active' then
    raise exception 'This challenge is not active.';
  end if;

  opponent_id := case when target.challenger_id = viewer_id then target.challenged_id else target.challenger_id end;

  select * into viewer_state
  from public.duel_player_states
  where challenge_id = challenge_uuid
    and user_id = viewer_id
  for update;

  if not found or viewer_state.status <> 'solving' then
    return;
  end if;

  next_submission_index := viewer_state.submission_count + 1;
  elapsed := greatest(0, floor(extract(epoch from (submitted - coalesce(viewer_state.started_at, target.started_at, submitted))) * 1000)::integer);

  insert into public.duel_submissions (
    challenge_id,
    user_id,
    submission_index,
    submitted_at,
    elapsed_ms,
    outputs,
    correct
  )
  values (
    challenge_uuid,
    viewer_id,
    next_submission_index,
    submitted,
    elapsed,
    submitted_outputs,
    record_duel_submission.correct
  );

  if record_duel_submission.correct then
    next_winner_id := viewer_id;
    next_win_reason := 'correct';
  elsif target.attempt_mode = 'one' then
    next_winner_id := opponent_id;
    next_win_reason := 'opponent_wrong';
  else
    update public.duel_player_states
    set submission_count = next_submission_index,
        draft_outputs = submitted_outputs
    where challenge_id = challenge_uuid
      and user_id = viewer_id;
    return;
  end if;

  update public.duel_challenges
  set status = 'completed',
      completed_at = submitted,
      winner_id = next_winner_id,
      win_reason = next_win_reason
  where id = challenge_uuid;

  update public.duel_player_states
  set status = case when user_id = next_winner_id then 'won' else 'lost' end,
      submission_count = case when user_id = viewer_id then next_submission_index else submission_count end,
      draft_outputs = case when user_id = viewer_id then submitted_outputs else draft_outputs end,
      completed_at = submitted,
      elapsed_ms = greatest(0, floor(extract(epoch from (submitted - coalesce(started_at, target.started_at, submitted))) * 1000)::integer)
  where challenge_id = challenge_uuid
    and user_id in (viewer_id, opponent_id);
end;
$$;

revoke all on function public.create_duel_challenge(text) from public;
revoke all on function public.list_duel_challenges() from public;
revoke all on function public.get_duel_challenge(uuid) from public;
revoke all on function public.respond_duel_challenge(uuid, boolean) from public;
revoke all on function public.set_duel_attempt_mode(uuid, text) from public;
revoke all on function public.upload_duel_task(uuid, jsonb) from public;
revoke all on function public.save_duel_draft(uuid, jsonb) from public;
revoke all on function public.record_duel_submission(uuid, jsonb, boolean) from public;
grant execute on function public.create_duel_challenge(text) to authenticated;
grant execute on function public.list_duel_challenges() to authenticated;
grant execute on function public.get_duel_challenge(uuid) to authenticated;
grant execute on function public.respond_duel_challenge(uuid, boolean) to authenticated;
grant execute on function public.set_duel_attempt_mode(uuid, text) to authenticated;
grant execute on function public.upload_duel_task(uuid, jsonb) to authenticated;
grant execute on function public.save_duel_draft(uuid, jsonb) to authenticated;
grant execute on function public.record_duel_submission(uuid, jsonb, boolean) to authenticated;
