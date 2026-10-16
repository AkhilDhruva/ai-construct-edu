-- Row-level security: authorisation is enforced where the data lives, not only in the API.
-- The API sets mantle.sub, mantle.learner_id and mantle.role per transaction with
-- set_config(..., true) (see Database.scope). FORCE makes the policies apply to the table
-- owner too, so a bug in the API cannot read another learner's rows.

do $$
begin
  if not exists (select from pg_roles where rolname = 'mantle_app') then
    create role mantle_app nologin;
  end if;
end $$;

grant usage on schema public to mantle_app;
grant select, insert, update on identities, learners, card_states, attempts, mastery, plans, events, ai_usage, grade_jobs to mantle_app;

create or replace function mantle_learner() returns text language sql stable as
  $$ select nullif(current_setting('mantle.learner_id', true), '') $$;
create or replace function mantle_sub() returns text language sql stable as
  $$ select nullif(current_setting('mantle.sub', true), '') $$;
create or replace function mantle_is_admin() returns boolean language sql stable as
  $$ select coalesce(current_setting('mantle.role', true), '') = 'admin' $$;

alter table identities enable row level security;
alter table identities force row level security;
drop policy if exists identities_self on identities;
create policy identities_self on identities
  using (sub = mantle_sub())
  with check (sub = mantle_sub());

do $$
declare t text;
begin
  foreach t in array array['learners', 'card_states', 'attempts', 'mastery', 'plans', 'events', 'ai_usage', 'grade_jobs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_own', t);
    execute format(
      'create policy %I on %I using (learner_id = mantle_learner()) with check (learner_id = mantle_learner())',
      t || '_own', t
    );
  end loop;
end $$;

-- Operators read aggregate usage (cost dashboard) but never learner documents.
drop policy if exists ai_usage_admin_read on ai_usage;
create policy ai_usage_admin_read on ai_usage for select using (mantle_is_admin());
