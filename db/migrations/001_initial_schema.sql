-- =====================================================================
-- Yaxha Academics: initial database schema
-- Works on any PostgreSQL 15+ database, including Supabase.
--
-- Security model (read this once):
--   * The web app connects with your database user, but every query that
--     touches study data runs as the restricted role "yaxha_app" with the
--     signed-in user's id stored in the setting "app.user_id".
--   * Row Level Security (RLS) policies below only let "yaxha_app" see rows
--     whose user_id matches that setting. So even a bug in the app code
--     cannot leak one user's data to another user.
--   * Supabase's public API roles (anon, authenticated) get no access at all.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Restricted application role
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'yaxha_app') then
    create role yaxha_app nologin;
  end if;
end $$;

grant yaxha_app to current_user;
grant usage on schema public to yaxha_app;

-- The id of the signed-in user for the current transaction (or null).
create or replace function app_uid() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;
grant execute on function app_uid() to yaxha_app;

-- Keeps updated_at fresh.
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Accounts and authentication (server-only tables)
-- ---------------------------------------------------------------------
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  password_hash text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index users_email_unique on users (lower(email));

create table sessions (
  id_hash     text primary key,              -- sha256 of the cookie value; the raw value is never stored
  user_id     uuid not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id);

create table login_attempts (
  id          bigserial primary key,
  email       text not null,
  ip          text,
  success     boolean not null,
  created_at  timestamptz not null default now()
);
create index login_attempts_email_idx on login_attempts (lower(email), created_at desc);

-- ---------------------------------------------------------------------
-- Profile and preferences
-- ---------------------------------------------------------------------
create table profiles (
  user_id     uuid primary key references users(id) on delete cascade,
  full_name   text not null default '',
  school      text not null default '',
  program     text not null default '',
  year_level  text not null default '',
  updated_at  timestamptz not null default now()
);

create table user_preferences (
  user_id               uuid primary key references users(id) on delete cascade,
  timezone              text not null default 'Asia/Manila',
  daily_target_minutes  integer not null default 120 check (daily_target_minutes between 15 and 960),
  session_minutes       integer not null default 45 check (session_minutes between 10 and 180),
  break_minutes         integer not null default 10 check (break_minutes between 0 and 60),
  available_days        smallint[] not null default '{1,2,3,4,5,6}',  -- 0 = Sunday ... 6 = Saturday
  preferred_start       time not null default '19:00',
  preferred_end         time not null default '22:00',
  reminders_enabled     boolean not null default false,
  onboarding_done       boolean not null default false,
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Google Classroom integration
-- ---------------------------------------------------------------------
create table integrations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  provider         text not null check (provider in ('google_classroom')),
  status           text not null default 'not_connected' check (status in (
                     'not_connected', 'authorization_required', 'connected', 'syncing',
                     'synced', 'partial', 'permission_required', 'failed')),
  account_email    text,
  granted_scopes   text[] not null default '{}',
  last_sync_at     timestamptz,
  last_sync_status text,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, provider)
);

-- OAuth tokens live in their own table that the restricted app role cannot read.
-- Tokens are encrypted (AES-256-GCM) by the server before they are stored.
create table oauth_tokens (
  integration_id      uuid primary key references integrations(id) on delete cascade,
  user_id             uuid not null references users(id) on delete cascade,
  access_token_enc    text,
  refresh_token_enc   text,
  expires_at          timestamptz,
  updated_at          timestamptz not null default now()
);

create table oauth_states (
  state_hash        text primary key,
  user_id           uuid not null references users(id) on delete cascade,
  code_verifier_enc text not null,
  created_at        timestamptz not null default now()
);

create table sync_runs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  integration_id     uuid not null references integrations(id) on delete cascade,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  status             text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  courses_found      integer not null default 0,
  subjects_created   integer not null default 0,
  items_imported     integer not null default 0,
  items_updated      integer not null default 0,
  issues             jsonb not null default '[]'
);
create index sync_runs_user_idx on sync_runs (user_id, started_at desc);

-- ---------------------------------------------------------------------
-- Subjects and topics
-- ---------------------------------------------------------------------
create table subjects (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  display_name        text not null check (length(display_name) between 1 and 200),
  source_provider     text not null default 'manual' check (source_provider in ('manual', 'google_classroom')),
  source_course_id    text,
  source_course_name  text,
  source_section      text,
  source_description  text,
  source_teacher      text,
  source_course_state text,
  source_link         text,
  -- active: fine; archived: archived in Classroom; unavailable: no longer returned by Classroom
  source_status       text not null default 'active' check (source_status in ('active', 'archived', 'unavailable')),
  name_customized     boolean not null default false,
  hidden              boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (source_provider = 'manual' or source_course_id is not null)
);
-- One subject per Classroom course per user, matched by the stable course id (never by name).
create unique index subjects_source_unique on subjects (user_id, source_provider, source_course_id)
  where source_course_id is not null;
