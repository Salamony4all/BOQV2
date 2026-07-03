import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local', override: true });
console.log('🌱 [Env] Local overrides applied:', process.env.AUTO_BROWSER_URL);
