import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-opus-4-5'

// ─── Build system prompts per mode ───────────────────────────────────────────
function buildSystemPrompt(mode: string): string {
  const base = `You are Orbit, an AI analytics assistant for hoppa.com and elife transfer's affiliate channel. 
You have access to live GA4 data. Your responses are always:
- Specific and grounded in the data provided
- Concise — never more than 3 paragraphs for summaries, 1–2 for chat responses
- Written in plain English for non-technical stakeholders
- Highlighting the single most actionable insight first
- Using bold for key metrics and affiliate names`

  if (mode === 'summary') {
    return `${base}

Your task is to write a structured performance narrative. Always follow this format:
**Headline Performance**: 2 sentences on overall channel performance vs the comparison period.
**Top & Bottom Performers**: Name the top 3 affiliates and bottom 2, with specific metrics.
**What Needs Attention**: 2 specific actionable items the team should investigate or act on.`
  }

  if (mode === 'chat') {
    return `${base}

You are embedded in a chart. The user is looking at a specific visualization and asking questions about it.
Refer to the chart data provided. Be specific — use the numbers from the data context. If a question is outside the chart's scope, say so and suggest what else might be useful.`
  }

  if (mode === 'query') {
    return `${base}

You are answering a free-form natural language question about affiliate channel performance.
If you can answer from the data context provided, do so with specific numbers.
If the data is insufficient, acknowledge that and describe what data would be needed.
Always end with a concrete recommendation.`
  }

  return base
}

// ─── Format data context for Claude ──────────────────────────────────────────
function formatContext(context: any): string {
  if (!context) return ''

  const parts: string[] = []

  if (context.chartTitle) parts.push(`Chart: ${context.chartTitle}`)
  if (context.dateRange) parts.push(`Date range: ${context.dateRange}`)
  if (context.period) parts.push(`Period: ${context.period}`)
  if (context.property) parts.push(`Property: ${context.property}`)

  if (context.kpis) {
    parts.push('\n## KPI Summary')
    for (const [key, val] of Object.entries(context.kpis as any)) {
      const v = val as any
      parts.push(`- ${key}: ${v.value} (${v.change > 0 ? '+' : ''}${v.change}% vs prior)`)
    }
  }

  if (context.data && Array.isArray(context.data)) {
    parts.push('\n## Chart Data (top rows)')
    const preview = context.data.slice(0, 15)
    parts.push(JSON.stringify(preview, null, 2))
  }

  if (context.affiliates && Array.isArray(context.affiliates)) {
    parts.push('\n## Affiliate Data')
    context.affiliates.slice(0, 15).forEach((a: any) => {
      parts.push(`- ${a.affiliateId}: sessions=${a.sessions}, revenue=£${a.revenue?.toFixed(0)}, conv=${(a.convRate * 100)?.toFixed(2)}%, aov=£${a.aov?.toFixed(0)}`)
    })
  }

  return parts.join('\n')
}

// ─── Call Anthropic streaming ─────────────────────────────────────────────────
async function callClaude(
  systemPrompt: string,
  messages: object[],
  stream: boolean
): Promise<Response> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY secret not configured')

  const body = {
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages,
    stream,
  }

  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Anthropic API error ${res.status}: ${err}`)
  }

  return res
}

// ─── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { mode, context, message, conversationHistory } = await req.json()

    if (!mode || !message) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: mode, message' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    const systemPrompt = buildSystemPrompt(mode)
    const contextText = formatContext(context)

    // Build messages array — include history for multi-turn chat
    const messages: object[] = []

    if (conversationHistory?.length) {
      messages.push(...conversationHistory)
    }

    // Add context to the current user message
    const userContent = contextText
      ? `${contextText}\n\n---\n\n${message}`
      : message

    messages.push({ role: 'user', content: userContent })

    // Summaries stream; chat/query return JSON for simplicity
    const shouldStream = mode === 'summary'

    const claudeRes = await callClaude(systemPrompt, messages, shouldStream)

    if (shouldStream) {
      // Pass through the SSE stream directly to the client
      return new Response(claudeRes.body, {
        headers: {
          ...CORS,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      })
    } else {
      // Non-streaming: parse and return the full response
      const data: any = await claudeRes.json()
      const content = data.content?.[0]?.text || ''

      return new Response(
        JSON.stringify({
          response: content,
          usage: data.usage,
          model: data.model,
        }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }
  } catch (err: any) {
    console.error('ai-invoke error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
