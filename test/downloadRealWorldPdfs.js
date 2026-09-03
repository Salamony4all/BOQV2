import fs from 'fs';
import https from 'https';
import http from 'http';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const TARGET_DIR = './test_unseen_pdfs';
if (!fs.existsSync(TARGET_DIR)) fs.mkdirSync(TARGET_DIR);

const LIVE_URLS = [
  {
    name: 'jica_tender_boq.pdf',
    url: 'https://www.jica.go.jp/Resource/english/our_work/types_of_assistance/c_financial/procurement/pdf/p_sec_04_02.pdf'
  },
  {
    name: 'undp_procurement_boq.pdf',
    url: 'https://procurement-notices.undp.org/view_file.cfm?doc_id=275210'
  },
  {
    name: 'worldbank_sample_boq.pdf',
    url: 'https://projects.worldbank.org/en/projects-operations/document-detail/P162343'
  }
];

async function downloadFile(item) {
  const dest = `${TARGET_DIR}/${item.name}`;
  return new Promise((resolve) => {
    const proto = item.url.startsWith('https') ? https : http;
    const req = proto.get(item.url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`Redirecting ${item.name} to ${res.headers.location}`);
        const rProto = res.headers.location.startsWith('https') ? https : http;
        rProto.get(res.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r2) => {
          if (r2.statusCode === 200) {
            const file = fs.createWriteStream(dest);
            r2.pipe(file);
            file.on('finish', () => {
              file.close();
              const size = fs.statSync(dest).size;
              console.log(`✅ Downloaded: ${item.name} (${size} bytes)`);
              resolve({ success: true, name: item.name, path: dest, size });
            });
          } else {
            console.log(`⚠️ HTTP ${r2.statusCode} for ${item.name}`);
            resolve({ success: false, name: item.name });
          }
        }).on('error', (e) => {
          console.log(`❌ Error: ${item.name} ${e.message}`);
          resolve({ success: false, name: item.name });
        });
      } else if (res.statusCode === 200) {
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          const size = fs.statSync(dest).size;
          console.log(`✅ Downloaded: ${item.name} (${size} bytes)`);
          resolve({ success: true, name: item.name, path: dest, size });
        });
      } else {
        console.log(`⚠️ HTTP ${res.statusCode} for ${item.name}`);
        resolve({ success: false, name: item.name });
      }
    });
    req.on('error', (err) => {
      console.log(`❌ Error: ${item.name} ${err.message}`);
      resolve({ success: false, name: item.name });
    });
  });
}

async function main() {
  console.log('Downloading live public tender BOQs for unseen testing...');
  for (const it of LIVE_URLS) {
    await downloadFile(it);
  }
}

main().catch(console.error);
