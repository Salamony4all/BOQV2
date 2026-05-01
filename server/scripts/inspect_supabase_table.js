
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectTable() {
    console.log('🔍 Inspecting "brands" table columns...');
    
    // Attempt to select one row to see columns, or use a query that fails with column info
    const { data, error } = await supabase
        .from('brands')
        .select('*')
        .limit(1);

    if (error) {
        console.error('❌ Error selecting from table:', error.message);
    } else {
        console.log('✅ Successfully queried table.');
        if (data.length > 0) {
            console.log('Columns found in first row:', Object.keys(data[0]));
        } else {
            console.log('Table is empty. Checking schema via RPC or other means is harder with anon key.');
            console.log('Let try to insert a test row without budget_tier to see what happens.');
            
            const { error: insertError } = await supabase
                .from('brands')
                .insert({ id: 'test_id', name: 'Test Brand' });
            
            if (insertError) {
                console.error('❌ Insert failed:', insertError.message);
            } else {
                console.log('✅ Test insert (basic) succeeded!');
                // Now try with budget_tier
                const { error: tierError } = await supabase
                    .from('brands')
                    .update({ budget_tier: 'high' })
                    .eq('id', 'test_id');
                
                if (tierError) {
                    console.error('❌ Update with budget_tier failed:', tierError.message);
                } else {
                    console.log('✅ Update with budget_tier succeeded!');
                }
            }
        }
    }
}

inspectTable();
