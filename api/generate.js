// File: pages/api/generate-image.js

import { GoogleAuth } from 'google-auth-library';
import axios from 'axios';
import FormData from 'form-data';

// Hàm helper để xây dựng prompt
function buildPrompt({ text, designStyle, colorMood, detailLevel }) {
  return `A seamless, repeating pattern of ${text}, in ${designStyle} style, with ${colorMood} tones. The illustration is ${detailLevel}, no background, vector-friendly, made for real fabric printing.`;
}

export default async function handler(req, res) {
  // ... (Các phần CORS và method check giữ nguyên) ...
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Only POST requests allowed' });

  try {
    const { text = '', designStyle = '', colorMood = '', detailLevel = '' } = req.body;
    if (!text || !designStyle || !colorMood || !detailLevel) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const prompt = buildPrompt({ text, designStyle, colorMood, detailLevel });

    const auth = new GoogleAuth({
      credentials: JSON.parse(process.env.SERVICE_ACCOUNT_JSON),
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    const projectId = 'prefab-basis-462503-s2';
    const location = 'us-central1';
    const modelId = 'imagen-3.0-generate@latest';
    
    // Thử lại với endpoint v1beta1, đây là khả năng cao nhất
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`;
    
    const payload = {
      instances: [{ prompt: prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: "1:1",
        sampleImageSize: "2048"
      }
    };

    // ================== PHẦN DEBUG ĐÃ THÊM VÀO ==================
    console.log("--- STARTING VERTEX AI REQUEST ---");
    console.log("Endpoint URL:", endpoint);
    console.log("Request Payload:", JSON.stringify(payload, null, 2)); // In ra payload dưới dạng JSON đẹp mắt
    // ==========================================================

    const response = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json',
      },
    });

    const base64 = response.data?.predictions?.[0]?.bytesBase64Encoded;
    if (!base64) {
      console.error('❌ Imagen 3 did not return a valid image. Full response:', JSON.stringify(response.data, null, 2));
      throw new Error('Imagen 3 failed to return image');
    }

    // ... (Phần upload Cloudinary giữ nguyên) ...
    const form = new FormData();
    form.append('file', Buffer.from(base64, 'base64'), 'pattern.png');
    form.append('upload_preset', 'ml_default');
    const cloudRes = await axios.post(`https://api.cloudinary.com/v1_1/dv3wx2mvi/image/upload`, form, { headers: form.getHeaders() });
    const imageUrl = cloudRes.data.secure_url;

    res.status(200).json({ imageUrl, prompt });

  } catch (err) {
    console.error('❌ VertexAI Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
}
