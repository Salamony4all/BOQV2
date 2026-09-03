import axios from 'axios';

async function testSearch(query) {
    try {
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch&gl=us&hl=en`;
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        // Match JSON-encoded image URLs in Google Images JavaScript bundles
        const imgUrls = [];
        const regex = /\["(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp))",\d+,\d+\]/gi;
        let match;
        while ((match = regex.exec(res.data)) !== null) {
            imgUrls.push(match[1]);
        }
        console.log(`Google JSON images for "${query}": ${imgUrls.length}`);
        for (const u of imgUrls.slice(0, 5)) {
            console.log(' - Google Image:', u);
        }
    } catch (e) {
        console.warn('Google failed:', e.message);
    }
}

async function run() {
    await testSearch('Infabbrica Piper foldable chair');
    await testSearch('Wiesner Hager Skill table');
    await testSearch('Moonako Lobby bench');
    await testSearch('Milimetry Total Shop Fixture Tables');
}

run();
