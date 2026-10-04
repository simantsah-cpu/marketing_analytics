// BigQuery REST client for Profitability — same service-account auth as leadership-dashboard,
// plus typed queryParameters. Values come back as strings; callers convert.

type Row = Record<string, string | null>

export async function getBQAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson)
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/bigquery.readonly https://www.googleapis.com/auth/cloud-platform.read-only',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }
  const enc = (obj: object) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}`
  const pemBody = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '')
  const keyData = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(unsigned))
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${sig}`,
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) throw new Error(`BQ token error: ${JSON.stringify(tokenData)}`)
  return tokenData.access_token
}

function extractRows(result: any, fields: any[]): Row[] {
  return (result.rows ?? []).map((row: any) => {
    const obj: Row = {}
    fields.forEach((f, i) => { obj[f.name] = row.f[i]?.v ?? null })
    return obj
  })
}

export async function runQuery(
  projectId: string,
  accessToken: string,
  query: string,
  queryParameters: object[],
): Promise<Row[]> {
  const base = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`
  const auth = { Authorization: `Bearer ${accessToken}` }
  const res = await fetch(base, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query, queryParameters, parameterMode: 'NAMED', useLegacySql: false,
      location: 'US', timeoutMs: 30000, maxResults: 10000,
    }),
  })
  if (!res.ok) throw new Error(`BigQuery HTTP ${res.status}: ${await res.text()}`)
  let result = await res.json()
  if (result.errors?.length) throw new Error(`BigQuery errors: ${JSON.stringify(result.errors)}`)

  const jobId = result.jobReference?.jobId
  const location = result.jobReference?.location ?? 'US'
  for (let attempt = 0; !result.jobComplete && attempt < 24; attempt++) {
    if (!jobId) throw new Error('BQ job incomplete and no jobId returned')
    await new Promise((r) => setTimeout(r, 2500))
    const poll = await fetch(`${base}/${jobId}?timeoutMs=10000&maxResults=10000&location=${location}`, { headers: auth })
    result = await poll.json()
    if (result.error) throw new Error(`BigQuery poll error: ${JSON.stringify(result.error)}`)
  }
  if (!result.jobComplete) throw new Error('BigQuery job timed out after polling')

  const fields: any[] = result.schema?.fields ?? []
  let rows = extractRows(result, fields)
  let pageToken: string | null = result.pageToken ?? null
  while (pageToken) {
    const page = await fetch(
      `${base}/${jobId}?pageToken=${encodeURIComponent(pageToken)}&maxResults=10000&location=${location}`,
      { headers: auth },
    )
    const data = await page.json()
    rows = rows.concat(extractRows(data, fields))
    pageToken = data.pageToken ?? null
  }
  return rows
}

/** Table metadata last-modified time (ms), or null if unavailable. Metadata reads scan no data. */
export async function tableLastModifiedMs(
  accessToken: string, t: { project: string; dataset: string; table: string },
): Promise<number | null> {
  try {
    const res = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${t.project}/datasets/${t.dataset}/tables/${t.table}?selectedFields=lastModifiedTime,type`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (!res.ok) return null
    const meta = await res.json()
    if (meta.type && meta.type !== 'TABLE') return null
    const ms = Number(meta.lastModifiedTime)
    return isFinite(ms) ? ms : null
  } catch {
    return null
  }
}
