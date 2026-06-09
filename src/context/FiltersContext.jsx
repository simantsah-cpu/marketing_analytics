import { createContext, useContext, useState, useMemo } from 'react'
import { computeDateRanges } from '../utils/date-ranges'

const FiltersContext = createContext(null)

const DEFAULT_PRESET = 'last30d'
const DEFAULT_COMPARISON = 'prevPeriod'

export function FiltersProvider({ children }) {
  const [preset, setPreset] = useState(DEFAULT_PRESET)
  const [comparison, setComparison] = useState(DEFAULT_COMPARISON)
  const [customRange, setCustomRange] = useState(null)
  // Multi-select: empty array = "all", otherwise array of selected values
  const [affiliateFilter, setAffiliateFilter] = useState([])
  const [countryFilter, setCountryFilter]     = useState([])
  const [deviceFilter, setDeviceFilter]       = useState([])
  const [groupBy, setGroupBy] = useState('affiliate')
  const [granularity, setGranularity] = useState('day')
  const [anomalies, setAnomalies] = useState({})
  // Dynamic options loaded from GA4
  const [filterOptions, setFilterOptions] = useState({ affiliates: [], countries: [] })
  // Report-109 specific BigQuery filters
  const [r109Platform, setR109Platform]         = useState(['APP', 'WEB'])  // default both
  const [r109Channel, setR109Channel]           = useState([])              // empty = all
  const [r109ExchangeRate, setR109ExchangeRate] = useState(0.744)           // GBP→USD rate

  const dateRanges = useMemo(
    () => computeDateRanges(preset, comparison, customRange),
    [preset, comparison, customRange]
  )

  const filters = useMemo(() => ({
    dateRanges,
    preset,
    comparison,
    customRange,
    affiliateFilter,   // string[] (empty = all)
    countryFilter,     // string[] (empty = all)
    deviceFilter,      // string[] (empty = all)
    groupBy,
    granularity,
    anomalies,
    filterOptions,
    r109Platform,
    r109Channel,
    r109ExchangeRate,
  }), [dateRanges, preset, comparison, customRange, affiliateFilter, countryFilter, deviceFilter, groupBy, granularity, anomalies, filterOptions, r109Platform, r109Channel, r109ExchangeRate])

  const actions = {
    setPreset,
    setComparison,
    setCustomRange,
    setAffiliateFilter,
    setCountryFilter,
    setDeviceFilter,
    setGroupBy,
    setGranularity,
    setAnomalies,
    setFilterOptions,
    setR109Platform,
    setR109Channel,
    setR109ExchangeRate,
  }

  return (
    <FiltersContext.Provider value={{ filters, actions }}>
      {children}
    </FiltersContext.Provider>
  )
}

export function useFilters() {
  return useContext(FiltersContext)
}
