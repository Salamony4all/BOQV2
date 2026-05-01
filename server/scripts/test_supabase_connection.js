
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTable() {
    console.log('🔍 Checking for "brands" table in Supabase...');
    const { data, error } = await supabase
        .from('brands')
        .select('*', { count: 'exact', head: true });

    if (error) {
        console.error('❌ Error checking table:', error.message);
        if (error.message.includes('relation "public.brands" does not exist')) {
            console.log('💡 The table "brands" has NOT been created yet. You must run the SQL script in the Supabase SQL Editor.');
        }
    } else {
        console.log('✅ "brands" table exists!');
        console.log('📊 Current row count:', data ? data.length : 0);
    }
}

checkTable();
