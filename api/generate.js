import { GoogleAuth } from 'google-auth-library'
import axios from 'axios'
import FormData from 'form-data'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ message: 'Only POST requests allowed' })

  const { text = '', designStyle = '', colorMood = '', detailLevel = '' } = req.body
  if (!text || !designStyle || !colorMood || !detailLevel) {
    return res.status(400).json({ error: 'Missing required fields.' })
  }

  const prompt = buildPrompt({ text, designStyle, colorMood, detailLevel })

  try {
    // 1. Lấy access token từ service account
    const auth = new GoogleAuth({
      credentials: JSON.parse(process.env.SERVICE_ACCOUNT_JSON),
      scopes: 'https://www.googleapis.com/auth/cloud-platform'
    })
    const client = await auth.getClient()
    const token = await client.getAccessToken()

    const endpoint = `https://us-central1-aiplatform.googleapis.com/v1beta1/projects/${process.env.GCP_PROJECT_ID}/locations/us-central1/publishers/google/models/imagen-3:predict`

    const payload = {
      instances: [
        {
          prompt,
          sampleCount: 1,
          aspectRatio: '1:1'
        }
      ]
    }

    const response = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json'
      }
    })

    const base64 = response.data?.predictions?.[0]?.bytesBase64Encoded
    if (!base64) throw new Error('Imagen 3 failed to return image')

    // 2. Upload ảnh base64 lên Cloudinary
    const form = new FormData()
    form.append('file', Buffer.from(base64, 'base64'), 'pattern.png')
    form.append('upload_preset', 'ml_default')

    const cloudRes = await axios.post('https://api.cloudinary.com/v1_1/dv3wx2mvi/image/upload', form, {
      headers: form.getHeaders()
    })

    const imageUrl = cloudRes.data.secure_url
    res.status(200).json({ imageUrl, prompt })

  } catch (err) {
    console.error('❌ VertexAI Error:', err.response?.data || err.message)
    res.status(500).json({ error: 'Something went wrong' })
  }
}

function buildPrompt({ text, designStyle, colorMood, detailLevel }) {
  return `A seamless, repeating pattern of ${text}, in ${designStyle} style, with ${colorMood} tones. The illustration is ${detailLevel}, no background, vector-friendly, made for real fabric printing.`
}
