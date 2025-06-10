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

    // --- Xác thực Google Auth ---
    const auth = new GoogleAuth({
      credentials: JSON.parse(process.env.SERVICE_ACCOUNT_JSON),
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    const projectId = 'prefab-basis-462503-s2';
    const location = 'us-central1';
    const modelId = 'imagen-3.0-generate-001';
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`;

    // =================================================================
    // BƯỚC 1: TẠO ẢNH GỐC 1024x1024
    // =================================================================
    console.log('✅ Bước 1: Bắt đầu tạo ảnh gốc...');
    const generationPayload = {
      instances: [{ prompt: prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: "1:1", // Tạo ảnh vuông 1024x1024
        // Ghi chú: `sampleImageSize` không phải là tham số hợp lệ cho Imagen 3.
        // Kích thước được quyết định bởi aspectRatio.
      }
    };

    const generationResponse = await axios.post(endpoint, generationPayload, {
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json',
      },
    });

    const originalBase64 = generationResponse.data?.predictions?.[0]?.bytesBase64Encoded;
    if (!originalBase64) {
      console.error('❌ Bước 1 Thất bại: Không nhận được ảnh gốc. Response:', JSON.stringify(generationResponse.data, null, 2));
      throw new Error('Imagen 3 failed to return original image');
    }
    console.log('👍 Bước 1 Thành công: Đã tạo ảnh gốc.');

    // =================================================================
    // BƯỚC 2: NÂNG CẤP (UPSCALE) ẢNH LÊN 2x
    // =================================================================
    console.log('✅ Bước 2: Bắt đầu nâng cấp ảnh...');
    const upscalePayload = {
      instances: [
        {
          image: {
            bytesBase64Encoded: originalBase64 // Dùng ảnh từ Bước 1
          }
        }
      ],
      parameters: {
        mode: "upscale", // Chế độ nâng cấp
        upscaleConfig: {
          upscaleFactor: "x2" // Nâng cấp lên 2 lần (1024 -> 2048)
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
    // Dùng ảnh `upscaledBase64` để upload
    form.append('file', Buffer.from(upscaledBase64, 'base64'), 'pattern_2048x2048.png');
    form.append('upload_preset', 'ml_default');
    const cloudRes = await axios.post(`https://api.cloudinary.com/v1_1/dv3wx2mvi/image/upload`, form, { headers: form.getHeaders() });
    const imageUrl = cloudRes.data.secure_url;

    res.status(200).json({ imageUrl, prompt });

  } catch (err) {
    // Log lỗi chi tiết hơn để debug
    const errorMessage = err.response?.data?.error?.message || err.response?.data || err.message;
    console.error('❌ Lỗi Toàn Trình:', errorMessage);
    if (err.response?.data) {
      console.error('Full Error Response:', JSON.stringify(err.response.data, null, 2));
    }
    res.status(500).json({ error: 'Something went wrong on the server.', details: errorMessage });
  }
}
