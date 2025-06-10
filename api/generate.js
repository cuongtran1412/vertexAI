// File: pages/api/generate-image.js

import { GoogleAuth } from 'google-auth-library';
import axios from 'axios';
import FormData from 'form-data';

// Hàm helper để xây dựng prompt
function buildPrompt({ text, designStyle, colorMood, detailLevel }) {
  return `A seamless, repeating pattern of ${text}, in ${designStyle} style, with ${colorMood} tones. The illustration is ${detailLevel}, no background, vector-friendly, made for real fabric printing.`;
}

export default async function handler(req, res) {
  // --- Thiết lập CORS Headers ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // --- Xử lý CORS Preflight Request ---
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // --- Chỉ cho phép phương thức POST ---
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST requests allowed' });
  }

  // --- Bắt đầu khối xử lý chính ---
  try {
    // 1. Lấy dữ liệu đầu vào
    const { text = '', designStyle = '', colorMood = '', detailLevel = '' } = req.body;
    if (!text || !designStyle || !colorMood || !detailLevel) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const prompt = buildPrompt({ text, designStyle, colorMood, detailLevel });

    // 2. Xác thực với Google Cloud
    const auth = new GoogleAuth({
      credentials: JSON.parse(process.env.SERVICE_ACCOUNT_JSON),
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    // 3. Gọi API Vertex AI Imagen 3 (Cấu trúc đã được sửa lại hoàn chỉnh)
    const projectId = 'prefab-basis-462503-s2';
    const location = 'us-central1';
    const modelId = 'imagen-3.0-generate-001'; // Dùng ID model chính thức
    
    // Endpoint với action :predict là chuẩn nhất
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`;
    
    // Payload cho :predict phải có cấu trúc "instances"
    const payload = {
      instances: [
        {
          prompt: prompt
        }
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio: "1:1",
        sampleImageSize: "2048" // <--- THÊM DÒNG NÀY ĐỂ YÊU CẦU ẢNH 2048x2048
      }
    };

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

    // 4. Upload ảnh lên Cloudinary
    const form = new FormData();
    form.append('file', Buffer.from(base64, 'base64'), 'pattern.png');
    form.append('upload_preset', 'ml_default');

    const cloudRes = await axios.post(
      `https://api.cloudinary.com/v1_1/dv3wx2mvi/image/upload`,
      form,
      {
        headers: form.getHeaders(),
      }
    );

    const imageUrl = cloudRes.data.secure_url;

    // 5. Trả về kết quả thành công
    res.status(200).json({ imageUrl, prompt });

  } catch (err) {
    // Xử lý lỗi chung
    console.error('❌ VertexAI Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
}
