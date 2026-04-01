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
  }), [dateRanges, preset, comparison, customRange, affiliateFilter, countryFilter, deviceFilter, groupBy, granularity, anomalies, filterOptions])

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
