-- Fair hybrid scoring across embedded and unembedded rows inside Supabase Postgres
-- Prevents any newly added row (embedding IS NULL) from being penalized against indexed rows.

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
      (p.embedding is not null) as has_embedding,
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
      case when query_embedding is not null and has_embedding
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
      (f.embedding is not null) as has_embedding,
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
    (case when query_embedding is not null and has_embedding
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
      (c.embedding is not null) as has_embedding,
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
      case when query_embedding is not null and has_embedding
        then (0.55 * cosine_sim + 0.25 * least(1.0::double precision, fts_rank) + 0.20 * (kind_bonus + shape_bonus))
        else (0.65 * least(1.0::double precision, fts_rank) + kind_bonus + shape_bonus)
      end
    )::double precision as hybrid_score
  from candidates
  order by hybrid_score desc
  limit greatest(1, least(match_count, 30));
$$;

notify pgrst, 'reload schema';