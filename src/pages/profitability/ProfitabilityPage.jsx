// Profitability dashboard frame: shared controls (period, snapshot, Refresh, plus page-specific
// filters), notices, and the active sidebar page. The selection lives in the URL
// (?period=…&as_of=…&region=…&country=…&product=…&city=…&team=…&ctype=…) so a view can be
// shared; period, as_of, region, country and product carry across pages via the sidebar links.
import { useEffect, useRef } from 'react'
import { Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import './profitability.css'
import { useProfitability } from './useProfitability.js'
import { PageHeader } from './components.jsx'
import { REGION_ORDER } from './model.js'
import ExecutiveSummary from './ExecutiveSummary.jsx'
import { header as esHeader } from './model.js'
import Countries from './Countries.jsx'
import { header as countriesHeader } from './countriesModel.js'
import Cities from './Cities.jsx'
import { header as citiesHeader } from './citiesModel.js'
import Routes from './Routes.jsx'
import { header as routesHeader, PRODUCTS } from './routesModel.js'
import Customers from './Customers.jsx'
import { header as customersHeader } from './customersModel.js'

export const PROFITABILITY_PAGES = {
  'executive-summary': { title: 'Executive Summary', Body: ExecutiveSummary, header: esHeader },
  countries: { title: 'Countries', Body: Countries, header: countriesHeader, regionFilter: true },
  cities: { title: 'Cities', Body: Cities, header: citiesHeader, regionFilter: true, countryFilter: true },
  routes: {
    title: 'Routes', Body: Routes, header: routesHeader,
    regionFilter: true, countryFilter: true, productFilter: true, cityFilter: true,
  },
  customers: {
    title: 'Customers', Body: Customers, header: customersHeader,
    regionFilter: true, countryFilter: true, productFilter: true, teamFilter: true,
  },
}

const DEFAULT_PERIODS = [
  { key: 'ytd', label: 'Year to date', available: true },
  { key: 'complete', label: 'Complete months this year', available: true },
  { key: 'mtd', label: 'Month to date', available: true },
  { key: 'last_year', label: 'Last year', available: true },
  { key: 'since2025', label: 'Since Jan 2025', available: true },
]
const PERIOD_KEYS = DEFAULT_PERIODS.map((p) => p.key)
const AS_OF_RE = /^(latest|eod:\d{4}-\d{2}-\d{2})$/
const CITY_RE = /^-?\d{1,12}$/

function Select({ label, value, onChange, children, disabled, title }) {
  return (
    <label className="pf-select" title={title}>
      <span className="pf-vh">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>{children}</select>
    </label>
  )
}

function Notices({ title, error, res }) {
  return (
    <>
      {error && (
        <div className="pf-notice" role="alert">
          Could not load {title}: {error}{res ? ' Showing the last successful load.' : ''}
        </div>
      )}
      {res?.status === 'reloading' && (
        <div className="pf-notice warn" role="status">The warehouse is reloading. Try Refresh in a few minutes.</div>
      )}
      {res?.status === 'inconsistent' && (
        <div className="pf-notice warn" role="status">
          Some totals did not reconcile to the cent for this snapshot, so the warehouse may be mid-reload. Try Refresh in a few minutes.
        </div>
      )}
    </>
  )
}

export default function ProfitabilityPage() {
  const { section } = useParams()
  const { search } = useLocation()
  const [params, setParams] = useSearchParams()
  // Latest query including changes not rendered yet, so two quick updates never drop one.
  const pending = useRef(params)
  pending.current = params
  const page = PROFITABILITY_PAGES[section]

  const period = PERIOD_KEYS.includes(params.get('period')) ? params.get('period') : 'ytd'
  const asOf = AS_OF_RE.test(params.get('as_of') ?? '') ? params.get('as_of') : 'latest'
  const region = page?.regionFilter && REGION_ORDER.includes(params.get('region')) ? params.get('region') : ''
  // On Cities and Routes ?country= filters the data; on Countries it only selects the trend
  // country. On Routes ?city= filters to one service area and then decides the country.
  const city = page?.cityFilter && CITY_RE.test(params.get('city') ?? '') ? params.get('city') : ''
  const country = page?.countryFilter && !city ? (params.get('country') ?? '') : ''
  const product = page?.productFilter && PRODUCTS.includes(params.get('product')) ? params.get('product') : ''
  const team = page?.teamFilter ? (params.get('team') ?? '') : ''
  const ctype = page?.teamFilter ? (params.get('ctype') ?? '') : ''
  const query = { period, as_of: asOf }
  if (page?.regionFilter) query.region = region
  if (page?.countryFilter) query.country = country
  if (page?.productFilter) query.product = product
  if (page?.cityFilter) query.city = city
  if (page?.teamFilter) { query.team = team; query.ctype = ctype }

  const { loading, error, res, refresh } = useProfitability(section ?? '', query, !!page)

  // Country dropdown: the countries with trips in this period and region. When a region
  // change leaves the selected country without trips, fall back to All countries.
  const countryOptions = res?.data?.country_options
  useEffect(() => {
    if (page?.countryFilter && country && countryOptions && !countryOptions.includes(country)) setParam('country', null, null)
  }, [countryOptions, country]) // eslint-disable-line react-hooks/exhaustive-deps
  // Team / customer type: fall back to "All" when the selection has none of that team or type.
  const teamOptions = res?.data?.team_options
  const ctypeOptions = res?.data?.ctype_options
  useEffect(() => {
    if (!page?.teamFilter) return
    if (team && teamOptions && !teamOptions.includes(team)) setParam('team', null, null)
    if (ctype && ctypeOptions && !ctypeOptions.includes(ctype)) setParam('ctype', null, null)
  }, [teamOptions, ctypeOptions, team, ctype]) // eslint-disable-line react-hooks/exhaustive-deps
  // While the city chip is set, the Country dropdown shows the city's country and is locked.
  const cityCountry = city ? (res?.data?.city_info?.country ?? params.get('country') ?? '') : null

  function setParam(k, v, dflt) {
    const next = new URLSearchParams(pending.current)
    if (v === dflt || v == null) next.delete(k); else next.set(k, v)
    pending.current = next
    setParams(next, { replace: true })
  }

  // Bare /profitability and retired or unknown sections land on Executive Summary.
  if (!page) return <Navigate to={`/profitability/executive-summary${search}`} replace />

  const snapshots = res?.snapshots ?? [{ value: 'latest', label: 'Latest' }]
  const periods = res?.periods ?? DEFAULT_PERIODS
  const { Body } = page

  return (
    <div className="pf">
      <div className="pf-top">
        {page.regionFilter && (
          <Select label="Region" value={region} onChange={(v) => setParam('region', v, '')}>
            <option value="">All regions</option>
            {REGION_ORDER.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        )}
        {page.countryFilter && (cityCountry != null ? (
          <Select label="Country" value={cityCountry} onChange={() => {}} disabled title="Set by the city filter">
            <option value={cityCountry}>{cityCountry || 'All countries'}</option>
          </Select>
        ) : (
          <Select label="Country" value={country} onChange={(v) => setParam('country', v, '')}>
            <option value="">All countries</option>
            {(countryOptions ?? (country ? [country] : [])).map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        ))}
        {page.productFilter && (
          <Select label="Product" value={product} onChange={(v) => setParam('product', v, '')}>
            <option value="">All products</option>
            {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        )}
        <Select label="Period" value={period} onChange={(v) => setParam('period', v, 'ytd')}>
          {periods.map((p) => <option key={p.key} value={p.key} disabled={!p.available}>{p.label}</option>)}
        </Select>
        <Select label="Snapshot" value={asOf} onChange={(v) => setParam('as_of', v, 'latest')}>
          {snapshots.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          {!snapshots.some((s) => s.value === asOf) && <option value={asOf}>{asOf.replace('eod:', 'End of day ')}</option>}
        </Select>
        <button type="button" className="pf-btn" onClick={refresh} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {page.teamFilter && (
          <div className="pf-top-row2">
            <Select label="Team" value={team} onChange={(v) => setParam('team', v, '')}>
              <option value="">All teams</option>
              {(teamOptions ?? (team ? [team] : [])).map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
            <Select label="Customer type" value={ctype} onChange={(v) => setParam('ctype', v, '')}>
              <option value="">All customer types</option>
              {(ctypeOptions ?? (ctype ? [ctype] : [])).map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
        )}
      </div>
      <main className="pf-main">
        <PageHeader title={page.title} h={res?.data ? page.header(res.data) : null} loading={loading} />
        <Notices title={page.title} error={error} res={res} />
        {res?.status !== 'reloading' && (
          <Body res={res} loading={loading} params={params} setParam={setParam} />
        )}
      </main>
    </div>
  )
}
