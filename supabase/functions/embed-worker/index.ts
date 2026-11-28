// Supabase Edge Function: embed-worker
// Backfills 768-d Gemini embeddings into `catalog_products`, `fitout_catalog`, and `fabrication_catalog`
// for pgvector HNSW similarity search (eliminating cold-start in-memory embedding lag).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_API_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function normalizeL2(vec: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm === 0) return vec;
  return vec.map((v) => v / norm);
}

async function embedText(text: string): Promise<number[] | null> {
  if (!GEMINI_API_KEY || !text) return null;
  for (const model of ['gemini-embedding-2', 'gemini-embedding-2-preview']) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text: text.slice(0, 4000) }] },
          outputDimensionality: 768,
        }),
      },
    );
    if (!res.ok) continue;
    const data = await res.json();
    if (Array.isArray(data?.embedding?.values) && data.embedding.values.length > 0) {
      return normalizeL2(data.embedding.values);
    }
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const batchLimit = Math.min(50, Math.max(1, Number(body?.limit) || 25));
    const stats: Record<string, number> = {};

    for (const cfg of [
      { table: 'fitout_catalog', cols: 'id, code, name, trade, sub_trade, spec_mid' },
      { table: 'fabrication_catalog', cols: 'id, sku_code, name, category, description_template' },
      { table: 'catalog_products', cols: 'id, model, family, main_category, sub_category, archetype, dimensions_mm, description, catalog_brands(name)' },
    ]) {
      const { data: rows } = await supabase.from(cfg.table).select(cfg.cols).is('embedding', null).limit(batchLimit);
      let updated = 0;
      for (const r of rows || []) {
        const brandName = (r as Record<string, any>)?.catalog_brands?.name || '';
        const text = [
          brandName,
          ...Object.entries(r)
            .filter(([k, v]) => k !== 'id' && k !== 'catalog_brands' && v)
            .map(([, v]) => String(v)),
        ].filter(Boolean).join(' | ');
        const vec = await embedText(text);
        if (vec) {
          await supabase.from(cfg.table).update({ embedding: vec }).eq('id', r.id);
          updated++;
        }
      }
      stats[cfg.table] = updated;
    }

    return new Response(JSON.stringify({ ok: true, embedded: stats }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
