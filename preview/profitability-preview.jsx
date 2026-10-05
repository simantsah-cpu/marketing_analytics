// QA-only harness (not committed): renders the real Orbit Sidebar and Profitability pages
// with payloads built from captured BigQuery results, stubbing only the edge-function call.
import payloads from './payloads.json'
const realFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  if (url.includes('/functions/v1/profitability')) {
    const b = JSON.parse(init?.body ?? '{}')
    await new Promise((r) => setTimeout(r, 400))
    const key = `${b.page}|${b.period}|${b.region ?? ''}|${b.country ?? ''}` + (b.page === 'routes' ? `|${b.product ?? ''}|${b.city ?? ''}` : '')
      + (b.page === 'customers' ? `|${b.product ?? ''}|${b.team ?? ''}|${b.ctype ?? ''}` : '')
    const p = payloads[key]
    return new Response(JSON.stringify(p ?? { error: `No preview payload for ${b.page} / ${b.period} / ${b.region ?? 'all'}` }), {
      status: p ? 200 : 400, headers: { 'Content-Type': 'application/json' },
    })
  }
  return realFetch(input, init)
}
const { default: React } = await import('react')
const { createRoot } = await import('react-dom/client')
const { MemoryRouter, Routes, Route } = await import('react-router-dom')
await import('../src/index.css')
const { AuthProvider } = await import('../src/context/AuthContext.jsx')
const { default: Sidebar } = await import('../src/components/layout/Sidebar.jsx')
const { default: ProfitabilityPage } = await import('../src/pages/profitability/ProfitabilityPage.jsx')
const h = React.createElement
const start = new URLSearchParams(location.search).get('p') ?? '/profitability'
createRoot(document.getElementById('root')).render(
  h(MemoryRouter, { initialEntries: [start] },
    h(AuthProvider, null,
      h('div', { className: 'app-shell pf-shell' },
        h(Sidebar),
        h('div', { className: 'main-area' },
          h('div', { id: 'scroller', style: { height: '100vh', overflowY: 'auto', overflowX: 'hidden' } },
            h(Routes, null,
              h(Route, { path: '/profitability', element: h(ProfitabilityPage) }),
              h(Route, { path: '/profitability/:section', element: h(ProfitabilityPage) }))))))))
