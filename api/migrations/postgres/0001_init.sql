-- VeraClause Mantle — canonical model on Postgres (Supabase or RDS).
-- Mirrors mantle_api/db.py. Documents are jsonb with key columns, so new fields need
-- no migration; new key columns or tables get a new numbered file, never an edit here.

create table if not exists identities (
  sub         text primary key,
  learner_id  varchar(26) not null unique,
  role        text not null default 'learner' check (role in ('learner', 'mentor', 'admin')),
  created_at  text not null
);

create table if not exists learners (
  id          varchar(26) primary key,
  learner_id  varchar(26) not null,
  payload     jsonb not null,
  updated_at  text not null,
  check (id = learner_id)
);

create table if not exists card_states (
  learner_id  varchar(26) not null,
  card_id     text not null,
  payload     jsonb not null,
  reviewed_at text not null,
  primary key (learner_id, card_id)
);

create table if not exists attempts (
  id text primary key, learner_id varchar(26) not null, payload jsonb not null, at text not null
);
create table if not exists mastery (
  id text primary key, learner_id varchar(26) not null, payload jsonb not null, recorded_at text not null
);
create table if not exists plans (
  id text primary key, learner_id varchar(26) not null, payload jsonb not null, generated_at text not null
);
create table if not exists events (
  id text primary key, learner_id varchar(26) not null, payload jsonb not null, start text not null
);

create table if not exists ai_usage (
  id                 text primary key,
  learner_id         varchar(26) not null,
  day                varchar(10) not null,
  route              text not null,
  model              text not null,
  input_tokens       integer not null,
  output_tokens      integer not null,
  cache_read_tokens  integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_usd           double precision not null,
  latency_ms         integer not null,
  rung               integer not null,
  at                 text not null
);

create table if not exists grade_jobs (
  id          text primary key,
  learner_id  varchar(26) not null,
  drill_id    text not null,
  status      text not null,
  request     jsonb not null,
  result      jsonb,
  created_at  text not null,
  updated_at  text not null
);

create index if not exists ix_learners_learner on learners (learner_id);
create index if not exists ix_attempts_learner on attempts (learner_id, at);
create index if not exists ix_mastery_learner on mastery (learner_id, recorded_at);
create index if not exists ix_plans_learner on plans (learner_id);
create index if not exists ix_events_learner on events (learner_id, start);
create index if not exists ix_usage_learner_day on ai_usage (learner_id, day);
create index if not exists ix_jobs_learner on grade_jobs (learner_id);
