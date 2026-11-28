-- BOQFLOW Production AI Pipelines & 100% Supabase Consolidation
-- Idempotent, zero-downtime migration: creates normalized catalog, fitout, fabrication,
-- match cache, and async job queue tables alongside existing `brands`.

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- 1. Canonical Brands Table (zero duplicates via unique slug)
create table if not exists public.catalog_brands (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  slug text unique not null,
  name text not null,
  aliases text[] not null default '{}',
  budget_tier text not null default 'mid' check (budget_tier in ('budgetary', 'mid', 'high')),
  origin text,
  official_domain text,
  website_url text,
  logo_url text,
  status text not null default 'verified' check (status in ('verified', 'pending_enrichment', 'quarantined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_catalog_brands_tier on public.catalog_brands (budget_tier, status);
create index if not exists idx_catalog_brands_name_trgm on public.catalog_brands using gin (name gin_trgm_ops);

-- 2. Normalized Products Table (replaces 2.42MB brands.products JSONB blob)
create table if not exists public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.catalog_brands(id) on delete cascade,
  model text not null,
  model_normalized text not null,
  family text,
  main_category text,
  sub_category text,
  archetype text,
  description text,
  dimensions_mm text,
  price numeric(12,2) not null default 0,
  currency text not null default 'USD',
  price_source text not null default 'unpriced' check (price_source in ('verified_pricelist', 'scraped_retail', 'category_benchmark', 'unpriced')),
  image_url text,
  source_image_url text,
  official_url text,
  verified boolean not null default false,
  source text,
  tsv tsvector generated always as (
    to_tsvector('english',
      coalesce(model, '') || ' ' ||
      coalesce(family, '') || ' ' ||
      coalesce(main_category, '') || ' ' ||
      coalesce(sub_category, '') || ' ' ||
      coalesce(description, '')
    )
  ) stored,
  embedding vector(768),
  updated_at timestamptz not null default now(),
  unique (brand_id, model_normalized)
);

create index if not exists idx_catalog_products_brand on public.catalog_products (brand_id);
create index if not exists idx_catalog_products_archetype on public.catalog_products (archetype);
create index if not exists idx_catalog_products_model_trgm on public.catalog_products using gin (model_normalized gin_trgm_ops);
create index if not exists idx_catalog_products_tsv on public.catalog_products using gin (tsv);
create index if not exists idx_catalog_products_vec on public.catalog_products using hnsw (embedding vector_cosine_ops);

-- 3. Clean 3-Tier Architectural Fit-Out Catalog (replaces local fitout_v2-*.json)
create table if not exists public.fitout_catalog (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  trade text not null,
  sub_trade text,
  unit text not null check (unit in ('SQM', 'LM', 'Nos')),
  name text not null,
  spec_budgetary text not null,
  rate_budgetary numeric(12,2) not null,
  spec_mid text not null,
  rate_mid numeric(12,2) not null,
  spec_high text not null,
  rate_high numeric(12,2) not null,
  currency text not null default 'OMR',
  image_url text,
  tsv tsvector generated always as (
    to_tsvector('english',
      coalesce(code, '') || ' ' ||
      coalesce(name, '') || ' ' ||
      coalesce(trade, '') || ' ' ||
      coalesce(sub_trade, '') || ' ' ||
      coalesce(spec_mid, '')
    )
  ) stored,
  embedding vector(768),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fitout_catalog_trade on public.fitout_catalog (trade, unit);
create index if not exists idx_fitout_catalog_tsv on public.fitout_catalog using gin (tsv);
create index if not exists idx_fitout_catalog_vec on public.fitout_catalog using hnsw (embedding vector_cosine_ops);

-- 4. Custom-Made / Fabrication Catalog (wired directly to Design & Build)
create table if not exists public.fabrication_catalog (
  id uuid primary key default gen_random_uuid(),
  sku_code text unique not null,
  name text not null,
  category text not null,
  sub_category text,
  description_template text not null,
  pricing_unit text not null check (pricing_unit in ('Nos', 'LM', 'SQM')),
  default_width_mm integer,
  default_depth_mm integer,
  default_height_mm integer,
  min_width_mm integer,
  max_width_mm integer,
  shape text not null default 'rectangular',
  currency text not null default 'OMR',
  rate_budgetary numeric(12,2) not null default 0,
  rate_mid numeric(12,2) not null default 0,
  rate_high numeric(12,2) not null default 0,
  material_spec_budgetary text,
  material_spec_mid text,
  material_spec_high text,
  lead_time_days integer not null default 21,
  workshop_trade text not null default 'Joinery',
  design_build_kind text,
  render_prompt_hint text,
  image_url text,
  shop_drawing_url text,
  detection_keywords text[] not null default '{}',
  active boolean not null default true,
  tsv tsvector generated always as (
    to_tsvector('english',
      coalesce(sku_code, '') || ' ' ||
      coalesce(name, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      coalesce(sub_category, '') || ' ' ||
      coalesce(description_template, '')
    )
  ) stored,
  embedding vector(768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fab_catalog_tsv on public.fabrication_catalog using gin (tsv);
create index if not exists idx_fab_catalog_keywords on public.fabrication_catalog using gin (detection_keywords);
create index if not exists idx_fab_catalog_vec on public.fabrication_catalog using hnsw (embedding vector_cosine_ops);
create index if not exists idx_fab_catalog_db_kind on public.fabrication_catalog (design_build_kind, shape);

-- 5. Persistent Cross-Lambda Match Cache
create table if not exists public.match_cache (
  spec_hash text primary key,
  mode text not null,
  tier text,
  result_json jsonb not null,
  hit_count integer not null default 1,
  expires_at timestamptz not null default (now() + interval '30 days'),
  updated_at timestamptz not null default now()
);

create index if not exists idx_match_cache_expires on public.match_cache (expires_at);

-- 6. Async Scrape & Enrichment Job Queue (replaces Railway tasks + Vercel setTimeout)
create table if not exists public.scrape_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('brand_full_scrape', 'brand_enrich', 'product_enrich', 'embed_backfill', 'image_mirror')),
  brand_name text,
  target_url text,
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress integer not null default 0,
  result_summary jsonb,
  error_message text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_scrape_jobs_status on public.scrape_jobs (status, created_at desc);

-- 7. Async Plan Analysis Jobs
create table if not exists public.plan_jobs (
  id uuid primary key default gen_random_uuid(),
  storage_paths text[] not null default '{}',
  include_fitout boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  progress integer not null default 0,
  result_json jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 8. Hybrid Retrieval RPCs (Sub-80ms inside Postgres)
create or replace function public.match_products_hybrid(
  query_embedding vector(768) default null,
  query_text text default '',
  filter_tier text default null,
  filter_archetype text default null,
  filter_brand_slugs text[] default null,
  match_count int default 8
) returns table (
  product_id uuid,
  brand_name text,
  brand_slug text,
  brand_tier text,
  brand_logo text,
  model text,
  family text,
  main_category text,
  sub_category text,
  archetype text,
  description text,
  dimensions_mm text,
  price numeric,
  currency text,
  price_source text,
  image_url text,
  official_url text,
  verified boolean,
  cosine_sim float,
  fts_rank float,
  hybrid_score float
) language sql stable set search_path = public, extensions as $$
  with q as (
    select nullif(trim(coalesce(query_text, '')), '') as qt
  ),
  candidates as (
    select
      p.id as product_id,
      b.name as brand_name,
      b.slug as brand_slug,
      b.budget_tier as brand_tier,
      b.logo_url as brand_logo,
      p.model,
      p.family,
      p.main_category,
      p.sub_category,
      p.archetype,
      p.description,
      p.dimensions_mm,
      p.price,
      p.currency,
      p.price_source,
      p.image_url,
      p.official_url,
      p.verified,
      case when p.embedding is not null and query_embedding is not null
           then greatest(0.0::double precision, (1.0 - (p.embedding <=> query_embedding))::double precision)
           else 0.0::double precision end as cosine_sim,
      case when q.qt is not null
           then ts_rank_cd(p.tsv, websearch_to_tsquery('english', q.qt))::double precision
           else 0.0::double precision end as fts_rank,
      case when q.qt is not null
           then similarity(p.model_normalized, lower(q.qt))::double precision
           else 0.0::double precision end as trgm_sim
    from public.catalog_products p
    join public.catalog_brands b on b.id = p.brand_id
    cross join q
    where b.status = 'verified'
      and (filter_tier is null or b.budget_tier = filter_tier)
      and (filter_archetype is null or p.archetype = filter_archetype)
      and (filter_brand_slugs is null or cardinality(filter_brand_slugs) = 0 or b.slug = any(filter_brand_slugs))
  )
  select
    product_id, brand_name, brand_slug, brand_tier, brand_logo,
    model, family, main_category, sub_category, archetype, description, dimensions_mm,
    price, currency, price_source, image_url, official_url, verified,
    cosine_sim::double precision,
    fts_rank::double precision,
    (
      case when query_embedding is not null
        then (0.60 * cosine_sim + 0.25 * least(1.0::double precision, fts_rank + trgm_sim) + 0.15 * case when verified then 1.0 else 0.2 end)
        else (0.75 * least(1.0::double precision, fts_rank * 2.0 + trgm_sim) + 0.25 * case when verified then 1.0 else 0.2 end)
      end
    )::double precision as hybrid_score
  from candidates
  order by hybrid_score desc, verified desc, price desc
  limit greatest(1, least(match_count, 50));
$$;

create or replace function public.match_fitout_hybrid(
  query_embedding vector(768) default null,
  query_text text default '',
  filter_unit text default null,
  match_count int default 6
) returns table (
  id uuid,
  code text,
  trade text,
  sub_trade text,
  unit text,
  name text,
  spec_budgetary text,
  rate_budgetary numeric,
  spec_mid text,
  rate_mid numeric,
  spec_high text,
  rate_high numeric,
  currency text,
  image_url text,
  cosine_sim float,
  fts_rank float,
  hybrid_score float
) language sql stable set search_path = public, extensions as $$
  with q as (
    select nullif(trim(coalesce(query_text, '')), '') as qt
  ),
  candidates as (
    select
      f.id, f.code, f.trade, f.sub_trade, f.unit, f.name,
      f.spec_budgetary, f.rate_budgetary,
      f.spec_mid, f.rate_mid,
      f.spec_high, f.rate_high,
      f.currency, f.image_url,
      case when f.embedding is not null and query_embedding is not null
           then greatest(0.0::double precision, (1.0 - (f.embedding <=> query_embedding))::double precision)
           else 0.0::double precision end as cosine_sim,
      case when q.qt is not null
           then ts_rank_cd(f.tsv, websearch_to_tsquery('english', q.qt))::double precision
           else 0.0::double precision end as fts_rank
    from public.fitout_catalog f
    cross join q
    where (filter_unit is null or lower(f.unit) = lower(filter_unit))
  )
  select
    id, code, trade, sub_trade, unit, name,
    spec_budgetary, rate_budgetary, spec_mid, rate_mid, spec_high, rate_high,
    currency, image_url,
    cosine_sim::double precision,
    fts_rank::double precision,
    (case when query_embedding is not null
      then (0.65 * cosine_sim + 0.35 * least(1.0::double precision, fts_rank))
      else least(1.0::double precision, fts_rank)
    end)::double precision as hybrid_score
  from candidates
  order by hybrid_score desc
  limit greatest(1, least(match_count, 30));
$$;

create or replace function public.match_fabrication_hybrid(
  query_embedding vector(768) default null,
  query_text text default '',
  filter_db_kind text default null,
  filter_shape text default null,
  match_count int default 6
) returns table (
  id uuid,
  sku_code text,
  name text,
  category text,
  sub_category text,
  description_template text,
  pricing_unit text,
  default_width_mm integer,
  default_depth_mm integer,
  default_height_mm integer,
  shape text,
  currency text,
  rate_budgetary numeric,
  rate_mid numeric,
  rate_high numeric,
  material_spec_budgetary text,
  material_spec_mid text,
  material_spec_high text,
  lead_time_days integer,
  workshop_trade text,
  design_build_kind text,
  render_prompt_hint text,
  image_url text,
  detection_keywords text[],
  cosine_sim float,
  fts_rank float,
  hybrid_score float
) language sql stable set search_path = public, extensions as $$
  with q as (
    select nullif(trim(coalesce(query_text, '')), '') as qt
  ),
  candidates as (
    select
      c.id, c.sku_code, c.name, c.category, c.sub_category, c.description_template,
      c.pricing_unit, c.default_width_mm, c.default_depth_mm, c.default_height_mm,
      c.shape, c.currency,
      c.rate_budgetary, c.rate_mid, c.rate_high,
      c.material_spec_budgetary, c.material_spec_mid, c.material_spec_high,
      c.lead_time_days, c.workshop_trade, c.design_build_kind, c.render_prompt_hint,
      c.image_url, c.detection_keywords,
      case when c.embedding is not null and query_embedding is not null
           then greatest(0.0::double precision, (1.0 - (c.embedding <=> query_embedding))::double precision)
           else 0.0::double precision end as cosine_sim,
      case when q.qt is not null
           then ts_rank_cd(c.tsv, websearch_to_tsquery('english', q.qt))::double precision
           else 0.0::double precision end as fts_rank,
      (case when filter_db_kind is not null and lower(coalesce(c.design_build_kind, '')) = lower(filter_db_kind) then 0.25 else 0.0 end)::double precision as kind_bonus,
      (case when filter_shape is not null and lower(coalesce(c.shape, '')) = lower(filter_shape) then 0.15 else 0.0 end)::double precision as shape_bonus
    from public.fabrication_catalog c
    cross join q
    where c.active = true
  )
  select
    id, sku_code, name, category, sub_category, description_template,
    pricing_unit, default_width_mm, default_depth_mm, default_height_mm,
    shape, currency,
    rate_budgetary, rate_mid, rate_high,
    material_spec_budgetary, material_spec_mid, material_spec_high,
    lead_time_days, workshop_trade, design_build_kind, render_prompt_hint,
    image_url, detection_keywords,
    cosine_sim::double precision,
    fts_rank::double precision,
    (
      case when query_embedding is not null
        then (0.55 * cosine_sim + 0.25 * least(1.0::double precision, fts_rank) + 0.20 * (kind_bonus + shape_bonus))
        else (0.65 * least(1.0::double precision, fts_rank) + kind_bonus + shape_bonus)
      end
    )::double precision as hybrid_score
  from candidates
  order by hybrid_score desc
  limit greatest(1, least(match_count, 30));
$$;

-- 9. RLS Policies (Public/Anon read-only on catalogs; Service Role unrestricted)
alter table public.catalog_brands enable row level security;
alter table public.catalog_products enable row level security;
alter table public.fitout_catalog enable row level security;
alter table public.fabrication_catalog enable row level security;
alter table public.match_cache enable row level security;
alter table public.scrape_jobs enable row level security;
alter table public.plan_jobs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catalog_brands' and policyname = 'Public read catalog_brands') then
    create policy "Public read catalog_brands" on public.catalog_brands for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catalog_products' and policyname = 'Public read catalog_products') then
    create policy "Public read catalog_products" on public.catalog_products for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fitout_catalog' and policyname = 'Public read fitout_catalog') then
    create policy "Public read fitout_catalog" on public.fitout_catalog for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fabrication_catalog' and policyname = 'Public read fabrication_catalog') then
    create policy "Public read fabrication_catalog" on public.fabrication_catalog for select to anon, authenticated using (true);
  end if;
end $$;

notify pgrst, 'reload schema';
