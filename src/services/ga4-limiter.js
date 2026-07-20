/**
 * GA4 CONCURRENCY LIMITER + CLIENT-SIDE RETRY
 * ─────────────────────────────────────────────────────────────────────────────
 * Root cause of the 500s:
 *   GA4's Analytics Data API allows MAX 2 concurrent batchRunReports calls per
 *   property per service account. The dashboard fires 5+ requests simultaneously
 *   on load → Google returns 429 "Exhausted concurrent requests quota" → edge
 *   function returns 500 → every widget shows an error.
 *
 * Fix (two layers):
 *   1. Serialise browser→edge requests to MAX_CONCURRENT=2 via a proper queue.
 *      The old _drain() while-loop was buggy: it called next() multiple times
 *      before _active was decremented (async), bypassing the limit entirely.
 *      New implementation uses a job object queue with correct slot management.
 *
 *   2. Client-side retry: if the edge function still returns 429/500 (e.g.
 *      because the edge function internally splits into multiple batchRunReports
 *      batches), wait 800ms and retry up to 3 times before giving up.
 *
 * Why loading is slow:
 *   Each page makes 1–2 edge function calls. Each edge function call can make
 *   2–3 batchRunReports calls to GA4 (chunked at 5 reports max per batch).
 *   GA4 API latency is typically 1–3s per call. With serial execution:
 *   5 pages × ~2s avg = ~10s total. This is a GA4 API quota constraint,
 *   not a code bug. The only way to make it faster is to increase MAX_CONCURRENT
 *   but that risks 429s. MAX_CONCURRENT=2 is the proven safe maximum.
 */

import { supabase } from './supabase'

const MAX_CONCURRENT = 2  // GA4 quota: max 2 concurrent per property/SA
const MAX_RETRIES    = 3
const RETRY_DELAY_MS = 800

let _active = 0
const _queue = []

function _schedule() {
  while (_active < MAX_CONCURRENT && _queue.length > 0) {
    const job = _queue.shift()
    _active++
    _runWithRetry(job.fn, MAX_RETRIES)
      .then((result) => {
        _active--
        _schedule()
        job.resolve(result)
      })
      .catch((err) => {
        _active--
        _schedule()
        job.reject(err)
      })
  }
}

async function _runWithRetry(fn, retriesLeft) {
  try {
    return await fn()
  } catch (err) {
    const msg = err?.message || ''
    const is429 = msg.includes('429') || msg.includes('Exhausted concurrent')
    const is5xx = msg.includes('500') || msg.includes('502') || msg.includes('503')
    const is401 = msg.includes('401') || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('jwt')

    // On 401 (expired JWT): refresh session once then retry immediately
    if (is401 && retriesLeft > 0) {
      console.warn('GA4 edge function: 401 — refreshing Supabase session and retrying...')
      try {
        await supabase.auth.refreshSession()
      } catch (refreshErr) {
        console.warn('Session refresh failed:', refreshErr)
      }
      return _runWithRetry(fn, retriesLeft - 1)
    }

    if ((is429 || is5xx) && retriesLeft > 0) {
      const delay = RETRY_DELAY_MS * (MAX_RETRIES - retriesLeft + 1) // 800ms, 1600ms, 2400ms
      console.warn(`GA4 ${msg.slice(0, 60)} — retrying in ${delay}ms (${retriesLeft} left)`)
      await new Promise(r => setTimeout(r, delay))
      return _runWithRetry(fn, retriesLeft - 1)
    }
    throw err
  }
}

/**
 * Invoke the ga4-query_affiliates edge function through the concurrency limiter.
 * @param {string} page   - The page type (traffic, scorecard, executive, etc.)
 * @param {object} body   - Full request body for the edge function
 * @returns {Promise<any[]>} - data.reports array from the edge function
 */
export function invokeGA4(page, body) {
  return new Promise((resolve, reject) => {
    const fn = async () => {
      const { data, error } = await supabase.functions.invoke('ga4-query_affiliates', { body })
      if (error) throw new Error(`ga4-query_affiliates error: ${error.message}`)
      if (data?.error) throw new Error(`GA4 error: ${data.error}`)
      // Return reports plus cache metadata so callers can surface freshness
      return {
        reports:   data.reports ?? [],
        cached_at: data.cached_at ?? null,
        _cached:   data._cached  ?? false,
        _stale:    data._stale   ?? false,
      }
    }

    _queue.push({ fn, resolve, reject })
    _schedule()
  })
}
