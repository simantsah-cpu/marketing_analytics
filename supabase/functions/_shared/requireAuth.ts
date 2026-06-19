const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Verifies the request carries a valid Supabase user session JWT.
 * Returns the authenticated user object, or a 401 Response if auth fails.
 *
 * Usage in an edge function:
 *   const authResult = await requireAuth(req)
 *   if (authResult instanceof Response) return authResult
 *   // authResult.id is the authenticated user's ID
 */
export async function requireAuth(req: Request): Promise<{ id: string; email: string } | Response> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const token = authHeader.slice(7)

  // Reject the anon key — it proves nothing about the caller's identity
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (token === anonKey) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Validate the token by calling Supabase's auth API
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: serviceKey,
    },
  })

  if (!res.ok) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const user = await res.json()
  return { id: user.id, email: user.email }
}
