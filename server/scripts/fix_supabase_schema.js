import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    console.log('🔍 Inspecting Supabase setup...');

    // 1. Check Table
    console.log('\n--- Table: brands ---');
    const { data: tableData, error: tableError } = await supabase
        .from('brands')
        .select('*')
        .limit(1);

    if (tableError) {
        console.error('❌ Table error:', tableError.message);
    } else {
        console.log('✅ Table "brands" exists.');
        const columns = tableData.length > 0 ? Object.keys(tableData[0]) : [];
        const required = ['id', 'name', 'logo', 'budget_tier', 'products', 'source', 'updated_at'];
        
        required.forEach(col => {
            if (columns.includes(col)) {
                console.log(`  ✅ Column "${col}" exists.`);
            } else if (tableData.length > 0) {
                console.error(`  ❌ Column "${col}" is MISSING.`);
            } else {
                console.log(`  ⚠️  Table is empty, cannot verify column "${col}" via select.`);
            }
        });
        
        if (tableData.length === 0) {
            console.log('  💡 Table is empty. Try running sync after fixing schema.');
        }
    }

    // 2. Check Storage
    console.log('\n--- Storage: assets ---');
    const { data: bucketData, error: bucketError } = await supabase.storage.listBuckets();
    
    if (bucketError) {
        console.error('❌ Storage error:', bucketError.message);
    } else {
        const assetsBucket = bucketData.find(b => b.name === 'assets');
        if (assetsBucket) {
            console.log('✅ Bucket "assets" exists.');
            console.log(`  Public: ${assetsBucket.public}`);
        } else {
            console.error('❌ Bucket "assets" is MISSING.');
        }
    }

    console.log('\n--- Action Required ---');
    console.log('If you see any ❌ above, please run the updated "server/scripts/setup_supabase.sql" in your Supabase SQL Editor.');
    console.log('Link: https://supabase.com/dashboard/project/_/sql');
}

inspect();
