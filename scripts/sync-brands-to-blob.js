#!/usr/bin/env node

/**
 * Sync Brands Database to Vercel Blob Storage
 * 
 * Usage: npm run sync:brands
 * 
 * This script uploads all local brand JSON files from /server/data/brands/ 
 * to Vercel Blob storage under the 'brands-db/' prefix for centralized storage.
 */

import 'dotenv/config';
import { put, list } from '@vercel/blob';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const isVercel = process.env.VERCEL === '1';

if (!BLOB_TOKEN) {
  console.error('❌ BLOB_READ_WRITE_TOKEN not set. Cannot sync to Blob storage.');
  process.exit(1);
}

async function syncBrandsToBlobStorage() {
  console.log('🔄 Starting Brands Database Sync to Blob Storage...\n');

  try {
    // Resolve brands directory
    const brandsPath = isVercel 
      ? '/tmp/data/brands' 
      : path.resolve(__dirname, '../server/data/brands');

    console.log(`📂 Reading brands from: ${brandsPath}`);

    // Create directory if it doesn't exist
    try {
      await fs.mkdir(brandsPath, { recursive: true });
    } catch (e) {}

    // Read all JSON files
    const files = await fs.readdir(brandsPath);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    if (jsonFiles.length === 0) {
      console.warn('⚠️  No JSON files found in brands directory.');
      return;
    }

    console.log(`📋 Found ${jsonFiles.length} brand files to sync:\n`);

    let successCount = 0;
    let failCount = 0;
    const syncResults = [];

    // Upload each brand file to Blob
    for (const file of jsonFiles) {
      try {
        const filePath = path.join(brandsPath, file);
        const content = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(content);

        // Validate brand data
        if (!parsed.name) {
          throw new Error('Invalid brand data: missing "name" field');
        }

        // Upload to Blob
        const blobPath = `brands-db/${file}`;
        await put(blobPath, content, {
          access: 'public',
          contentType: 'application/json'
        });

        successCount++;
        syncResults.push({
          file,
          status: '✅ SYNCED',
          size: `${(content.length / 1024).toFixed(2)} KB`,
          brand: parsed.name
        });

        console.log(`  ✅ ${file} → ${parsed.name}`);
      } catch (err) {
        failCount++;
        syncResults.push({
          file,
          status: '❌ FAILED',
          error: err.message
        });

        console.error(`  ❌ ${file}: ${err.message}`);
      }
    }

    // Print summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 SYNC SUMMARY`);
    console.log(`${'='.repeat(60)}`);
    console.log(`✅ Synced: ${successCount}/${jsonFiles.length}`);
    console.log(`❌ Failed: ${failCount}/${jsonFiles.length}`);
    console.log(`${'='.repeat(60)}\n`);

    // Get remote blob count
    try {
      const { blobs } = await list({ prefix: 'brands-db/', limit: 1000 });
      console.log(`📦 Vercel Blob Storage Status:`);
      console.log(`   Total Brands in Blob: ${blobs.length}`);
      console.log(`   Storage Prefix: brands-db/\n`);
    } catch (e) {
      console.warn('⚠️  Could not fetch blob storage stats');
    }

    if (failCount === 0) {
      console.log('🎉 All brands successfully synced to Blob storage!');
      process.exit(0);
    } else {
      console.log(`⚠️  Some brands failed to sync. Check errors above.`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Sync operation failed:', error.message);
    process.exit(1);
  }
}

// Run sync
syncBrandsToBlobStorage();
