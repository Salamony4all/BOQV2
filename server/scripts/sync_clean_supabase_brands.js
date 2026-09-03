import { supabase } from '../utils/supabaseStorage.js';

async function cleanSupabaseBrands() {
  if (!supabase) {
    console.log('No Supabase client configured.');
    return;
  }
  const { data: brands, error } = await supabase.from('brands').select('id, name');
  if (error) {
    console.error('Error fetching Supabase brands:', error.message);
    return;
  }

  console.log(`Found ${brands.length} brands in Supabase.`);
  const CORE_BRAND_NAMES = new Set([
    'amara',
    'arper',
    'b&t design',
    'b_t_design',
    'dauphin products, collections and more',
    'dauphin',
    'fitout v2',
    'fitout_v2',
    'frezza',
    'herman miller',
    'herman_miller',
    'ismobil',
    'las',
    'mw structure test',
    'mw_structure_test',
    'narbutas',
    'nurus',
    'ofifran',
    'ottimo',
    'ottimo furniture',
    'ottimo_furniture',
    'rim',
    'sedus stoll',
    'sedus_stoll',
    'sokoa',
    'teknion me',
    'teknion_me',
    'workspace.ae',
    'workspace_ae'
  ]);

  for (const b of brands) {
    const nameLower = (b.name || '').toLowerCase().trim();
    if (!CORE_BRAND_NAMES.has(nameLower)) {
      console.log(`Deleting non-core test brand from Supabase: "${b.name}" (ID: ${b.id})`);
      const { error: delErr } = await supabase.from('brands').delete().eq('id', b.id);
      if (delErr) {
        console.warn(`  Failed to delete ${b.name}:`, delErr.message);
      } else {
        console.log(`  ✅ Deleted ${b.name}`);
      }
    }
  }
  console.log('✅ Supabase brand sync complete.');
}

cleanSupabaseBrands();
