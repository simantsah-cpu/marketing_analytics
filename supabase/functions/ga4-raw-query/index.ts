import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-query-secret',
}

// One-time diagnostic function — runs arbitrary GA4 runReport calls
// Auth: x-query-secret header must match WARMER_SECRET env var
// (reusing existing secret so no new secret needed)

async function mintToken(saJson: string): Promise<string> {
  const sa = JSON.parse(saJson)
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }
  const enc = (o: object) =>
    btoa(JSON.stringify(o)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}`
  const pemBody = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '')
  const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const pk = await crypto.subtle.importKey('pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pk, new TextEncoder().encode(unsigned))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const jwt = `${unsigned}.${sigB64}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const d = await res.json()
  if (!d.access_token) throw new Error(`Token failed: ${JSON.stringify(d)}`)
  return d.access_token
}

function normalise(report: any): object[] {
  const dimH = report.dimensionHeaders?.map((h: any) => h.name) || []
  const metH = report.metricHeaders?.map((h: any) => h.name) || []
  return (report.rows || []).map((row: any) => {
    const obj: Record<string, any> = {}
    row.dimensionValues?.forEach((v: any, i: number) => { obj[dimH[i]] = v.value })
    row.metricValues?.forEach((v: any, i: number) => { obj[metH[i]] = parseFloat(v.value) || 0 })
    return obj
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const secret = req.headers.get('x-query-secret')
  const QUERY_SECRET = Deno.env.get('QUERY_SECRET') ?? ''
  if (!QUERY_SECRET || secret !== QUERY_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const saJson = Deno.env.get('GA4_SERVICE_ACCOUNT_JSON')
    if (!saJson) throw new Error('GA4_SERVICE_ACCOUNT_JSON not set')

    const { propertyId, requests } = await req.json()
    if (!propertyId || !requests?.length) throw new Error('Need propertyId + requests array')

    const token = await mintToken(saJson)
    const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`

    // Process in batches of 5 (GA4 limit)
    const allReports: object[][] = []
    for (let i = 0; i < requests.length; i += 5) {
      const chunk = requests.slice(i, i + 5)
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: chunk }),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(`GA4 error ${res.status}: ${err.slice(0, 300)}`)
      }
      const data = await res.json()
      allReports.push(...(data.reports || []).map((r: any) => normalise(r)))
    }

    return new Response(JSON.stringify({ ok: true, reports: allReports }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
