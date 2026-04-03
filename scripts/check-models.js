import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.GOOGLE_API_KEY;

async function listModels() {
  try {
    const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
    console.log('Available Models:', JSON.stringify(response.data.models.map(m => m.name), null, 2));
  } catch (error) {
    console.error('Error listing models:', error.response?.data || error.message);
  }
}

listModels();
