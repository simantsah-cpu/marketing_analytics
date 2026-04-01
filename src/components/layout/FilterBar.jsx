import { useEffect } from 'react'
import { useFilters } from '../../context/FiltersContext'
import { useProperty } from '../../context/PropertyContext'
import { getFilterOptions } from '../../services/data-service'
import DateRangePicker from './DateRangePicker'
import MultiSelectFilter from './MultiSelectFilter'

const COMPARISON_PILLS = [
  { value: 'off',        label: 'Off' },
  { value: 'prevPeriod', label: 'vs Prev Period' },
  { value: 'prevYear',   label: 'vs Last Year' },
]

const DEVICE_OPTIONS = ['desktop', 'mobile', 'tablet']

const SEP = () => (
  <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />
)

export default function FilterBar() {
  const { filters, actions } = useFilters()
  const { selectedProperty } = useProperty()

  // ── Load dynamic affiliate + country options whenever property or date range changes ──
  useEffect(() => {
    const ga4Id = selectedProperty?.ga4_property_id
    if (!ga4Id || ga4Id === 'TBC') return
    getFilterOptions(ga4Id, filters.dateRanges).then(opts => {
      actions.setFilterOptions(opts)
    })
  }, [selectedProperty?.ga4_property_id, filters.dateRanges?.primary?.startDate, filters.dateRanges?.primary?.endDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Count non-default active filters for the badge
  const nonDefault = [
    filters.preset !== 'last30d',
    filters.affiliateFilter.length > 0,
    filters.countryFilter.length > 0,
    filters.deviceFilter.length > 0,
  ].filter(Boolean).length

  const clearAll = () => {
    actions.setPreset('last30d')
    actions.setComparison('prevPeriod')
    actions.setAffiliateFilter([])
    actions.setCountryFilter([])
    actions.setDeviceFilter([])
  }

  return (
    <div className="filter-bar-sticky" style={{
      height: 48,
      background: '#fff',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '0 24px',
      flexShrink: 0,
    }}>

      {/* Date Range */}
      <DateRangePicker filters={filters} actions={actions} />

      {/* Comparison pill toggle */}
      <div style={{
        display: 'flex', alignItems: 'center',
        background: 'var(--bg)', border: '1px solid var(--border)',
        borderRadius: 6, padding: 2, gap: 1,
      }}>
        {COMPARISON_PILLS.map(({ value, label }) => {
          const active = filters.comparison === value
          return (
            <button
              key={value}
              onClick={() => actions.setComparison(value)}
              style={{
                padding: '4px 10px', border: 'none', borderRadius: 4,
                background: active ? (value === 'off' ? 'var(--navy)' : 'var(--blue)') : 'transparent',
                color: active ? '#fff' : 'var(--subtext)',
                fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                cursor: 'pointer', transition: 'all 0.12s', whiteSpace: 'nowrap',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      <SEP />

      {/* Group By toggle */}
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--subtext)', whiteSpace: 'nowrap' }}>Group by</span>
      <div style={{
        display: 'flex', alignItems: 'center',
        background: 'var(--bg)', border: '1px solid var(--border)',
        borderRadius: 6, padding: 2, gap: 1,
      }}>
        {[
          { value: 'affiliate',        label: 'Affiliate' },
          { value: 'promotion_method', label: 'Promo Method' },
        ].map(({ value, label }) => {
          const active = filters.groupBy === value
          return (
            <button
              key={value}
              onClick={() => actions.setGroupBy(value)}
              style={{
                padding: '4px 10px', border: 'none', borderRadius: 4,
                background: active ? 'var(--teal)' : 'transparent',
                color: active ? '#fff' : 'var(--subtext)',
                fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                cursor: 'pointer', transition: 'all 0.12s', whiteSpace: 'nowrap',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      <SEP />

      {/* Affiliate multiselect */}
      <MultiSelectFilter
        label="All Affiliates"
        options={filters.filterOptions.affiliates}
        selected={filters.affiliateFilter}
        onApply={actions.setAffiliateFilter}
        minWidth={130}
      />

      {/* Country multiselect */}
      <MultiSelectFilter
        label="All Countries"
        options={filters.filterOptions.countries}
        selected={filters.countryFilter}
        onApply={actions.setCountryFilter}
        minWidth={130}
      />

      {/* Device multiselect */}
      <MultiSelectFilter
        label="All Devices"
        options={DEVICE_OPTIONS}
        selected={filters.deviceFilter}
        onApply={actions.setDeviceFilter}
        minWidth={110}
      />

      <SEP />

      {/* Active filter badge + Clear */}
      {nonDefault > 0 && (
        <>
          <span style={{
            fontSize: 11, fontWeight: 700, color: 'var(--blue)',
            background: 'var(--blue-light)', padding: '2px 8px',
            borderRadius: 10, whiteSpace: 'nowrap',
          }}>
            {nonDefault} filter{nonDefault > 1 ? 's' : ''} active
          </span>
          <button
            onClick={clearAll}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600, color: 'var(--subtext)',
              fontFamily: 'inherit', padding: 0, textDecoration: 'underline',
              whiteSpace: 'nowrap',
            }}
          >
            Clear all
          </button>
        </>
      )}
    </div>
  )
}
