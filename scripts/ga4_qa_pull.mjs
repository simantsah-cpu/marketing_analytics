/**
 * ga4_qa_pull.mjs
 * Pulls every data point needed for the blog_banner_click funnel dashboard
 * directly from the GA4 Data API using the service account JSON.
 * Run with: node scripts/ga4_qa_pull.mjs
 */

import { readFileSync } from 'fs'
import { createSign } from 'crypto'

const PROPERTY_ID = '259261360'
const SA_PATH = '/Users/simant/Desktop/smart-altar-488316-u7-aab78b399ac7.json'
const TODAY = new Date().toISOString().slice(0, 10)

// ── JWT / token ──────────────────────────────────────────────────────────────

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function getAccessToken() {
  const sa = JSON.parse(readFileSync(SA_PATH, 'utf8'))
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }))
  const unsigned = `${header}.${payload}`
  const sign = createSign('RSA-SHA256')
  sign.update(unsigned)
  const sig = sign.sign(sa.private_key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const jwt = `${unsigned}.${sig}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`)
  return data.access_token
}

// ── GA4 runReport ────────────────────────────────────────────────────────────

async function runReport(token, body) {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`GA4 ${res.status}: ${txt}`)
  }
  return res.json()
}

function parseReport(report) {
  const dims = (report.dimensionHeaders || []).map(h => h.name)
  const mets = (report.metricHeaders || []).map(h => h.name)
  return (report.rows || []).map(row => {
    const obj = {}
    ;(row.dimensionValues || []).forEach((v, i) => obj[dims[i]] = v.value)
    ;(row.metricValues || []).forEach((v, i) => obj[mets[i]] = parseFloat(v.value) || 0)
    return obj
  })
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Pulling GA4 data for property ${PROPERTY_ID} — ${TODAY}`)
  const token = await getAccessToken()
  console.log('✓ Access token obtained\n')

  const results = {}

  // ── Q1: Top-of-funnel totals ──
  console.log('Q1: Top-of-funnel totals (blog_banner_click, 30d)...')
  const q1 = await runReport(token, {
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    metrics: [{ name: 'eventCount' }, { name: 'sessions' }, { name: 'totalUsers' }],
    dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'blog_banner_click' } } },
  })
  results.topFunnel = parseReport(q1)[0] || {}
  console.log('  →', results.topFunnel)

  // ── Q2: Daily trend ──
  console.log('Q2: Daily trend (blog_banner_click, 30d)...')
  const q2 = await runReport(token, {
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'eventCount' }, { name: 'sessions' }, { name: 'totalUsers' }],
    dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'blog_banner_click' } } },
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  })
  results.daily = parseReport(q2)
  console.log(`  → ${results.daily.length} days`)

  // ── Q3: Clicks by page ──
  console.log('Q3: Clicks by page (customEvent:last_internal_page, 30d)...')
  try {
    const q3 = await runReport(token, {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'customEvent:last_internal_page' }],
      metrics: [{ name: 'eventCount' }, { name: 'sessions' }, { name: 'totalUsers' }],
      dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'blog_banner_click' } } },
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      limit: 100,
    })
    results.byPage = parseReport(q3)
    console.log(`  → ${results.byPage.length} pages`)
    results.byPageError = null
  } catch (e) {
    results.byPage = []
    results.byPageError = e.message
    console.log(`  ✗ Error: ${e.message}`)
  }

  // ── Q4: Device split ──
  console.log('Q4: Device split (30d)...')
  const q4 = await runReport(token, {
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'deviceCategory' }],
    metrics: [{ name: 'eventCount' }, { name: 'sessions' }],
    dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'blog_banner_click' } } },
  })
  results.device = parseReport(q4)
  console.log('  →', results.device)

  // ── Q5: Channel split ──
  console.log('Q5: Channel split (30d)...')
  const q5 = await runReport(token, {
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'eventCount' }, { name: 'sessions' }],
    dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'blog_banner_click' } } },
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
  })
  results.channel = parseReport(q5)
  console.log('  →', results.channel)

  // ── Q6: Funnel steps with internal_referrer attribution ──
  const funnelEvents = ['blog_banner_click', 'view_search_results', 'begin_checkout', 'checkout', 'purchase']
  results.funnelAttrib = {}
  results.funnelAllRows = {}

  for (const evt of funnelEvents) {
    console.log(`Q6: Funnel attribution — ${evt}...`)
    try {
      const q = await runReport(token, {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'customEvent:internal_referrer' }],
        metrics: [{ name: 'eventCount' }, { name: 'sessions' }, { name: 'totalRevenue' }],
        dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: evt } } },
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: 50,
      })
      const rows = parseReport(q)
      results.funnelAllRows[evt] = rows
      // Find the transfers_banner row
      const bannerRow = rows.find(r => r['customEvent:internal_referrer'] === 'transfers_banner')
      results.funnelAttrib[evt] = bannerRow || { eventCount: 0, sessions: 0, totalRevenue: 0 }
      console.log(`  → all rows: ${rows.length}, transfers_banner row:`, results.funnelAttrib[evt])
    } catch (e) {
      results.funnelAttrib[evt] = { error: e.message }
      results.funnelAllRows[evt] = []
      console.log(`  ✗ Error: ${e.message}`)
    }
  }

  // ── Q7a: Site-wide sessions (30d) ──
  console.log('Q7a: Site-wide total sessions (30d)...')
  const q7a = await runReport(token, {
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    metrics: [{ name: 'sessions' }],
  })
  results.siteSessions = parseReport(q7a)[0] || {}
  console.log('  →', results.siteSessions)

  // ── Q7b: Site-wide funnel event totals (no internal_referrer filter) ──
  const benchEvents = ['view_search_results', 'begin_checkout', 'checkout', 'purchase']
  results.sitewideFunnel = {}
  for (const evt of benchEvents) {
    console.log(`Q7b: Site-wide ${evt} (30d)...`)
    const q = await runReport(token, {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      metrics: [{ name: 'eventCount' }, { name: 'sessions' }, { name: 'totalRevenue' }],
      dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: evt } } },
    })
    results.sitewideFunnel[evt] = parseReport(q)[0] || {}
    console.log('  →', results.sitewideFunnel[evt])
  }

  // ── Q8: Tagging-gap data-quality check ──
  // All checkout/purchase rows by internal_referrer value (no event name filter —
  // we filter by eventName only, NOT by internal_referrer, to see the full breakdown)
  for (const evt of ['checkout', 'purchase']) {
    console.log(`Q8: Tagging gap check — all ${evt} rows by internal_referrer...`)
    try {
      const q = await runReport(token, {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        dimensions: [{ name: 'customEvent:internal_referrer' }],
        metrics: [{ name: 'eventCount' }, { name: 'sessions' }],
        dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: evt } } },
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: 50,
      })
      results.funnelAllRows[`${evt}_gapcheck`] = parseReport(q)
      console.log(`  → rows:`, results.funnelAllRows[`${evt}_gapcheck`])
    } catch (e) {
      results.funnelAllRows[`${evt}_gapcheck`] = [{ error: e.message }]
      console.log(`  ✗ Error: ${e.message}`)
    }
  }

  // ── Output full JSON ──
  console.log('\n\n======= FULL RESULTS JSON =======\n')
  console.log(JSON.stringify(results, null, 2))
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
