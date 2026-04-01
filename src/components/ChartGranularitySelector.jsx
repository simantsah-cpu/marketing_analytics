import { useFilters } from '../context/FiltersContext'

export default function ChartGranularitySelector() {
  const { filters: { granularity }, actions: { setGranularity } } = useFilters()

  const options = ['Day', 'Week', 'Month', 'Quarter', 'Year']

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      border: '1px solid #E2E8F0',
      borderRadius: 6,
      overflow: 'hidden',
      backgroundColor: '#fff',
      marginRight: 16
    }}>
      {options.map(opt => {
        const value = opt.toLowerCase()
        const isActive = granularity === value
        return (
          <button
            key={value}
            onClick={() => setGranularity(value)}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 500,
              color: isActive ? '#fff' : 'var(--navy)',
              backgroundColor: isActive ? 'var(--blue-primary)' : 'transparent',
              border: 'none',
              borderRight: '1px solid #E2E8F0',
              cursor: 'pointer',
              outline: 'none',
              transition: 'all 0.2s ease'
            }}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}
