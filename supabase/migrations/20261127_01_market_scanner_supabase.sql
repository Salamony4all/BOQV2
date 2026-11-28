-- Market Scanner 100% Supabase Consolidation (Projects, Contacts, Updates, Runs, Digests, Config)
-- Idempotent migration: safe to run multiple times without dropping existing data.

create table if not exists public.scanner_projects (
  id bigserial primary key,
  ext_id text unique not null,
  name text not null,
  en_name text,
  city text,
  country text not null default 'Oman',
  lat double precision,
  lon double precision,
  location_name text,
  scopes jsonb not null default '[]'::jsonb,
  top_scope text,
  stage text not null default 'unknown',
  completion_pct double precision,
  est_value_omr double precision,
  value_note text,
  client text,
  consultant text,
  contractor text,
  operator text,
  summary text,
  source_name text,
  source_url text,
  score double precision not null default 0,
  status text not null default 'active',
  boq_status text not null default 'new' check (boq_status in ('new', 'estimating', 'quoted', 'submitted')),
  is_demo boolean not null default false,
  is_news boolean not null default false,
  geo_unlocated boolean not null default false,
  enrichment jsonb not null default '{}'::jsonb,
  enriched_at timestamptz,
  first_seen timestamptz default now(),
  last_seen timestamptz default now(),
  last_checked timestamptz,
  check_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_scanner_projects_score on public.scanner_projects (score desc);
create index if not exists idx_scanner_projects_country_status on public.scanner_projects (country, status, is_news);
create index if not exists idx_scanner_projects_boq_status on public.scanner_projects (boq_status);

create table if not exists public.scanner_contacts (
  id bigserial primary key,
  project_id bigint not null references public.scanner_projects(id) on delete cascade,
  contact_key text not null,
  name text,
  role text,
  org text,
  email text,
  phone text,
  website text,
  source text,
  confidence double precision not null default 0.5,
  created_at timestamptz default now(),
  unique (project_id, contact_key)
);

create index if not exists idx_scanner_contacts_pid on public.scanner_contacts (project_id);

create table if not exists public.scanner_updates (
  id bigserial primary key,
  project_id bigint not null references public.scanner_projects(id) on delete cascade,
  ts timestamptz default now(),
  kind text,
  field text,
  old_value text,
  new_value text,
  note text
);

create index if not exists idx_scanner_updates_pid on public.scanner_updates (project_id, ts desc);

create table if not exists public.scanner_runs (
  id bigserial primary key,
  started_at timestamptz default now(),
  finished_at timestamptz,
  mode text,
  sources_ok integer not null default 0,
  sources_failed integer not null default 0,
  findings integer not null default 0,
  new_projects integer not null default 0,
  updated integer not null default 0,
  log text
);

create table if not exists public.scanner_digests (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  title text not null,
  leads_count integer not null default 10,
  leads_json jsonb not null default '[]'::jsonb,
  summary_text text,
  recipient text,
  dispatched boolean not null default false
);

create table if not exists public.scanner_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Enable Row Level Security on all Market Scanner tables
alter table public.scanner_projects enable row level security;
alter table public.scanner_contacts enable row level security;
alter table public.scanner_updates enable row level security;
alter table public.scanner_runs enable row level security;
alter table public.scanner_digests enable row level security;
alter table public.scanner_config enable row level security;

-- Public read-only access for intelligence tables; scanner_config stays service_role-only
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scanner_projects' and policyname = 'Public read scanner_projects') then
    create policy "Public read scanner_projects" on public.scanner_projects for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scanner_contacts' and policyname = 'Public read scanner_contacts') then
    create policy "Public read scanner_contacts" on public.scanner_contacts for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scanner_updates' and policyname = 'Public read scanner_updates') then
    create policy "Public read scanner_updates" on public.scanner_updates for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scanner_runs' and policyname = 'Public read scanner_runs') then
    create policy "Public read scanner_runs" on public.scanner_runs for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scanner_digests' and policyname = 'Public read scanner_digests') then
    create policy "Public read scanner_digests" on public.scanner_digests for select to anon, authenticated using (true);
  end if;
end $$;

notify pgrst, 'reload schema';
