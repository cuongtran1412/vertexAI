// File: pages/api/generate-image.js

import { GoogleAuth } from 'google-auth-library';
import axios from 'axios';
import FormData from 'form-data';

// Hàm helper để xây dựng prompt
function buildPrompt({ text, designStyle, colorMood, detailLevel }) {
  return `A seamless, repeating pattern of ${text}, in ${designStyle} style, with ${colorMood} tones. The illustration is ${detailLevel}, no background, vector-friendly, made for real fabric printing.`;
}

export default async function handler(req, res) {
  // Thiết lập CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Xử lý preflight request của CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Chỉ cho phép phương thức POST
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST requests allowed' });
  }

  try {
    // Lấy tham số từ body của request
    const { text = '', designStyle = '', colorMood = '', detailLevel = '', sampleCount = 1 } = req.body;
    if (!text || !designStyle || !colorMood || !detailLevel) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    // Xây dựng prompt hoàn chỉnh
    const prompt = buildPrompt({ text, designStyle, colorMood, detailLevel });

    // --- Xác thực với Google Cloud ---
    const auth = new GoogleAuth({
      credentials: JSON.parse(process.env.SERVICE_ACCOUNT_JSON),
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    // --- Thông tin endpoint của Vertex AI ---
    const projectId = 'prefab-basis-462503-s2';
    const location = 'us-central1';
    const modelId = 'imagen-3.0-generate-001';
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`;

    // =================================================================
    // BƯỚC 1: TẠO ẢNH GỐC (1024x1024)
    // =================================================================
    console.log(`✅ Bước 1: Bắt đầu tạo ${sampleCount} ảnh gốc...`);
    const generationPayload = {
      instances: [{ prompt: prompt }],
      parameters: {
        sampleCount: parseInt(sampleCount, 10),
        aspectRatio: "1:1",
      }
    };

    const generationResponse = await axios.post(endpoint, generationPayload, {
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json',
      },
    });

    // Luôn chỉ lấy ảnh ĐẦU TIÊN để upscale
    const originalBase64 = generationResponse.data?.predictions?.[0]?.bytesBase64Encoded;
    if (!originalBase64) {
      console.error('❌ Bước 1 Thất bại: Không nhận được ảnh gốc. Response:', JSON.stringify(generationResponse.data, null, 2));
      throw new Error('Imagen 3 failed to return original image');
    }
    console.log('👍 Bước 1 Thành công: Đã tạo ảnh gốc. Sẽ upscale ảnh đầu tiên.');

    // =================================================================
    // BƯỚC 2: NÂNG CẤP (UPSCALE) ẢNH LÊN 2x (2048x2048)
    // =================================================================
    console.log('✅ Bước 2: Bắt đầu nâng cấp ảnh...');
    
    // Payload cho upscale, KHÔNG chứa sampleCount
    const upscalePayload = {
      instances: [ { image: { bytesBase64Encoded: originalBase64 } } ],
      parameters: {
        mode: "upscale",
        upscaleConfig: {
          upscaleFactor: "x2"
        }
      }
    };

    const upscaleResponse = await axios.post(endpoint, upscalePayload, {
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json',
      },
    });

    const upscaledBase64 = upscaleResponse.data?.predictions?.[0]?.bytesBase64Encoded;
    if (!upscaledBase64) {
      console.error('❌ Bước 2 Thất bại: Không nhận được ảnh đã nâng cấp. Response:', JSON.stringify(upscaleResponse.data, null, 2));
      throw new Error('Imagen 3 failed to return upscaled image');
    }
    console.log('👍 Bước 2 Thành công: Đã nâng cấp ảnh.');

    // =================================================================
    // BƯỚC 3: UPLOAD ẢNH ĐÃ NÂNG CẤP LÊN CLOUDINARY
    // =================================================================
    const form = new FormData();
    form.append('file', Buffer.from(upscaledBase64, 'base64'), 'pattern_2048x2048.png');
    form.append('upload_preset', 'ml_default');
    
    const cloudRes = await axios.post(`https://api.cloudinary.com/v1_1/dv3wx2mvi/image/upload`, form, { headers: form.getHeaders() });
    const imageUrl = cloudRes.data.secure_url;

    // Trả về kết quả thành công
    res.status(200).json({ imageUrl, prompt });

  } catch (err) {
    // Xử lý lỗi tập trung
    const errorMessage = err.response?.data?.error?.message || err.response?.data || err.message;
    console.error('❌ Lỗi Toàn Trình:', errorMessage);
    if (err.response?.data) {
      console.error('Full Error Response:', JSON.stringify(err.response.data, null, 2));
    }
    res.status(500).json({ error: 'Something went wrong on the server.', details: errorMessage });
  }
}
