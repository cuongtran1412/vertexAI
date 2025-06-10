import { GoogleAuth } from 'google-auth-library'
import axios from 'axios'

export default async function handler(req, res) {
  try {
    const auth = new GoogleAuth({
      credentials: JSON.parse(process.env.SERVICE_ACCOUNT_JSON),
      scopes: 'https://www.googleapis.com/auth/cloud-platform'
    })

    const client = await auth.getClient()
    const token = await client.getAccessToken()

    const endpoint = `https://us-central1-aiplatform.googleapis.com/v1beta1/projects/${process.env.GCP_PROJECT_ID}/locations/us-central1/publishers/google/models/imagen-3:predict`

    const prompt = req.body.prompt || "A dog wearing a hoodie"

    const payload = {
      instances: [
        {
          prompt,
          sampleCount: 1,
          aspectRatio: "1:1"
        }
      ]
    }

    const response = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json'
      }
    })

    res.status(200).json(response.data)
  } catch (err) {
    console.error(err.response?.data || err.message)
    res.status(500).json({ error: 'Generation failed' })
  }
}
