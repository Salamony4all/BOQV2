import { fetchLiveProductImage, verifyImageUrl } from '../utils/veImageEnricher.js';

async function testImages() {
  const tests = [
    { brand: 'Moonako', model: 'Lobby', url: 'https://www.moodie.com.au/?product=06-moonako-Lobby' },
    { brand: 'Moonako', model: 'Limone', url: '' },
    { brand: 'Infabbrica', model: 'Piper', url: 'https://www.infabbrica.com/en/folding-chairs/1151-piper-folding-chair.html' },
    { brand: 'Freifrau', model: 'Stella', url: 'https://www.freifrau.com/en/products/stella' },
    { brand: 'Ciment Studio', model: 'Mesa Cuvier', url: 'https://cimentstudio.com/products/mesa-cuvier' },
    { brand: 'Figueras', model: 'Scala 148', url: 'https://figueras.com/seating/scala-148/' },
    { brand: 'Wiesner Hager', model: 'Skill', url: 'https://www.wiesner-hager.com/en/products/tables/skill/' },
    { brand: 'Sui Generis', model: 'Halo Modern', url: 'https://www.suigeneris.co.uk/landscape_furniture/halo-circular-bench.html' }
  ];

  for (const t of tests) {
    const img = await fetchLiveProductImage(t.brand, t.model, t.url);
    console.log(`[${t.brand} ${t.model}] Image:`, img ? '✅ ' + img : '❌ NOT FOUND');
  }
}

testImages();
