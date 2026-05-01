-- setup_supabase.sql
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

-- 1. Create brands table if it doesn't exist
CREATE TABLE IF NOT EXISTS brands (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    logo TEXT,
    budget_tier TEXT, 
    products JSONB DEFAULT '[]'::jsonb,
    source TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Ensure ALL columns exist (in case table was created earlier without them)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='brands' AND column_name='budget_tier') THEN
        ALTER TABLE brands ADD COLUMN budget_tier TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='brands' AND column_name='products') THEN
        ALTER TABLE brands ADD COLUMN products JSONB DEFAULT '[]'::jsonb;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='brands' AND column_name='source') THEN
        ALTER TABLE brands ADD COLUMN source TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='brands' AND column_name='logo') THEN
        ALTER TABLE brands ADD COLUMN logo TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='brands' AND column_name='updated_at') THEN
        ALTER TABLE brands ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- 3. Enable RLS
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;

-- 4. Create public access policies
DROP POLICY IF EXISTS "Allow public read access" ON brands;
DROP POLICY IF EXISTS "Allow public insert access" ON brands;
DROP POLICY IF EXISTS "Allow public update access" ON brands;
DROP POLICY IF EXISTS "Allow public delete access" ON brands;

CREATE POLICY "Allow public read access" ON brands FOR SELECT USING (true);
CREATE POLICY "Allow public insert access" ON brands FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access" ON brands FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete access" ON brands FOR DELETE USING (true);

-- 5. Storage Setup: Create 'assets' bucket if missing
INSERT INTO storage.buckets (id, name, public)
SELECT 'assets', 'assets', true
WHERE NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'assets'
);

-- 6. Storage Policies (Allow public access to 'assets' bucket)
-- Note: Replace with your specific bucket name if different
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'assets');

DROP POLICY IF EXISTS "Public Upload" ON storage.objects;
CREATE POLICY "Public Upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'assets');

DROP POLICY IF EXISTS "Public Update" ON storage.objects;
CREATE POLICY "Public Update" ON storage.objects FOR UPDATE USING (bucket_id = 'assets');