create index subjects_user_idx on subjects (user_id);

create table topics (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  subject_id       uuid not null references subjects(id) on delete cascade,
  name             text not null check (length(name) between 1 and 200),
  source_topic_id  text,
  importance       smallint not null default 3 check (importance between 1 and 5),
  created_at       timestamptz not null default now()
);
create unique index topics_source_unique on topics (subject_id, source_topic_id) where source_topic_id is not null;
create index topics_subject_idx on topics (subject_id);

-- ---------------------------------------------------------------------
-- Assignments and materials
-- ---------------------------------------------------------------------
create table assignments (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  subject_id         uuid not null references subjects(id) on delete cascade,
  topic_id           uuid references topics(id) on delete set null,
  title              text not null,
  instructions       text,
  due_at             timestamptz,
  max_points         numeric,
  work_type          text,
  submission_state   text,
  origin             text not null default 'manual' check (origin in ('imported', 'manual')),
  source_key         text,
  source_url         text,
  source_updated_at  timestamptz,
  source_removed     boolean not null default false,
  completed          boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index assignments_source_unique on assignments (user_id, source_key) where source_key is not null;
create index assignments_due_idx on assignments (user_id, due_at);

create table materials (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  subject_id         uuid not null references subjects(id) on delete cascade,
  topic_id           uuid references topics(id) on delete set null,
  assignment_id      uuid references assignments(id) on delete set null,
  title              text not null,
  description        text,
  kind               text not null check (kind in (
                       'pdf', 'google_doc', 'google_sheet', 'google_slides', 'docx', 'pptx',
                       'image', 'video', 'link', 'text', 'form', 'other')),
  origin             text not null check (origin in ('imported', 'uploaded', 'note')),
  source_item_type   text check (source_item_type in ('courseWorkMaterial', 'courseWork', 'announcement')),
  source_key         text,       -- stable composite id of the Classroom item + attachment
  source_url         text,
  drive_file_id      text,
  mime_type          text,
  posted_at          timestamptz,
  source_updated_at  timestamptz,
  source_revision    text,       -- Drive modifiedTime of the stored copy
  due_at             timestamptz,
  access_status      text not null default 'ok' check (access_status in (
                       'ok', 'not_downloaded', 'permission_required', 'unsupported', 'error')),
  processing_status  text not null default 'not_applicable' check (processing_status in (
                       'pending', 'ready', 'failed', 'unsupported', 'not_applicable')),
  processing_error   text,
  content_hash       text,
  source_removed     boolean not null default false,
  seen_by_user       boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index materials_source_unique on materials (user_id, source_key) where source_key is not null;
create index materials_subject_idx on materials (subject_id, posted_at desc);

-- Uploaded or downloaded file bytes (kept separate so listing materials stays fast).
create table material_files (
  material_id  uuid primary key references materials(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  filename     text not null,
  mime_type    text not null,
  size_bytes   integer not null,
  sha256       text not null,
  bytes        bytea not null,
  created_at   timestamptz not null default now()
);

-- Text extracted from a material, page by page where the format has pages.
create table material_contents (
  material_id     uuid primary key references materials(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  extractor       text not null,
  pages           jsonb not null default '[]',   -- [{ "label": "Page 1", "text": "..." }]
  char_count      integer not null default 0,
  page_count      integer not null default 0,
  truncated       boolean not null default false,
  content_hash    text not null,
  extracted_at    timestamptz not null default now()
);

create table material_versions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  material_id        uuid not null references materials(id) on delete cascade,
  source_updated_at  timestamptz,
  content_hash       text,
  detected_at        timestamptz not null default now()
);
create index material_versions_material_idx on material_versions (material_id, detected_at desc);

-- ---------------------------------------------------------------------
-- Exams, plans, tasks, sessions
-- ---------------------------------------------------------------------
create table exams (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references users(id) on delete cascade,
  subject_id             uuid not null references subjects(id) on delete cascade,
  title                  text not null,
  exam_at                timestamptz not null,
  difficulty             smallint not null default 3 check (difficulty between 1 and 5),
  confidence             smallint not null default 3 check (confidence between 1 and 5),
  hours_per_day          numeric(4,2) not null default 2 check (hours_per_day > 0 and hours_per_day <= 16),
  unavailable_dates      date[] not null default '{}',
  notes                  text,
  status                 text not null default 'upcoming' check (status in ('upcoming', 'done', 'cancelled')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index exams_user_idx on exams (user_id, exam_at);

create table exam_topics (
  exam_id     uuid not null references exams(id) on delete cascade,
  topic_id    uuid not null references topics(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  difficulty  smallint not null default 3 check (difficulty between 1 and 5),
  confidence  smallint not null default 3 check (confidence between 1 and 5),
  primary key (exam_id, topic_id)
);

create table study_plans (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  exam_id       uuid references exams(id) on delete cascade,
  kind          text not null check (kind in ('exam', 'daily')),
  plan_date     date,
  warnings      jsonb not null default '[]',
  generated_at  timestamptz not null default now()
);
create unique index study_plans_daily_unique on study_plans (user_id, plan_date) where kind = 'daily';

create table study_tasks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  plan_id           uuid references study_plans(id) on delete set null,
  exam_id           uuid references exams(id) on delete cascade,
  subject_id        uuid references subjects(id) on delete cascade,
  topic_id          uuid references topics(id) on delete set null,
  assignment_id     uuid references assignments(id) on delete set null,
  title             text not null,
  kind              text not null check (kind in (
                      'learn', 'practice', 'review', 'flashcards', 'mock_exam', 'assignment', 'custom')),
  scheduled_date    date not null,
  duration_minutes  integer not null check (duration_minutes between 5 and 480),
  priority          smallint not null default 3 check (priority between 1 and 5),
  reason            text not null default '',
  status            text not null default 'pending' check (status in (
                      'pending', 'done', 'skipped', 'deferred', 'missed')),
  completed_at      timestamptz,
  rescheduled_from  date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index study_tasks_date_idx on study_tasks (user_id, scheduled_date);

create table study_sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  subject_id        uuid references subjects(id) on delete set null,
  topic_id          uuid references topics(id) on delete set null,
  task_id           uuid references study_tasks(id) on delete set null,
  kind              text not null default 'study',
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  duration_minutes  integer not null default 0 check (duration_minutes between 0 and 720),
  notes             text
);
create index study_sessions_user_idx on study_sessions (user_id, started_at desc);

-- ---------------------------------------------------------------------
-- Study packs: summaries, quizzes, flashcards
-- ---------------------------------------------------------------------
create table summaries (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  subject_id          uuid not null references subjects(id) on delete cascade,
  topic_id            uuid references topics(id) on delete set null,
  title               text not null,
  mode                text not null check (mode in (
                        'quick_overview', 'detailed_reviewer', 'exam_focused', 'formula_sheet',
                        'beginner', 'derivation', 'concepts_mistakes')),
  body_md             text not null,
  source_material_ids uuid[] not null default '{}',
  source_coverage     jsonb not null default '[]',  -- what part of each source was actually used
  source_hash         text,                         -- hash of the source text used, for staleness checks
  generation_key      text,                         -- prevents duplicate generations
  model               text,
  edited              boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index summaries_generation_unique on summaries (user_id, generation_key) where generation_key is not null;
create index summaries_subject_idx on summaries (subject_id, created_at desc);

create table quizzes (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  subject_id          uuid not null references subjects(id) on delete cascade,
  topic_id            uuid references topics(id) on delete set null,
  title               text not null,
  config              jsonb not null default '{}',
  source_material_ids uuid[] not null default '{}',
  source_summary_id   uuid references summaries(id) on delete set null,
  source_coverage     jsonb not null default '[]',
  source_hash         text,
  generation_key      text,
  model               text,
  created_at          timestamptz not null default now()
);
create unique index quizzes_generation_unique on quizzes (user_id, generation_key) where generation_key is not null;

create table quiz_questions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  quiz_id            uuid not null references quizzes(id) on delete cascade,
  position           integer not null,
  qtype              text not null check (qtype in (
                       'multiple_choice', 'true_false', 'short_answer', 'numerical', 'formula', 'multi_step')),
  prompt             text not null,
  choices            jsonb,                 -- for multiple choice: ["...", "..."]
  answer             jsonb not null,        -- { "choice": 1 } | { "value": true } | { "value": 12.5, "unit": "m", "tolerance_pct": 1 } | { "text": "..." }
  solution_md        text not null default '',
  rubric             text,
  topic_name         text,
  topic_id           uuid references topics(id) on delete set null,
  difficulty         text,
  verification       text not null default 'not_applicable' check (verification in (
                       'verified', 'mismatch', 'unverified', 'not_applicable')),
  verification_note  text,
  unique (quiz_id, position)
);

create table quiz_attempts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  quiz_id        uuid not null references quizzes(id) on delete cascade,
  mode           text not null default 'practice' check (mode in ('practice', 'exam', 'mistakes')),
  question_ids   uuid[] not null default '{}',
  time_limit_s   integer,
  started_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  score          numeric,
  max_score      numeric,
  needs_review   integer not null default 0
);
create index quiz_attempts_user_idx on quiz_attempts (user_id, started_at desc);

create table quiz_answers (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  attempt_id      uuid not null references quiz_attempts(id) on delete cascade,
  question_id     uuid not null references quiz_questions(id) on delete cascade,
  response        jsonb,
  is_correct      boolean,              -- null = not yet decided (needs review)
  score           numeric not null default 0,
  max_score       numeric not null default 1,
  feedback        text,
  needs_review    boolean not null default false,
  error_category  text,
  unique (attempt_id, question_id)
);

create table flashcard_decks (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  subject_id          uuid not null references subjects(id) on delete cascade,
  topic_id            uuid references topics(id) on delete set null,
  name                text not null,
  source_material_ids uuid[] not null default '{}',
  source_summary_id   uuid references summaries(id) on delete set null,
  generation_key      text,
  created_at          timestamptz not null default now()
);
create unique index decks_generation_unique on flashcard_decks (user_id, generation_key) where generation_key is not null;

create table flashcards (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  deck_id             uuid not null references flashcard_decks(id) on delete cascade,
  front               text not null,
  back                text not null,
  topic_name          text,
  source_material_id  uuid references materials(id) on delete set null,
  source_ref          text,
  ease                numeric(4,2) not null default 2.5,
  interval_days       integer not null default 0,
  repetitions         integer not null default 0,
  lapses              integer not null default 0,
  due_at              timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index flashcards_due_idx on flashcards (user_id, due_at);

create table flashcard_reviews (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  card_id        uuid not null references flashcards(id) on delete cascade,
  rating         smallint not null check (rating between 1 and 4),  -- 1 again, 2 hard, 3 good, 4 easy
  prev_interval  integer not null,
  new_interval   integer not null,
  reviewed_at    timestamptz not null default now()
);
create index flashcard_reviews_user_idx on flashcard_reviews (user_id, reviewed_at desc);

-- ---------------------------------------------------------------------
-- Mastery, tutoring, AI usage
-- ---------------------------------------------------------------------
create table topic_mastery (
  user_id           uuid not null references users(id) on delete cascade,
  topic_id          uuid not null references topics(id) on delete cascade,
  subject_id        uuid not null references subjects(id) on delete cascade,
  attempts          integer not null default 0,
  correct           numeric not null default 0,
  recent_accuracy   numeric,                  -- weighted toward recent answers, 0..1
  last_practiced_at timestamptz,
  next_review_at    timestamptz,
  interval_days     integer not null default 1,
  mistake_counts    jsonb not null default '{}',
  updated_at        timestamptz not null default now(),
  primary key (user_id, topic_id)
);

create table tutor_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  subject_id  uuid references subjects(id) on delete set null,
  topic_id    uuid references topics(id) on delete set null,
  material_id uuid references materials(id) on delete set null,   -- optional course material for context
  mode        text not null check (mode in ('teach', 'solve', 'test', 'fix')),
  title       text not null default 'New session',
  saved       boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index tutor_sessions_user_idx on tutor_sessions (user_id, updated_at desc);

create table tutor_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  session_id  uuid not null references tutor_sessions(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  image_material_id uuid references materials(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index tutor_messages_session_idx on tutor_messages (session_id, created_at);

create table ai_usage (
  id             bigserial primary key,
  user_id        uuid not null references users(id) on delete cascade,
  feature        text not null,
  model          text,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  ok             boolean not null default true,
  created_at     timestamptz not null default now()
);
create index ai_usage_user_idx on ai_usage (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['users','profiles','user_preferences','integrations','subjects','assignments',
                           'materials','exams','study_tasks','summaries','flashcards','tutor_sessions']
  loop
    execute format('create trigger %I_touch before update on %I for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
-- Tables the restricted app role may use, each limited to the signed-in user's rows.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','user_preferences','integrations','sync_runs','subjects','topics','assignments',
    'materials','material_files','material_contents','material_versions','exams','exam_topics',
    'study_plans','study_tasks','study_sessions','summaries','quizzes','quiz_questions',
    'quiz_attempts','quiz_answers','flashcard_decks','flashcards','flashcard_reviews',
    'topic_mastery','tutor_sessions','tutor_messages','ai_usage']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to yaxha_app', t);
    execute format(
      'create policy %I on %I for all to yaxha_app using (user_id = app_uid()) with check (user_id = app_uid())',
      t || '_owner', t);
  end loop;
end $$;

-- users: the app role may read and update only its own row (never the password hash via the app UI).
alter table users enable row level security;
grant select, update on users to yaxha_app;
create policy users_self on users for all to yaxha_app using (id = app_uid()) with check (id = app_uid());

-- Server-only tables: RLS on, no policies for the app role = no access through it.
alter table sessions enable row level security;
alter table login_attempts enable row level security;
alter table oauth_tokens enable row level security;
alter table oauth_states enable row level security;

grant usage on all sequences in schema public to yaxha_app;

-- Supabase exposes the public schema through its REST API to the "anon" and
-- "authenticated" roles. This app does not use that API, so remove all access.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
  end if;
end $$;
