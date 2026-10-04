// Loads one Profitability page payload from the `profitability` edge function.
// The server pins as_of and resolves every date; the client only sends the selection.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../services/supabase'

const EDGE_FN = 'profitability'
const LATEST_TTL_MS = 2 * 60_000 // re-ask the server (which has its own cache) after this
const memo = new Map() // per-session, per page + selection, so switching pages does not re-query

async function errorMessage(error) {
  try {
    const body = await error?.context?.json?.()
    if (body?.error) return body.error
  } catch { /* not JSON */ }
  return error?.message || 'Request failed'
}

/** @param {string} page  @param {{ period: string, as_of: string, region?: string }} query */
export function useProfitability(page, query, enabled = true) {
  const key = `${page}|${JSON.stringify(query)}`
  // State is tagged with the selection it belongs to, so a page or filter change never renders
  // the previous selection's payload (the new request only starts in the effect below).
  const [state, setState] = useState({ key, loading: enabled, error: null, res: null })
  const reqId = useRef(0)

  const load = useCallback(async (force) => {
    const hit = memo.get(key)
    const fresh = hit && (query.as_of !== 'latest' || Date.now() - hit.at < LATEST_TTL_MS)
    if (!force && fresh) {
      setState({ key, loading: false, error: null, res: hit.res })
      return
    }
    const id = ++reqId.current
    // A new selection shows skeletons (never another selection's numbers); Refresh keeps the
    // current render on screen until the new one arrives.
    setState((s) => ({ key, loading: true, error: null, res: force && s.key === key ? s.res : null }))
    const { data, error } = await supabase.functions.invoke(EDGE_FN, { body: { page, ...query, force: !!force } })
    if (id !== reqId.current) return // a newer request superseded this one
    if (error || !data || data.error) {
      const msg = error ? await errorMessage(error) : data?.error || 'Empty response'
      // Keep the last good render; show the error inline.
      setState((s) => ({ key, loading: false, error: msg, res: s.key === key ? s.res : null }))
      return
    }
    if (data.status === 'ok') memo.set(key, { at: Date.now(), res: data })
    setState({ key, loading: false, error: null, res: data })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (enabled) load(false) }, [load, enabled])

  const current = state.key === key ? state : { loading: enabled, error: null, res: null }
  return { loading: current.loading, error: current.error, res: current.res, refresh: () => load(true) }
}
